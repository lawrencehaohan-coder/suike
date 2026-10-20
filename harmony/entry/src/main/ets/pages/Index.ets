import { common } from '@kit.AbilityKit';
import { webview } from '@kit.ArkWeb';
import { BridgeHost, isTrustedIndexUrl } from '../services/BridgeHost';
import { LocalBridge, LOCAL_BRIDGE_METHODS } from '../services/LocalBridge';

@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController();
  private host: BridgeHost = new BridgeHost(this.controller);
  private bridge: LocalBridge = new LocalBridge(this.host);
  private bootTimer: number = -1;
  @State private loadFailed: boolean = false;
  @StorageLink('suike.widget.launch') @Watch('onWidgetLaunch') private widgetLaunch: boolean = false;

  aboutToAppear(): void {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.host.attach(context, () => {
      this.loadFailed = false;
      this.clearBootTimer();
      this.host.deliverPortalCapture();
      this.host.deliverWidgetLaunch();
    });
    this.bridge.initialize(context);
    this.startBootTimer();
  }
  onPageShow(): void {
    this.host.activate();
    this.host.deliverPortalCapture();
    this.host.deliverWidgetLaunch();
    this.bridge.refreshFeatures();
  }
  private onWidgetLaunch(): void { this.host.deliverWidgetLaunch(); }
  aboutToDisappear(): void {
    this.clearBootTimer();
    this.bridge.dispose();
    this.host.deactivate();
    try { this.controller.deleteJavaScriptRegister('SuikeNative'); } catch (_) {}
  }
  private clearBootTimer(): void {
    if (this.bootTimer >= 0) clearTimeout(this.bootTimer);
    this.bootTimer = -1;
  }
  private startBootTimer(): void {
    this.clearBootTimer();
    this.bootTimer = setTimeout(() => {
      if (!this.host.ready()) this.loadFailed = true;
    }, 12000);
  }
  private reload(): void {
    this.loadFailed = false;
    this.bridge.resetSession();
    this.host.resetReady();
    this.startBootTimer();
    try { this.controller.refresh(); } catch (_) { this.loadFailed = true; }
  }
  build() {
    Stack() {
      // This Web can only navigate to the bundled index. School login uses pages/Portal.
      Web({ src: $rawfile('index.html'), controller: this.controller, renderMode: RenderMode.SYNC_RENDER })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .fileAccess(false)
        .mediaPlayGestureAccess(false)
        .javaScriptProxy({
          object: this.bridge, name: 'SuikeNative', methodList: LOCAL_BRIDGE_METHODS,
          controller: this.controller,
          permission: '{"javascriptProxyPermission":{"urlPermissionList":[{"scheme":"resource","host":"rawfile","port":"","path":""}]}}'
        })
        .onOverrideUrlLoading((request) => { return !isTrustedIndexUrl(request.getRequestUrl()); })
        .onLoadIntercept((event) => {
          if (!event) return true;
          return event.data.isMainFrame() && !isTrustedIndexUrl(event.data.getRequestUrl());
        })
        .onPageBegin((event) => {
          if (event && !isTrustedIndexUrl(event.url)) {
            this.host.deactivate();
            try { this.controller.stop(); } catch (_) {}
            this.loadFailed = true;
          }
        })
        .onPageEnd(() => { this.host.verifyReady(); })
        .onErrorReceive((event) => {
          if (event && event.request.isMainFrame()) this.loadFailed = true;
        })
        .onShowFileSelector((event) => {
          if (!event) return false;
          const mimeTypes=event.fileSelector.getMimeTypes();
          const media=mimeTypes.some((type: string)=>type.startsWith('image/')||type.startsWith('video/'));
          if(media)this.host.selectMediaInput(mimeTypes.some((type: string)=>type.startsWith('video/')),(uris: string[])=>{event.result.handleFileList(uris);});
          else this.host.selectBackupInput((uris: string[])=>{event.result.handleFileList(uris);});
          return true;
        })
        .width('100%')
        .height('100%')
      if (this.loadFailed) {
        Column({ space: 16 }) {
          Text('课表页面尚未加载完成').fontSize(18).fontWeight(FontWeight.Medium)
          Text('重新加载会读取本机保存的课表。').fontSize(14).fontColor('#666666')
          Button('重新加载').onClick(() => { this.reload(); })
        }
        .padding(28)
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .backgroundColor('#FDFDF8')
      }
    }
    .width('100%')
    .height('100%')
  }
}
