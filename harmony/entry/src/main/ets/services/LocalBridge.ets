import { common } from '@kit.AbilityKit';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { vibrator } from '@kit.SensorServiceKit';
import { AtomicStore } from './AtomicStore';
import { KeyVault } from './KeyVault';
import { ContentPart, DeepSeekService } from './DeepSeekService';
import { FeatureService } from './FeatureService';
import { NativeDocuments } from './NativeDocuments';
import { BridgeHost } from './BridgeHost';

export const LOCAL_BRIDGE_METHODS: string[] = [
  'pageReady', 'isFreshInstall', 'getWorkspaceCheckpoint', 'persistWorkspaceCheckpoint',
  'exportBackup', 'openTeachingPortal', 'openTeachingPortalForSchool',
  'syncFeatures', 'featuresStatus', 'getReminderStatus', 'requestReminderPermission',
  'requestNotificationPermission', 'syncWidgetAppearance', 'requestPinWidget',
  'requestPinCompactWidget', 'consumeWidgetLaunch', 'chooseNoticeScreenshot', 'cancelNoticeScreenshot',
  'getDeepSeekConfig', 'saveDeepSeekConfig', 'clearDeepSeekConfig', 'requestDeepSeek',
  'cancelDeepSeek', 'pickDeepSeekDocument', 'cancelDeepSeekDocument',
  'storeDeepSeekDocument', 'clearDeepSeekAttachments', 'weekLongPressHaptic'
];

interface DocumentReply { name?: string; attachmentId?: string; error: string; }

export class LocalBridge {
  private host: BridgeHost;
  private store: AtomicStore | undefined = undefined;
  private features: FeatureService | undefined = undefined;
  private vault: KeyVault = new KeyVault();
  private ai: DeepSeekService = new DeepSeekService(this.vault);
  private documents: NativeDocuments = new NativeDocuments();
  private documentGeneration: number = 0;
  private pendingDocument: string = '';
  private noticeGeneration: number = 0;
  private noticeBusy: boolean = false;
  private exportBusy: boolean = false;
  private disposed: boolean = false;
  constructor(host: BridgeHost) { this.host = host; }

  initialize(context: common.UIAbilityContext): void {
    this.disposed = false;
    this.store = new AtomicStore(context.filesDir);
    this.features = new FeatureService(context, this.store);
  }
  dispose(): void {
    this.disposed = true;
    this.resetSession();
    if (this.features) this.features.dispose();
  }
  resetSession(): void {
    this.noticeGeneration++;
    this.noticeBusy = false;
    this.documentGeneration++;
    this.pendingDocument = '';
    this.ai.cancel();
    this.ai.clearAttachments();
  }
  private checkpointStore(): AtomicStore {
    if (!this.store || this.disposed) throw new Error('STORE_UNAVAILABLE');
    return this.store;
  }
  private featureService(): FeatureService {
    if (!this.features || this.disposed) throw new Error('FEATURES_UNAVAILABLE');
    return this.features;
  }
  pageReady(): void { this.host.pageReady(); }
  isFreshInstall(): boolean { this.host.requireCall(); return this.checkpointStore().checkpoint() === 'null'; }
  getWorkspaceCheckpoint(): string { this.host.requireCall(); return this.checkpointStore().checkpoint(); }
  persistWorkspaceCheckpoint(value: string): boolean {
    this.host.requireCall();
    return typeof value === 'string' && this.checkpointStore().persistCheckpoint(value);
  }

