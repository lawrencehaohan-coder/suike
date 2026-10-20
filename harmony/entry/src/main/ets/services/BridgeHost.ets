import { common } from '@kit.AbilityKit';
import { webview } from '@kit.ArkWeb';
import { picker } from '@kit.CoreFileKit';
import { router, promptAction } from '@kit.ArkUI';

// Only the bundled main document owns the privileged bridge. Portal has its own Web/controller.
export function isTrustedIndexUrl(url: string): boolean {
  return /^resource:\/\/RAWFILE\/index\.html(?:[?#].*)?$/i.test(url);
}

export class BridgeHost {
  public controller: webview.WebviewController;
  private contextValue: common.UIAbilityContext | undefined = undefined;
  private active: boolean = true;
  private readyValue: boolean = false;
  private readyCallback: () => void = () => {};
  constructor(controller: webview.WebviewController) { this.controller = controller; }

  attach(context: common.UIAbilityContext, onReady: () => void): void {
    this.contextValue = context;
    this.readyCallback = onReady;
    this.active = true;
  }
  context(): common.UIAbilityContext {
    if (!this.contextValue) throw new Error('CONTEXT_UNAVAILABLE');
    return this.contextValue;
  }
  activate(): void { this.active = true; }
  deactivate(): void { this.active = false; this.readyValue = false; }
  ready(): boolean { return this.readyValue; }
  resetReady(): void { this.readyValue = false; }
  trustedDocument(): boolean {
    try { return this.active && isTrustedIndexUrl(this.controller.getUrl()); }
    catch (_) { return false; }
  }
  trustedCall(): boolean {
    try {
      return this.trustedDocument() && isTrustedIndexUrl(this.controller.getLastJavascriptProxyCallingFrameUrl());
    } catch (_) { return false; }
  }
  requireCall(): void {
    if (!this.trustedCall()) throw new Error('LOCAL_PAGE_REQUIRED');
  }
  pageReady(): void {
    this.requireCall();
    this.readyValue = true;
    this.readyCallback();
  }
  verifyReady(): void {
    if (!this.trustedDocument()) return;
    this.execute('Boolean(window.__suikeBoot && window.__suikeBoot.ready === true)')
      .then((result: string) => {
        if (this.trustedDocument() && result === 'true') {
          this.readyValue = true;
          this.readyCallback();
        }
      }).catch(() => {});
  }
  run(script: string): void {
    this.execute(script).catch(() => {});
  }
  execute(script: string): Promise<string> {
    if (!this.trustedDocument()) return Promise.reject(new Error('LOCAL_PAGE_REQUIRED'));
    try { return this.controller.runJavaScript(script); }
    catch (_) { return Promise.reject(new Error('WEB_UNAVAILABLE')); }
  }
  message(message: string): void {
    try { promptAction.showToast({ message: message, duration: 3500 }); } catch (_) {}
  }
  unavailable(message: string): false { this.message(message); return false; }
  openPortal(schoolId: string): boolean {
    this.requireCall();
    if (!/^[a-z0-9-]{1,40}$/.test(schoolId)) return false;
    router.pushUrl({ url: 'pages/Portal', params: { schoolId: schoolId } })
      .catch(() => { this.message('学校网页未能打开，请稍后重试。'); });
    return true; // Accepted navigation, never an import-success signal.
  }
  selectMediaInput(video: boolean, done: (uris: string[]) => void): void {
    if (!this.trustedDocument()) { done([]); return; }
    const options=new picker.DocumentSelectOptions();options.maxSelectNumber=1;
    options.fileSuffixFilters=video?['视频|.mp4,.webm']:['图片|.png,.jpg,.jpeg,.webp'];
    new picker.DocumentViewPicker(this.context()).select(options)
      .then((uris: string[])=>{done(this.trustedDocument()?uris.slice(0,1):[]);})
      .catch(()=>{done([]);});
  }
  selectBackupInput(done: (uris: string[]) => void): void {
    if (!this.trustedDocument()) { done([]); return; }
    const options = new picker.DocumentSelectOptions();
    options.maxSelectNumber = 1;
    options.fileSuffixFilters = ['JSON 备份|.json'];
    new picker.DocumentViewPicker(this.context()).select(options)
      .then((uris: string[]) => { done(this.trustedDocument() ? uris.slice(0, 1) : []); })
      .catch(() => { done([]); this.message('没有选取备份文件。'); });
  }
  deliverPortalCapture(): void {
    if (!this.readyValue || !this.trustedDocument()) return;
    const capture = AppStorage.get<string>('suike.portal.capture');
    if (!capture) return;
    // JSON is always passed as a quoted string and parsed in the trusted document.
    const script = '(function(){if(!window.SuikeImport)return false;return window.SuikeImport.receiveCapture(JSON.parse(' + JSON.stringify(capture) + '));})()';
    this.execute(script).then((result: string) => {
      if (this.trustedDocument() && (result === 'true' || result === 'false') && AppStorage.get<string>('suike.portal.capture') === capture) {
        AppStorage.delete('suike.portal.capture');
      }
    }).catch(() => { this.message('网页课表尚未送回，请返回课表后重试。'); });
  }
  deliverWidgetLaunch(): void {
    if (!this.readyValue || !this.trustedDocument() || AppStorage.get<boolean>('suike.widget.launch') !== true) return;
    this.execute('(function(){if(!window.SuikeFeatures)return false;window.SuikeFeatures.openToday();return true;})()')
      .then((result: string) => {
        if (this.trustedDocument() && result === 'true') AppStorage.set<boolean>('suike.widget.launch', false);
      }).catch(() => {});
  }
}
