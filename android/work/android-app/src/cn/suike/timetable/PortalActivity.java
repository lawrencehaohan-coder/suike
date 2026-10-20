package cn.suike.timetable;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.ClientCertRequest;
import android.webkit.ConsoleMessage;
import android.webkit.GeolocationPermissions;
import android.webkit.HttpAuthHandler;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SafeBrowsingResponse;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * External portal screen. No JavaScript interface is installed in any WebView.
 * All credential entry stays inside the school page; collection requires a native button.
 */
public final class PortalActivity extends Activity {
    // VPN dashboard → rewritten portal → teaching system → personal timetable.
    private static final int MAX_WINDOWS = 5;
    private final List<WebView> windows = new ArrayList<>();
    private FrameLayout browserFrame;
    private TextView status;
    private Button readButton;
    private int captureGeneration;
    private boolean captureBusy;
    private boolean destroyed;
    private SchoolAdapterRegistry.Profile school;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable captureTimeout;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        setResult(RESULT_CANCELED);
        String id=getIntent().getStringExtra("suike.school");
        school=id==null?SchoolAdapterRegistry.defaultProfile():SchoolAdapterRegistry.find(id);
        if(school==null){finish();return;}
        try { createScreen(); }
        catch (RuntimeException | LinkageError error) { showInitializationFailure(); }
    }

    private void createScreen() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(245, 245, 244));
        root.setOnApplyWindowInsetsListener((view, insets) -> applyInsets(view, insets));
        setContentView(root);
        TextView title = new TextView(this);
        title.setText(school.name + " · 课表导入");
        title.setTextColor(Color.rgb(27, 27, 26));
        title.setTextSize(16);
        title.setTypeface(null, Typeface.BOLD);
        title.setPadding(dp(14), dp(10), dp(14), dp(4));
        root.addView(title, new LinearLayout.LayoutParams(-1, -2));
        TextView help = new TextView(this);
        help.setTag("portalImportGuide");
        help.setText(isJust()
                ? "登录校园 VPN → 进入教务系统 → 打开“个人课表”。\n等课表显示完整后，点下方“读取课表”，返回随课核对并确认导入。"
                : "登录学校网站，进入教务系统，打开个人课表并选择全部周次。\n等课表显示完整后，点下方“读取课表”，返回随课核对并确认导入。");
        help.setTextColor(Color.rgb(69, 69, 69));
        help.setTextSize(13);
        help.setLineSpacing(dp(2), 1);
        help.setPadding(dp(14), 0, dp(14), dp(8));
        root.addView(help, new LinearLayout.LayoutParams(-1, -2));
        TextView notice = new TextView(this);
        notice.setTag("portalLoadingNotice");
        notice.setText("学校网页由校园系统提供，加载速度受校园系统及网络影响。页面加载较慢时不代表随课卡顿，请耐心等待。");
        notice.setTextColor(Color.rgb(69, 69, 69));
        notice.setTextSize(12);
        notice.setLineSpacing(dp(2), 1);
        notice.setPadding(dp(14), 0, dp(14), dp(8));
        root.addView(notice, new LinearLayout.LayoutParams(-1, -2));
        LinearLayout navigation = new LinearLayout(this);
        navigation.setTag("portalNavigation");
        navigation.addView(button("返回网页", this::goBack), new LinearLayout.LayoutParams(0, -2, 1));
        Button entryButton = button(isJust() ? "校园 VPN" : "信息门户", () -> loadEntry(school.entryUrl));
        if (isJust()) {
            entryButton.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.BLACK));
            entryButton.setTextColor(Color.WHITE);
        }
        navigation.addView(entryButton, new LinearLayout.LayoutParams(0, -2, 1));
        if (isJust()) navigation.addView(button("直连（备用）", () -> loadEntry("https://my.just.edu.cn/")), new LinearLayout.LayoutParams(0, -2, 1));
        if(school.vpnUrl!=null && !school.vpnUrl.equals(school.entryUrl))
            navigation.addView(button("学校 VPN", () -> loadEntry(school.vpnUrl)), new LinearLayout.LayoutParams(0, -2, 1));
        root.addView(navigation, new LinearLayout.LayoutParams(-1, -2));
        status = new TextView(this);
        status.setTextSize(12);
        status.setTextColor(Color.rgb(76, 91, 86));
        status.setPadding(dp(14), dp(4), dp(14), dp(6));
        root.addView(status, new LinearLayout.LayoutParams(-1, -2));
        browserFrame = new FrameLayout(this);
        root.addView(browserFrame, new LinearLayout.LayoutParams(-1, 0, 1));
        LinearLayout actions = new LinearLayout(this);
        actions.addView(button("返回课表", this::finish), new LinearLayout.LayoutParams(0, -2, 1));
        readButton = button("读取课表", this::capture);
        actions.addView(readButton, new LinearLayout.LayoutParams(0, -2, 1));
        root.addView(actions, new LinearLayout.LayoutParams(-1, -2));
        installServiceWorkerPolicy();
        WebView main = createWindow();
        windows.add(main);
        showWindow(main);
        if (Build.VERSION.SDK_INT >= 33) Api33.registerBack(this);
        main.loadUrl(school.entryUrl);
        root.requestApplyInsets();
    }

    private void showInitializationFailure() {
        invalidateCapture();
        for (WebView view : windows) {
            try {
                if (view.getParent() instanceof android.view.ViewGroup)
                    ((android.view.ViewGroup) view.getParent()).removeView(view);
                view.destroy();
            } catch (RuntimeException | LinkageError ignored) { }
        }
        windows.clear();
        LinearLayout fallback = new LinearLayout(this);
        fallback.setOrientation(LinearLayout.VERTICAL);
        fallback.setPadding(dp(20), dp(48), dp(20), dp(24));
        TextView text = new TextView(this);
        text.setText("系统网页组件未能打开学校网页。请返回课表后重新尝试；本地课表没有改动。");
        fallback.addView(text);
        fallback.addView(button("返回课表", this::finish));
        setContentView(fallback);
    }

    private static WindowInsets applyInsets(View view, WindowInsets insets) {
        if (Build.VERSION.SDK_INT >= 30) return Api30.applyInsets(view, insets);
        view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
        return insets.consumeSystemWindowInsets();
    }

    private static final class Api30 {
        static WindowInsets applyInsets(View view, WindowInsets insets) {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsets.CONSUMED;
        }
    }

    private static final class Api33 {
        static void registerBack(PortalActivity activity) {
            activity.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, activity::goBack);
        }
    }

    private Button button(String text, Runnable action) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(13);
        button.setOnClickListener(view -> action.run());
        return button;
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private boolean isJust() { return "just".equals(school.id); }
    private String entryRetryHint() {
        return isJust() ? "请点“校园 VPN”重新进入。" : "请返回学校入口重新进入。";
    }
    private WebView current() { return windows.isEmpty() ? null : windows.get(windows.size() - 1); }

    private WebView createWindow() {
        WebView view = new WebView(this);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSafeBrowsingEnabled(true);
        android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(view, false);
        // Modern WebViews do not install these legacy bridges; removing them is harmless.
        view.removeJavascriptInterface("searchBoxJavaBridge_");
        view.removeJavascriptInterface("accessibility");
        view.removeJavascriptInterface("accessibilityTraversal");
        view.setWebViewClient(new PortalClient());
        view.setWebChromeClient(new PortalChrome());
        view.setDownloadListener((url, agent, disposition, mime, length) -> message("此页面不提供下载，请返回个人课表再读取。"));
        return view;
    }

    private void installServiceWorkerPolicy() {
        // ServiceWorkerClient is process-wide. Keep its allowlist in place; never make it permissive
        // on Activity close. The local timetable must retain its separate blockNetworkLoads=true.
        ServiceWorkerController controller = ServiceWorkerController.getInstance();
        controller.getServiceWorkerWebSettings().setAllowFileAccess(false);
        controller.getServiceWorkerWebSettings().setAllowContentAccess(false);
        controller.setServiceWorkerClient(new ServiceWorkerClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                return PortalNavigationPolicy.isAllowedHttps(school, request.getUrl().toString()) ? null : blockedResponse();
            }
        });
    }

    private static WebResourceResponse blockedResponse() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked",
                Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(new byte[0]));
    }

    private void showWindow(WebView view) {
        browserFrame.removeAllViews();
        browserFrame.addView(view, new FrameLayout.LayoutParams(-1, -1));
        invalidateCapture();
        updateOrigin(view);
    }

    private void loadEntry(String url) {
        if (!PortalNavigationPolicy.isAllowedHttps(school, url)) return;
        while (windows.size() > 1) closeWindow(current());
        WebView view = current();
        if (view != null) view.loadUrl(url);
    }

    private void updateOrigin(WebView view) {
        String origin = view == null ? null : PortalNavigationPolicy.origin(school, view.getUrl());
        message(origin == null ? "正在打开学校网页…" : origin.replace("https://", ""));
    }

    private void message(String text) { if (!destroyed && status != null) status.setText(text); }

    private void invalidateCapture() {
        if (captureTimeout != null) handler.removeCallbacks(captureTimeout);
        captureTimeout = null;
        captureGeneration++;
        captureBusy = false;
        if (readButton != null) readButton.setEnabled(true);
    }

    private void capture() {
        final WebView view = current();
        if (destroyed || captureBusy || view == null) return;
        final String page = view.getUrl();
        if (!PortalNavigationPolicy.isCapturePage(school, page)) {
            message("请先打开教务系统里的“个人课表”，等课表显示完整后再读取。");
            return;
        }
        final String expectedOrigin = PortalNavigationPolicy.origin(school, page);
        final int generation = ++captureGeneration;
        captureBusy = true;
        readButton.setEnabled(false);
        message("正在读取当前个人课表…");
        final String script;
        try { script = TeachingDomCollector.readBundledScript(this, school); }
        catch (Exception error) {
            invalidateCapture();
            message("个人课表读取适配尚未接入，此版本不会导入课程。");
            return;
        }
        captureTimeout = () -> {
            if (destroyed || generation != captureGeneration) return;
            invalidateCapture();
            message("读取课表超时，未导入任何课程。请稍后再试。");
        };
        handler.postDelayed(captureTimeout, 15000);
        // This is the sole collector entry point. It never executes page-provided script.
        try { view.evaluateJavascript(script, callback -> {
            if (destroyed || generation != captureGeneration || current() != view) return;
            if (captureTimeout != null) handler.removeCallbacks(captureTimeout);
            captureTimeout = null;
            captureBusy = false;
            readButton.setEnabled(true);
            if (!PortalNavigationPolicy.isCapturePage(school, view.getUrl()) ||
                    !expectedOrigin.equals(PortalNavigationPolicy.origin(school, view.getUrl()))) {
                message("页面已发生变化，请打开个人课表后重新读取。");
                return;
            }
            try {
                JSONObject capture = PortalCaptureContract.decodeEvaluation(callback);
                if(!school.captureSource.equals(capture.getString("source")))throw new org.json.JSONException("capture-school-mismatch");
                if (capture.has("error")) {
                    message(statusMessage(capture.getString("error")));
                    return;
                }
                // A disabled adapter cannot be enabled by a school page forging an "ok" value.
                if (!TeachingDomCollector.ADAPTER_READY) {
                    message("个人课表读取适配尚未接入，此版本不会导入课程。");
                    return;
                }
                String token = PortalCaptureStore.save(this, capture);
                setResult(RESULT_OK, new Intent().putExtra(PortalCaptureStore.EXTRA_TOKEN, token));
                finish();
            } catch (Exception error) {
                // Do not copy page content, URLs, response text or exception messages into diagnostics.
                message("读取结果不符合课表格式，未导入任何课程。请返回个人课表后再试。");
            }
        }); } catch (RuntimeException error) {
            invalidateCapture();
            message("系统网页组件未能读取课表，未导入任何课程。请稍后再试。");
        }
    }

    private String statusMessage(String value) {
        if("WEEK_FILTER_ACTIVE".equals(value))return "请将课表周次切换为全部后再读取。";
        if ("UNSUPPORTED_PAGE".equals(value)) return "请打开教务系统里的“个人课表”后再读取。";
        if ("TABLE_MISSING".equals(value)) return "个人课表尚未载入完成，请稍后再读取。";
        if ("TERM_MISMATCH".equals(value)) return "学期选择与已显示课表不同，请等待课表刷新后再读取。";
        if ("NO_COURSES".equals(value)) return "未读取到课程，请确认个人课表已载入。";
        if ("CAPTURE_TOO_LARGE".equals(value) || "TOO_MANY_COURSES".equals(value)) return "本次课表数据过多，未导入任何课程。";
        return "当前课表页面格式尚未支持，未导入任何课程。";
    }

    private void goBack() {
        WebView view = current();
        if (view != null && view.canGoBack()) view.goBack();
        else if (windows.size() > 1) closeWindow(view);
        else finish();
    }

    @Override public void onBackPressed() { goBack(); }

    private void closeWindow(WebView view) {
        if (view == null || !windows.contains(view) || windows.size() == 1) return;
        windows.remove(view);
        browserFrame.removeView(view);
        view.stopLoading();
        view.destroy();
        showWindow(current());
    }

    private final class PortalClient extends WebViewClient {
        private boolean allowNavigation(String url) {
            if (PortalNavigationPolicy.isAllowedHttps(school, url)) return true;
            invalidateCapture();
            message("当前地址不受支持。" + entryRetryHint());
            return false;
        }
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !allowNavigation(request.getUrl().toString());
        }
        @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return !allowNavigation(url); }
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return PortalNavigationPolicy.isAllowedHttps(school, request.getUrl().toString()) ? null : blockedResponse();
        }
        @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
            invalidateCapture();
            if (view == current()) message("正在加载学校网页，请耐心等待…");
            if (!PortalNavigationPolicy.isAllowedHttps(school, url)) {
                view.stopLoading();
                message("此地址不能在课表导入页面打开，请从学校入口重新进入。");
            }
        }
        @Override public void onPageFinished(WebView view, String url) {
            if (view == current() && !captureBusy) updateOrigin(view);
        }
        @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel();
            invalidateCapture();
            message("学校网页的安全连接未通过校验，已停止打开。");
        }
        @Override public void onReceivedHttpAuthRequest(WebView view, HttpAuthHandler handler, String host, String realm) {
            handler.cancel();
            message("请通过学校正常登录页面进入。此页面不处理额外的身份验证弹窗。");
        }
        @Override public void onReceivedClientCertRequest(WebView view, ClientCertRequest request) { request.cancel(); }
        @Override public void onSafeBrowsingHit(WebView view, WebResourceRequest request, int threatType, SafeBrowsingResponse response) {
            response.backToSafety(true);
            message("系统已阻止不安全的网页，请从学校入口重新进入。");
        }
        @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                invalidateCapture();
                message("学校网页未能载入，请检查网络后重试。" + entryRetryHint());
            }
        }
        @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // Multiple windows may share the failed renderer. Retire all of them together.
            invalidateCapture();
            for (WebView window : windows) {
                browserFrame.removeView(window);
                window.destroy();
            }
            windows.clear();
            readButton.setEnabled(false);
            message("系统网页组件已停止，请返回课表后重新打开导入。");
            return true;
        }
    }

    private final class PortalChrome extends WebChromeClient {
        @Override public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMessage) {
            if (!isUserGesture || windows.size() >= MAX_WINDOWS || destroyed || view != current() ||
                    !(resultMessage.obj instanceof WebView.WebViewTransport)) {
                message("网页尝试打开新窗口，请在当前主页面手动打开教务系统或个人课表。");
                return false;
            }
            WebView popup = createWindow();
            windows.add(popup);
            showWindow(popup);
            ((WebView.WebViewTransport) resultMessage.obj).setWebView(popup);
            resultMessage.sendToTarget();
            return true;
        }
        @Override public void onCloseWindow(WebView window) { closeWindow(window); }
        @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            callback.onReceiveValue(null);
            message("导入页面不接受文件上传，请返回个人课表后读取。");
            return true;
        }
        @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
        @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            callback.invoke(origin, false, false);
        }
        @Override public boolean onConsoleMessage(ConsoleMessage message) { return true; }
        @Override public boolean onJsAlert(WebView view, String url, String text, JsResult result) {
            if (!PortalNavigationPolicy.isAllowedHttps(school, url) || destroyed || isFinishing()) { result.cancel(); return true; }
            new AlertDialog.Builder(PortalActivity.this).setTitle("学校网页提示")
                    .setMessage(pageNotice(text)).setPositiveButton("知道了", (dialog, which) -> result.confirm())
                    .setOnCancelListener(dialog -> result.cancel()).show();
            return true;
        }
        @Override public boolean onJsConfirm(WebView view, String url, String text, JsResult result) {
            if (!PortalNavigationPolicy.isAllowedHttps(school, url) || destroyed || isFinishing()) { result.cancel(); return true; }
            new AlertDialog.Builder(PortalActivity.this).setTitle("学校网页确认")
                    .setMessage(pageNotice(text)).setPositiveButton("确定", (dialog, which) -> result.confirm())
                    .setNegativeButton("取消", (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel()).show();
            return true;
        }
        @Override public boolean onJsPrompt(WebView view, String url, String text, String defaultValue, JsPromptResult result) {
            result.cancel(); return true;
        }
        @Override public void onShowCustomView(View view, CustomViewCallback callback) { callback.onCustomViewHidden(); }
    }

    private static String pageNotice(String text) {
        if (text == null || text.isEmpty()) return "请按学校页面提示继续。";
        String bounded = text.substring(0, Math.min(text.length(), 1200));
        return bounded.replaceAll("[\\p{Cntrl}&&[^\\r\\n\\t]]", "");
    }

    @Override protected void onPause() { for (WebView view : windows) view.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); for (WebView view : windows) view.onResume(); }
    @Override protected void onDestroy() {
        destroyed = true;
        captureGeneration++;
        if (captureTimeout != null) handler.removeCallbacks(captureTimeout);
        for (WebView view : windows) { browserFrame.removeView(view); view.stopLoading(); view.destroy(); }
        windows.clear();
        super.onDestroy();
    }
}