  // The bool acknowledges starting the system picker. Only fsync completion produces a saved toast.
  exportBackup(name: string, content: string): boolean {
    this.host.requireCall();
    if (this.exportBusy || typeof content !== 'string' || content.length > 5 * 1024 * 1024) return false;
    try { JSON.parse(content); } catch (_) { return false; }
    const safeName = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').slice(0, 100);
    if (!safeName.endsWith('.json')) return false;
    this.exportBusy = true;
    this.saveBackup(safeName, content).finally(() => { this.exportBusy = false; });
    return true;
  }
  private async saveBackup(name: string, content: string): Promise<void> {
    let file: fs.File | undefined = undefined;
    try {
      const options = new picker.DocumentSaveOptions();
      options.newFileNames = [name];
      options.fileSuffixChoices = ['JSON 备份|.json'];
      const uris = await new picker.DocumentViewPicker(this.host.context()).save(options);
      if (!uris.length || this.disposed || !this.host.trustedDocument()) return;
      const bytes = new util.TextEncoder().encodeInto(content);
      if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('BACKUP_TOO_LARGE');
      file = fs.openSync(uris[0], fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
      let offset = 0;
      while (offset < bytes.byteLength) {
        const wrote = fs.writeSync(file.fd, bytes.slice(offset).buffer);
        if (wrote <= 0 || wrote > bytes.byteLength - offset) throw new Error('BACKUP_SHORT_WRITE');
        offset += wrote;
      }
      fs.fsyncSync(file.fd);
      if (fs.statSync(file.fd).size !== bytes.byteLength) throw new Error('BACKUP_SHORT_WRITE');
      fs.closeSync(file); file = undefined;
      if (!this.disposed && this.host.trustedDocument()) this.host.message('备份已保存到所选位置。');
    } catch (_) {
      if (!this.disposed && this.host.trustedDocument()) this.host.message('备份未能保存完成，请重新选择位置后导出。');
    } finally {
      if (file) { try { fs.closeSync(file); } catch (_) {} }
    }
  }
  openTeachingPortal(): boolean { return this.host.openPortal('just'); }
  openTeachingPortalForSchool(schoolId: string): boolean { return this.host.openPortal(schoolId); }

  syncFeatures(payload: string): boolean {
    this.host.requireCall();
    try {
      const saved = this.featureService().sync(payload);
      if (saved) this.refreshFeatures();
      else this.host.message('提醒与卡片配置未能保存，请重新打开应用后检查。');
      return saved;
    } catch (_) { this.host.message('提醒与卡片暂不可用，课表仍保存在本机。'); return false; }
  }
  syncWidgetAppearance(glass: boolean, frost: number, reducedMotion: boolean): boolean {
    this.host.requireCall();
    try {
      const saved = this.featureService().appearance(glass, frost, reducedMotion);
      if (saved) this.refreshFeatures();
      return saved;
    } catch (_) { return false; }
  }
  featuresStatus(): string { this.host.requireCall(); return this.featureService().status(); }
  getReminderStatus(): string { return this.featuresStatus(); }
  requestReminderPermission(): void {
    this.host.requireCall();
    this.featureService().requestPermission();
    this.refreshFeatures();
  }
  requestNotificationPermission(): void { this.requestReminderPermission(); }
  refreshFeatures(): void {
    if (!this.features || this.disposed) return;
    this.features.refresh().then(() => { this.publishFeatureStatus(); }).catch(() => {
      this.host.message('系统提醒或卡片尚未更新完成，请在提醒设置中检查状态。');
      this.publishFeatureStatus();
    });
  }
  private publishFeatureStatus(): void {
    if (!this.features || this.disposed) return;
    const status = this.features.status();
    this.host.run('if(window.SuikeFeatures)window.SuikeFeatures.nativeStatus(JSON.parse(' + JSON.stringify(status) + '));');
  }
  requestPinWidget(): boolean {
    this.host.requireCall();
    return this.host.unavailable('请在桌面长按随课图标，选择服务卡片后添加。');
  }
  requestPinCompactWidget(): boolean { return this.requestPinWidget(); }
  consumeWidgetLaunch(): boolean {
    this.host.requireCall();
    const fromCard = AppStorage.get<boolean>('suike.widget.launch') === true;
    if (fromCard) AppStorage.set<boolean>('suike.widget.launch', false);
    return fromCard;
  }
  chooseNoticeScreenshot(): boolean {
    this.host.requireCall();
    if (this.disposed || this.noticeBusy) return this.host.unavailable('上一张截图仍在读取，请稍后重试。');
    this.noticeBusy = true;
    const generation = ++this.noticeGeneration;
    this.pickNoticeScreenshot(generation).catch((error: Error) => {
      if (!this.disposed && generation === this.noticeGeneration) {
        const code = this.noticeErrorCode((error as Error).message);
        this.noticeResult(generation, '', code);
      }
    }).finally(() => {
      if (generation === this.noticeGeneration) this.noticeBusy = false;
    });
    return true;
  }
  cancelNoticeScreenshot(): void {
    this.host.requireCall();
    this.noticeGeneration++;
    this.noticeBusy = false;
  }
  private noticeErrorCode(code: string): string {
    if (code === 'ATTACHMENT_SIZE' || code === 'DOCUMENT_SIZE') return 'DOCUMENT_SIZE';
    const codes: string[] = ['CANCELLED','NO_TEXT','OCR_UNSUPPORTED','OCR_BUSY','OCR_IMAGE_INVALID','OCR_IMAGE_TOO_LARGE','OCR_IMAGE_TOO_SMALL','OCR_UNAVAILABLE','OCR_FAILED','OCR_TEXT_TOO_LONG'];
    return codes.includes(code) ? code : 'OCR_FAILED';
  }
  private noticeResult(generation: number, text: string, error: string): void {
    if (this.disposed || generation !== this.noticeGeneration || !this.host.trustedDocument()) return;
    this.host.run('if(window.SuikeFeatures)window.SuikeFeatures.receiveNoticeText(' + JSON.stringify(text) + ',' + JSON.stringify(error) + ');');
  }
  private async pickNoticeScreenshot(generation: number): Promise<void> {
    const options = new picker.DocumentSelectOptions();
    options.maxSelectNumber = 1;
    options.fileSuffixFilters = ['通知截图|.png,.jpg,.jpeg,.webp'];
    const uris = await new picker.DocumentViewPicker(this.host.context()).select(options);
    if (this.disposed || generation !== this.noticeGeneration || !this.host.trustedDocument()) return;
    if (!uris.length) { this.noticeResult(generation, '', 'CANCELLED'); return; }
    const bytes = this.readSelectedFile(uris[0]);
    if (!this.imageMime(bytes)) throw new Error('OCR_IMAGE_INVALID');
    const cancelled = (): boolean => this.disposed || generation !== this.noticeGeneration || !this.host.trustedDocument();
    const text = await this.documents.recognizeImage(bytes, cancelled);
    if (cancelled()) return;
    if (!text.trim()) { this.noticeResult(generation, '', 'NO_TEXT'); return; }
    if (text.length > 20000) throw new Error('OCR_TEXT_TOO_LONG');
    this.noticeResult(generation, text, 'none');
  }
  weekLongPressHaptic(): void {
    this.host.requireCall();
    try {
      vibrator.startVibration({ type: 'time', duration: 18 }, { id: 0, usage: 'touch' })
        .catch(() => {});
    } catch (_) {}
  }

  getDeepSeekConfig(): string { this.host.requireCall(); return this.vault.config(); }
  saveDeepSeekConfig(key: string, model: string): string {
    this.host.requireCall(); this.ai.cancel(); return this.vault.save(key, model);
  }
  clearDeepSeekConfig(): string {
    this.host.requireCall(); this.ai.cancel(); this.ai.clearAttachments(); return this.vault.clear();
  }
  requestDeepSeek(id: string, action: string, payload: string): boolean {
    this.host.requireCall();
    if (this.disposed || !/^[A-Za-z0-9-]{1,64}$/.test(id) || !['test', 'parse'].includes(action) || typeof payload !== 'string' || payload.length > 1000000) return false;
    this.ai.start(id, action, payload, (replyId: string, json: string) => {
      if (!this.disposed) this.host.run('if(window.SuikeDeepSeek)window.SuikeDeepSeek.receive(' + JSON.stringify(replyId) + ',JSON.parse(' + JSON.stringify(json) + '));');
    }).catch(() => {});
    return true;
  }
  cancelDeepSeek(): void { this.host.requireCall(); this.ai.cancel(); }
  clearDeepSeekAttachments(): void {
    this.host.requireCall(); this.documentGeneration++; this.pendingDocument = ''; this.ai.clearAttachments();
  }
  cancelDeepSeekDocument(): void {
    this.host.requireCall(); this.documentGeneration++; this.pendingDocument = '';
  }
  pickDeepSeekDocument(id: string): boolean {
    this.host.requireCall();
    if (this.disposed || this.pendingDocument || !/^[A-Za-z0-9-]{1,64}$/.test(id)) return false;
    this.pendingDocument = id;
    const generation = ++this.documentGeneration;
    this.pickDocument(id, generation).catch((error: Error) => {
      if (generation === this.documentGeneration) this.documentResult(id, { error: this.documentError((error as Error).message) });
    });
    return true;
  }
  storeDeepSeekDocument(id: string, json: string): boolean {
    this.host.requireCall();
    if (id !== this.pendingDocument || json.length > 24 * 1024 * 1024) return false;
    try {
      this.ai.keep(id, JSON.parse(json) as ContentPart[]);
      this.pendingDocument = '';
      return true;
    } catch (_) { return false; }
  }
  private documentResult(id: string, result: DocumentReply): void {
    if (this.pendingDocument === id) this.pendingDocument = '';
    if (!this.disposed) this.host.run('if(window.SuikeDeepSeek)window.SuikeDeepSeek.receiveDocument(' + JSON.stringify(id) + ',JSON.parse(' + JSON.stringify(JSON.stringify(result)) + '));');
  }
  private documentError(code: string): string {
    if (code === 'CANCELLED') return 'CANCELLED';
    if (code === 'DOCUMENT_SIZE' || code === 'ATTACHMENT_SIZE') return '附件超过 4 MB，请压缩或拆分后添加。';
    if (code === 'PDF_UNSUPPORTED') return '当前设备尚不支持 PDF 页图读取，请改用图片、Excel 或 Word。';
    if (code === 'PDF_PASSWORD_REQUIRED') return 'PDF 受密码保护，请另存为未加密的文件后添加。';
    if (code === 'PDF_TOO_MANY_PAGES') return 'PDF 超过 12 页，请保留课表所在页后重新添加。';
    if (['PDF_PAGE_TOO_LARGE','PDF_IMAGE_TOO_LARGE','PDF_PARTS_TOO_LARGE'].includes(code)) return 'PDF 页面图片较大，请压缩或分批添加；尚未发送给 AI。';
    if (['PDF_INVALID','PDF_PAGE_INVALID'].includes(code)) return 'PDF 文件或页面无法读取，请重新导出后添加。';
    return '附件未能完整读取，请重新选择或转换格式后添加。';
  }
  private async pickDocument(id: string, generation: number): Promise<void> {
    const options = new picker.DocumentSelectOptions();
    options.maxSelectNumber = 1;
    options.fileSuffixFilters = ['课表文件|.xlsx,.docx,.pdf,.png,.jpg,.jpeg,.webp'];
    const uris = await new picker.DocumentViewPicker(this.host.context()).select(options);
    if (this.disposed || generation !== this.documentGeneration || !this.host.trustedDocument()) return;
    if (!uris.length) { this.documentResult(id, { error: 'CANCELLED' }); return; }
    const name = decodeURIComponent(uris[0].split('/').pop() || '课表文件').split('?')[0];
    const extension = name.split('.').pop()?.toLowerCase() || '';
    if (!['xlsx', 'docx', 'pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(extension)) {
      this.documentResult(id, { name: name, error: '请使用 .xlsx、.docx、PDF、PNG、JPEG 或 WebP 文件。' }); return;
    }
    const bytes = this.readSelectedFile(uris[0]);
    if (this.disposed || generation !== this.documentGeneration || !this.host.trustedDocument()) return;
    if (extension === 'pdf') {
      const cancelled = (): boolean => this.disposed || generation !== this.documentGeneration || !this.host.trustedDocument();
      const parts = await this.documents.pdfParts(bytes, this.host.context().cacheDir, cancelled);
      if (cancelled()) return;
      this.ai.keep(id, parts);
      this.documentResult(id, { name: name, attachmentId: id, error: 'none' });
      return;
    }
    const encoded = new util.Base64Helper().encodeToStringSync(bytes);
    if (extension === 'xlsx' || extension === 'docx') {
      const script = 'if(window.SuikeOffice)window.SuikeOffice.receive(' + JSON.stringify(id) + ',' + JSON.stringify(name) + ',' + JSON.stringify(encoded) + ');else if(window.SuikeDeepSeek)window.SuikeDeepSeek.receiveDocument(' + JSON.stringify(id) + ',{error:"文档阅读器尚未加载，请重新打开应用。"});';
      this.host.execute(script).catch(() => {
        if (generation === this.documentGeneration) this.documentResult(id, { name: name, error: '文档未能传入阅读器，请重新添加。' });
      }).finally(() => {
        if (this.pendingDocument === id) this.pendingDocument = '';
      });
    } else {
      const mime = this.imageMime(bytes);
      if (!mime) { this.documentResult(id, { name: name, error: '图片格式无法确认，请另存为 PNG 或 JPEG。' }); return; }
      this.ai.keep(id, [{ type: 'image_url', image_url: { url: 'data:image/' + mime + ';base64,' + encoded } }]);
      this.documentResult(id, { name: name, attachmentId: id, error: 'none' });
    }
  }
  private readSelectedFile(uri: string): Uint8Array {
    let file: fs.File | undefined = undefined;
    try {
      file = fs.openSync(uri, fs.OpenMode.READ_ONLY);
      const size = fs.statSync(file.fd).size;
      // Bound the JS bridge transfer as well as the native read allocation.
      if (size <= 0 || size > 4 * 1024 * 1024) throw new Error('ATTACHMENT_SIZE');
      const bytes = new Uint8Array(size);
      let offset = 0;
      while (offset < size) {
        const buffer = new ArrayBuffer(size - offset);
        const count = fs.readSync(file.fd, buffer, { offset: offset, length: size - offset });
        if (count <= 0 || count > size - offset) throw new Error('ATTACHMENT_SHORT_READ');
        bytes.set(new Uint8Array(buffer, 0, count), offset);
        offset += count;
      }
      return bytes;
    } finally { if (file) fs.closeSync(file); }
  }
  private imageMime(bytes: Uint8Array): string {
    if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return 'png';
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
    if (bytes.length >= 12 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) return 'webp';
    return '';
  }
}
