import { common } from '@kit.AbilityKit';
import { webview } from '@kit.ArkWeb';
import { router } from '@kit.ArkUI';
import { util } from '@kit.ArkTS';
import {
  SchoolProfile, allowedPortalUrl, capturePageUrl, decodeCollectorEvaluation,
  portalOrigin, schoolFromRegistry
} from '../domain/PortalPolicy';

interface PortalRoute { schoolId: string; }

@Entry
@Component
struct Portal {
  // This controller has no native JavaScript proxy, storage bridge, or AI/key API.
  private controller: webview.WebviewController = new webview.WebviewController();
  private contextValue: common.UIAbilityContext | undefined = undefined;
  private school: SchoolProfile | undefined = undefined;
  private navigationGeneration: number = 0;
  private captureSerial: number = 0;
  private captureTimer: number = -1;
  private disposed: boolean = false;
  @State private entryUrl: string = '';
  @State private schoolName: string = '学校网页';
  @State private originLabel: string = '';
  @State private status: string = '正在打开学校入口…';
  @State private canRead: boolean = false;
  @State private busy: boolean = false;

  aboutToAppear(): void {
    this.disposed = false;
    try {
      this.contextValue = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const params = router.getParams() as PortalRoute;
      const bytes = this.contextValue.resourceManager.getRawFileContentSync('schools.json');
      const raw = util.TextDecoder.create('utf-8').decodeWithStream(bytes);
      this.school = schoolFromRegistry(raw, params ? params.schoolId : '');
      this.schoolName = this.school.name;
      this.status = this.school.help;
      this.entryUrl = this.school.entryUrl;
      this.originLabel = portalOrigin(this.school, this.entryUrl) || '';
    } catch (_) { this.status = '学校配置未能读取，请返回随课重新选择学校。'; }
  }
  aboutToDisappear(): void {
    this.disposed = true;
    this.navigationGeneration++;
    this.clearCaptureResources();
    try { this.controller.stop(); } catch (_) {}
  }
  private clearCaptureResources(): void {
    this.captureSerial++;
    if (this.captureTimer >= 0) clearTimeout(this.captureTimer);
    this.captureTimer = -1;
  }
  private cancelCapture(): void {
    this.clearCaptureResources();
    if (!this.disposed) this.busy = false;
  }
  private rejectNavigation(): boolean {
    this.cancelCapture();
    if (!this.disposed) this.status = '已阻止学校名单以外或不加密的地址，请从学校入口进入。';
    return true;
  }
  private allowNavigation(url: string): boolean {
    if (this.disposed) return false;
    if (this.school && allowedPortalUrl(this.school, url)) return true;
    this.rejectNavigation();
    return false;
  }
  private pageStarted(url: string): void {
    if (this.disposed) return;
    this.navigationGeneration++;
    const wasBusy = this.busy;
    this.cancelCapture();
    this.canRead = false;
    if (!this.school || !allowedPortalUrl(this.school, url)) {
      try { this.controller.stop(); } catch (_) {}
      this.rejectNavigation();
      return;
    }
    this.originLabel = portalOrigin(this.school, url) || '';
    if (wasBusy) this.status = '页面已跳转，请等课表完整显示后重新读取。';
  }
  private pageFinished(url: string): void {
    if (this.disposed || !this.school) return;
    this.canRead = capturePageUrl(this.school, url);
    this.originLabel = portalOrigin(this.school, url) || '';
    if (this.canRead) this.status = '课表已打开。请确认已选全部周次，再点“读取课表”。';
  }
  private blockedResponse(): WebResourceResponse {
    const response = new WebResourceResponse();
    response.setResponseData('');
    response.setResponseEncoding('utf-8');
    response.setResponseMimeType('text/plain');
    response.setResponseCode(403);
    response.setReasonMessage('Blocked');
    return response;
  }
  private reopenEntry(): void {
    if (this.disposed || !this.school) return;
    this.navigationGeneration++;
    this.cancelCapture();
    this.status = this.school.help;
    this.canRead = false;
    try { this.controller.loadUrl(this.school.entryUrl); }
    catch (_) { this.status = '学校入口未能打开，请检查网络后重试。'; }
  }
  private captureError(code: string): string {
    if (code === 'WEEK_FILTER_ACTIVE') return '请将周次改为“全部 / 全学期”后重新读取。';
    if (code === 'UNSUPPORTED_PAGE') return '请先进入本校个人课表页面，再读取课表。';
    if (code === 'TABLE_MISSING' || code === 'TABLE_INVALID') return '尚未找到完整课表，请等页面加载完成后重试。';
    if (code === 'NO_COURSES') return '这份课表没有已排时段的课程，本地课表未改动。';
    if (code === 'CAPTURE_TOO_LARGE' || code === 'TOO_MANY_COURSES') return '课表内容超过读取上限，请检查学期与课表范围。';
    return '此网页课表尚不能完整确认，请检查学期、周次与表格后重试。';
  }
  private async capture(): Promise<void> {
    const school = this.school, context = this.contextValue;
    if (this.disposed || this.busy || !school || !context) return;
    let before: string;
    try { before = this.controller.getUrl(); }
    catch (_) { this.status = '网页尚未就绪，请稍后重试。'; return; }
    if (!capturePageUrl(school, before)) { this.status = '请先打开本校个人课表页面。'; return; }
    const generation = this.navigationGeneration;
    const serial = ++this.captureSerial;
    this.busy = true;
    this.status = '正在读取课程表，随后返回随课核对…';
    this.captureTimer = setTimeout(() => {
      if (!this.disposed && serial === this.captureSerial) {
        this.cancelCapture();
        this.status = '读取超时，请等课表完整显示后重试。';
      }
    }, 15000);
    try {
      // Asset name is selected from the packaged registry and checked against the fixed school mapping.
      const scriptBytes = context.resourceManager.getRawFileContentSync(school.collectorAsset);
      if (scriptBytes.byteLength > 128 * 1024) throw new Error('COLLECTOR_INVALID');
      const script = util.TextDecoder.create('utf-8').decodeWithStream(scriptBytes);
      if (generation !== this.navigationGeneration || before !== this.controller.getUrl()) throw new Error('NAVIGATION_CHANGED');
      const callback = await this.controller.runJavaScript(script);
      if (this.disposed || serial !== this.captureSerial) return;
      const after = this.controller.getUrl();
      if (generation !== this.navigationGeneration || before !== after || !capturePageUrl(school, after)) throw new Error('NAVIGATION_CHANGED');
      const capture = decodeCollectorEvaluation(callback, school);
      if (capture.error) { this.status = this.captureError(capture.error); return; }
      // Only a validated course envelope crosses back. Import remains a preview/confirmation flow.
      AppStorage.setOrCreate<string>('suike.portal.capture', JSON.stringify(capture));
      router.back();
    } catch (_) {
      if (!this.disposed && serial === this.captureSerial) this.status = '网页已变化或读取结果无法确认，本地课表未改动，请重新读取。';
    } finally {
      if (!this.disposed && serial === this.captureSerial) {
        if (this.captureTimer >= 0) clearTimeout(this.captureTimer);
        this.captureTimer = -1;
        this.busy = false;
      }
    }
  }
  build() {
    Column({ space: 0 }) {
      Row({ space: 12 }) {
        Button('返回').onClick(() => { this.cancelCapture(); router.back(); })
        Text(this.schoolName).fontSize(16).fontWeight(FontWeight.Medium).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
        Button('学校入口').onClick(() => { this.reopenEntry(); })
      }.padding(12).width('100%')
      Text(this.originLabel).fontSize(12).fontColor('#666666').width('100%').padding({ left: 14, right: 14, bottom: 6 })
      if (this.entryUrl !== '') {
        Web({ src: this.entryUrl, controller: this.controller, renderMode: RenderMode.SYNC_RENDER })
          .javaScriptAccess(true)
          .domStorageAccess(true)
          .fileAccess(false)
          .mixedMode(MixedMode.None)
          .multiWindowAccess(false)
          .onOverrideUrlLoading((request) => { return !this.allowNavigation(request.getRequestUrl()); })
          .onLoadIntercept((event) => { return !event || !this.allowNavigation(event.data.getRequestUrl()); })
          .onInterceptRequest((event) => {
            if (event && this.school && allowedPortalUrl(this.school, event.request.getRequestUrl())) return null;
            return this.blockedResponse();
          })
          .onPageBegin((event) => { if (event) this.pageStarted(event.url); })
          .onPageEnd((event) => { if (event) this.pageFinished(event.url); })
          .onSslErrorEventReceive((event) => {
            if (event) event.handler.handleCancel();
            if (this.disposed) return;
            this.cancelCapture(); this.canRead = false;
            this.status = '学校网页的安全连接未通过校验，已停止打开。';
          })
          .onSslErrorEvent((event) => {
            event.handler.handleCancel();
            if (this.disposed) return;
            this.cancelCapture(); this.canRead = false;
            this.status = '学校网页的安全连接未通过校验，已停止打开。';
          })
          .onHttpAuthRequest((event) => { if (event) event.handler.cancel(); return false; })
          .onClientAuthenticationRequest((event) => { if (event) event.handler.cancel(); })
          .onPermissionRequest((event) => { if (event) event.request.deny(); })
          .onShowFileSelector((event) => { if (event) event.result.handleFileList([]); return true; })
          .onErrorReceive((event) => {
            if (!this.disposed && event && event.request.isMainFrame()) {
              this.cancelCapture(); this.canRead = false;
              this.status = '学校网页未能载入，请检查网络后从学校入口重试。';
            }
          })
          .width('100%')
          .layoutWeight(1)
      } else {
        Blank().layoutWeight(1)
      }
      Text(this.status).fontSize(13).fontColor('#555555').width('100%').padding(12)
      Button(this.busy ? '正在读取…' : '读取课表')
        .enabled(this.canRead && !this.busy)
        .onClick(() => { this.capture(); })
        .margin({ left: 14, right: 14, bottom: 14 })
        .width('90%')
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#FDFDF8')
  }
}
