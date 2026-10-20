package cn.suike.timetable;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebResourceError;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Self-contained offline shell. Requires only platform Android APIs (26+). */
public final class MainActivity extends Activity {
    private static final String BASE_URL = "https://suike.local/";
    private static final int OPEN_JSON = 2101;
    private static final int OPEN_MEDIA = 2110;
    private static final int SAVE_JSON = 2102;
    private static final int OPEN_TEACHING_PORTAL = 2103;
    private static final int OPEN_NOTICE_SCREENSHOT = 2104;
    private static final int OPEN_COURSE_DOCUMENT = 2105;
    private boolean courseDocumentPickerOpen, courseDocumentBusy;
    private WebView courseDocumentOwner;
    private String courseDocumentId;
    private int courseDocumentGeneration;
    private static final int REMINDER_PERMISSION = 2201;
    private static final int MAX_BACKUP_BYTES = 5 * 1024 * 1024;
    private static final long BOOT_TIMEOUT_MS = 15000;
    private static final long BOOT_POLL_MS = 350;
    // This probe returns only fixed enums, bounded source coordinates and booleans.
    // It must never read textContent, input values, storage, exception messages or console text.
    private static final String STARTUP_PROBE =
            "(function(){try{" +
            "var local=window.location.protocol==='https:'&&window.location.host==='suike.local',d=document;" +
            "if(!local)return JSON.stringify({actualLocal:false,phase:'unknown'});" +
            "var b=window.__suikeBoot||{},e=b.error||{};" +
            "function pick(v,list){return typeof v==='string'&&list.indexOf(v)>=0?v:'unknown';}" +
            "function n(v,max){return typeof v==='number'&&isFinite(v)&&v>=0&&v<=max?Math.floor(v):0;}" +
            "var phase=pick(b.phase,['bootstrap','seed','model','app','state','render','ready']);" +
            "var app=d.getElementById('app'),main=d.getElementById('mainContent'),days=d.getElementById('dayStrip'),grid=d.getElementById('weekGrid');" +
            "var agenda=d.getElementById('agenda'),pending=d.getElementById('agendaPending'),week=d.getElementById('weekSelect');" +
            "var daily=!!(agenda&&(agenda.querySelector('.agenda-card')||agenda.querySelector('.empty-state h3')))||!!(pending&&pending.querySelector('.pending-course'));" +
            "var structure=!!(days&&days.querySelectorAll('button.day-btn').length===7&&grid&&grid.querySelectorAll('.grid-day').length===7&&grid.querySelectorAll('.grid-time').length>=8&&week&&week.options.length>0&&daily);" +
            "var visible=false;if(app&&main){var r=main.getBoundingClientRect(),s=window.getComputedStyle(main),a=window.getComputedStyle(app);visible=r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&a.display!=='none'&&a.visibility!=='hidden';}" +
            "return JSON.stringify({actualLocal:true,phase:phase,ready:b.ready===true,marker:!!(d.documentElement&&d.documentElement.dataset&&d.documentElement.dataset.suikeReady==='true'),dom:structure,visible:visible," +
            "documentState:pick(d.readyState,['loading','interactive','complete']),kind:pick(e.kind,['script','promise','csp','resource','init'])," +
            "name:pick(e.name,['Error','SyntaxError','TypeError','ReferenceError','RangeError','SecurityError','URIError','EvalError','UnknownError'])," +
            "script:n(e.script,9),line:n(e.line,1000000),column:n(e.column,1000000)," +
            "directive:pick(e.directive,['default-src','script-src','script-src-elem','script-src-attr','style-src','style-src-elem','style-src-attr','img-src','font-src','connect-src','frame-src','child-src','worker-src','object-src','media-src','base-uri','form-action','manifest-src'])});" +
            "}catch(_){return JSON.stringify({phase:'unknown',probeFailure:true});}})()";
    private static final Set<String> ASSETS = new HashSet<>(Arrays.asList(
            "index.html", "styles.css", "model.js", "seed-data.js", "app.js",
            "icon.svg", "icon-192.png", "icon-512.png", "maskable-512.png", "fonts/suike_numbers_regular.ttf"));
    private volatile WebView webView;
    // Updated only on UI-thread navigations; bridge calls never call WebView.getUrl off-thread.
    private volatile boolean trustedLocalDocument;
    private ValueCallback<Uri[]> fileChooser;
    private boolean teachingPortalOpen;
    private WebView teachingPortalOwner;
    private boolean noticePickerOpen;
    private boolean noticeOcrBusy;
    private WebView noticePickerOwner;
    private boolean reminderPermissionPending;
    private WebView reminderPermissionOwner;
    private final Object featureSyncLock = new Object();
    private String pendingFeaturePayload;
    private WebView pendingFeatureOwner;
    private boolean featureSyncRunning;
    private final ExecutorService featureWorker = Executors.newSingleThreadExecutor(
            runnable -> new Thread(runnable, "suike-features"));
    private DeepSeekClient deepSeekClient;
    private synchronized DeepSeekClient deepSeek() {
        if (deepSeekClient == null) deepSeekClient = new DeepSeekClient(getApplicationContext());
        return deepSeekClient;
    }
    private void deepSeekReply(WebView owner, String id, JSONObject result) {
        runOnUiThread(() -> {
            if (!trustedBridge(owner) || !trustedPage()) return;
            owner.evaluateJavascript("window.SuikeDeepSeek&&window.SuikeDeepSeek.receive(" +
                    JSONObject.quote(id) + "," + result.toString() + ");", null);
        });
    }
    private final Object exportLock = new Object();
    private boolean exportBusy;
    private File exportFile;
    private String exportName;
    private boolean backPending;
    private String startupPhase = "Activity 创建";
    private boolean backCallbackRegistered;
    private boolean startupFailed;
    private boolean startupReady;
    private boolean pageReadyNotified;
    private boolean readyProbeInFlight;
    private int bootGeneration;
    private long bootDeadline;
    private String bootDiagnostics = "网页启动协议：尚未读取";
    private String nativeFailureCode = "none";
    private final Handler startupHandler = new Handler(Looper.getMainLooper());
    private Runnable startupPoll;

    private volatile boolean widgetLaunch;
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);setIntent(intent);
        widgetLaunch=intent!=null&&intent.getBooleanExtra("suike.widget.today",false);
        if(widgetLaunch&&webView!=null&&trustedPage()&&startupReady){
            widgetLaunch=false;evaluateFeatureCallback(webView,"if(typeof f.openToday==='function')f.openToday();");
        }
    }
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        widgetLaunch=getIntent()!=null&&getIntent().getBooleanExtra("suike.widget.today",false);
        try { startTimetable(savedInstanceState); }
        catch (RuntimeException | LinkageError error) { showStartupError(error); }
    }

    private void startTimetable(Bundle savedInstanceState) {
        cancelStartupWatch();
        startupFailed = false;
        startupReady = false;
        pageReadyNotified = false;
        bootDiagnostics = "网页启动协议：尚未读取";
        nativeFailureCode = "none";
        startupPhase = "窗口和系统边距";
        optional("输入法适配", () -> getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE));
        optional("系统栏颜色", () -> {
            getWindow().setStatusBarColor(Color.TRANSPARENT);
            getWindow().setNavigationBarColor(Color.TRANSPARENT);
        });
        if (Build.VERSION.SDK_INT >= 29) optional("导航栏对比度", () -> getWindow().setNavigationBarContrastEnforced(false));
        if (Build.VERSION.SDK_INT >= 30) optional("系统栏样式", () -> Api30.configureWindow(this));
        else optional("系统栏样式", () -> getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR));
        final FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(243, 246, 245));
        installInsets(root);
        startupPhase = "创建 WebView（系统网页组件）";
        webView = new WebView(this);
        if (Build.VERSION.SDK_INT < 29) optional("旧版网页图形兼容", () -> webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null));
        webView.setBackgroundColor(Color.rgb(243, 246, 245));
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        optional("请求系统边距", root::requestApplyInsets);
        startupPhase = "配置 WebView 和离线安全边界";
        configureWebView();
        startupPhase = "恢复未完成的备份保存";
        restoreExport(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 33 && !backCallbackRegistered) {
            optional("系统返回手势", () -> {
                Api33.registerBack(this);
                backCallbackRegistered = true;
            });
        }
        startupPhase = "读取离线课表文件";
        final String html;
        try {
            html = new String(readLimited(getAssets().open("index.html"), 8 * 1024 * 1024), StandardCharsets.UTF_8);
        } catch (IOException error) { throw new IllegalStateException("离线课表文件读取失败", error); }
        startupPhase = "载入离线课表网页";
        beginStartupWatch(webView);
        try {
            // Validate the complete bundled document before navigating. The local
            // request is served by LocalClient, preserving the same HTTPS storage origin.
            prepareHtml(html);
            // This new WebView can load only the fixed bundled local origin. Its renderer may
            // call the synchronous bridge before onPageStarted reaches the UI thread.
            trustedLocalDocument = true;
            webView.loadUrl(BASE_URL);
        } catch (IOException error) {
            trustedLocalDocument = false;
            throw new IllegalStateException("离线课表文件格式错误", error);
        } catch (RuntimeException | LinkageError error) {
            trustedLocalDocument = false;
            throw error;
        }
        if (!startupFailed && !startupReady) startupPhase = "等待课表界面初始化";
    }

    private static final class Api30 {
        static void configureWindow(Activity activity) {
            activity.getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = activity.getWindow().getInsetsController();
            if (controller != null) controller.setSystemBarsAppearance(
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        }
        static WindowInsets applyInsets(View view, WindowInsets insets) {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsets.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsets.CONSUMED;
        }
    }
    private static final class Api33 {
        static void registerBack(MainActivity activity) {
            activity.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, activity::handleBack);
        }
    }

    private void optional(String operation, Runnable action) {
        try { action.run(); }
        catch (RuntimeException | LinkageError error) { Log.w("Suike", "Skipped optional setting: " + operation + " / " + error.getClass().getName()); }
    }

    private void installInsets(FrameLayout root) {
        optional("系统边距监听", () -> root.setOnApplyWindowInsetsListener((view, insets) -> {
            try {
                if (Build.VERSION.SDK_INT >= 30) return Api30.applyInsets(view, insets);
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
                return insets.consumeSystemWindowInsets();
            } catch (RuntimeException | LinkageError error) {
                Log.w("Suike", "System insets unavailable / " + error.getClass().getName());
                optional("系统边距降级", () -> view.setFitsSystemWindows(true));
                return insets;
            }
        }));
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        // Blob media needs the resource loader. CSP and LocalClient still reject external resources.
        settings.setBlockNetworkLoads(false);
        settings.setBlockNetworkImage(false);
        settings.setAllowFileAccess(false);
        // SAF-selected content URIs must remain readable by the file input.
        // URL navigation/subresources using content: are independently blocked.
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setGeolocationEnabled(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        optional("关闭网页调试", () -> WebView.setWebContentsDebuggingEnabled(false));
        optional("移动网页视口", () -> settings.setUseWideViewPort(true));
        webView.addJavascriptInterface(new NativeBackupBridge(webView), "SuikeNative");
        webView.setWebViewClient(new LocalClient());
        webView.setWebChromeClient(new LocalChrome());
        webView.setDownloadListener((url, userAgent, disposition, mimeType, length) ->
                toast("请通过设置中的“导出备份”保存 JSON 文件"));
    }

    private void cancelStartupWatch() {
        bootGeneration++;
        if (startupPoll != null) startupHandler.removeCallbacks(startupPoll);
        startupPoll = null;
        readyProbeInFlight = false;
    }

    private boolean canCheckStartup(WebView view, int generation) {
        return view == webView && generation == bootGeneration && !startupFailed && !startupReady && !isFinishing() && !isDestroyed();
    }

    private void beginStartupWatch(final WebView view) {
        final int generation = bootGeneration;
        bootDeadline = SystemClock.elapsedRealtime() + BOOT_TIMEOUT_MS;
        startupPoll = new Runnable() {
            @Override public void run() {
                if (!canCheckStartup(view, generation)) return;
                // Allow one final asynchronous probe at the deadline. A stalled callback
                // still reaches the hard limit instead of leaving an endless blank page.
                if (SystemClock.elapsedRealtime() >= bootDeadline + 1000) {
                    failStartupReadiness("等待课表初始化超时；诊断记录了最后可确认的启动阶段");
                    return;
                }
                requestStartupProbe(view, generation);
                if (canCheckStartup(view, generation)) startupHandler.postDelayed(this, BOOT_POLL_MS);
            }
        };
        startupHandler.post(startupPoll);
    }

    private static String enumValue(JSONObject object, String key, String... allowed) {
        Object value = object.opt(key);
        if (value instanceof String) for (String candidate : allowed) if (candidate.equals(value)) return candidate;
        return "unknown";
    }
    private static int coordinate(JSONObject object, String key, int max) {
        Object value = object.opt(key);
        if (!(value instanceof Number)) return 0;
        double number = ((Number) value).doubleValue();
        return !Double.isNaN(number) && !Double.isInfinite(number) && number >= 0 && number <= max ? (int) number : 0;
    }
    private static boolean trueValue(JSONObject object, String key) { return Boolean.TRUE.equals(object.opt(key)); }

    private void requestStartupProbe(final WebView view, final int generation) {
        if (!canCheckStartup(view, generation) || readyProbeInFlight) return;
        if (!trustedPage()) {
            bootDiagnostics = "网页启动协议：等待应用内页面；readyHandshake=" + pageReadyNotified;
            return;
        }
        readyProbeInFlight = true;
        try {
            view.evaluateJavascript(STARTUP_PROBE, result -> {
                if (!canCheckStartup(view, generation)) return;
                readyProbeInFlight = false;
                try {
                    if (result == null || result.length() > 4096) throw new IllegalArgumentException("Boot probe response");
                    Object decoded = new JSONTokener(result).nextValue();
                    JSONObject snapshot = decoded instanceof String ? new JSONObject((String) decoded) : decoded instanceof JSONObject ? (JSONObject) decoded : null;
                    if (snapshot == null) throw new IllegalArgumentException("Boot probe format");
                    String phase = enumValue(snapshot, "phase", "bootstrap", "seed", "model", "app", "state", "render", "ready");
                    String documentState = enumValue(snapshot, "documentState", "loading", "interactive", "complete");
                    String kind = enumValue(snapshot, "kind", "script", "promise", "csp", "resource", "init");
                    String name = enumValue(snapshot, "name", "Error", "SyntaxError", "TypeError", "ReferenceError", "RangeError", "SecurityError", "URIError", "EvalError", "UnknownError");
                    String directive = enumValue(snapshot, "directive", "default-src", "script-src", "script-src-elem", "script-src-attr", "style-src", "style-src-elem", "style-src-attr", "img-src", "font-src", "connect-src", "frame-src", "child-src", "worker-src", "object-src", "media-src", "base-uri", "form-action", "manifest-src");
                    boolean actualLocal = trueValue(snapshot, "actualLocal"), ready = trueValue(snapshot, "ready"), marker = trueValue(snapshot, "marker"), dom = trueValue(snapshot, "dom"), visible = trueValue(snapshot, "visible");
                    bootDiagnostics = "网页启动协议：actualLocal=" + actualLocal + "; phase=" + phase + "; document=" + documentState +
                            "; ready=" + ready + "; readyHandshake=" + pageReadyNotified + "; marker=" + marker + "; renderedStructure=" + dom + "; visible=" + visible;
                    if (!"unknown".equals(kind)) bootDiagnostics += "\n已捕获网页异常：kind=" + kind + "; name=" + name +
                            "; script=" + coordinate(snapshot, "script", 9) + "; line=" + coordinate(snapshot, "line", 1000000) +
                            "; column=" + coordinate(snapshot, "column", 1000000) + "; directive=" + directive;
                    if (trueValue(snapshot, "probeFailure")) bootDiagnostics += "\n结构检查执行失败（未读取异常消息）";
                    if (actualLocal && ready && marker && dom && visible && "ready".equals(phase)) {
                        startupReady = true;
                        startupPhase = "课表界面已就绪";
                        cancelStartupWatch();
                    } else if ("init".equals(kind)) {
                        failStartupReadiness("课表脚本报告初始化失败；错误类型和代码位置见诊断");
                    } else if (SystemClock.elapsedRealtime() >= bootDeadline) {
                        failStartupReadiness("课表在限定时间内未完成初始化；最后启动阶段和捕获的错误见诊断");
                    }
                } catch (Exception malformedProbe) {
                    // Never log the raw callback or parser exception: either could
                    // contain strings supplied by the page.
                    bootDiagnostics = "网页启动协议：检查结果不可解析；readyHandshake=" + pageReadyNotified;
                    if (SystemClock.elapsedRealtime() >= bootDeadline) failStartupReadiness("无法确认课表界面已初始化");
                }
            });
        } catch (RuntimeException | LinkageError error) {
            readyProbeInFlight = false;
            startupPhase = "课表界面初始化检查";
            showStartupError(error);
        }
    }

    private void failStartupReadiness(String reason) {
        startupPhase = "课表界面初始化";
        showStartupError(new IllegalStateException(reason));
    }

    private static String safeNativeTrace(Throwable error) {
        StringBuilder trace = new StringBuilder();
        Throwable current = error;
        for (int depth = 0; current != null && depth < 6; depth++) {
            if (depth > 0) trace.append("Caused by: ");
            trace.append(current.getClass().getName()).append('\n');
            StackTraceElement[] frames = current.getStackTrace();
            for (int i = 0; i < frames.length && i < 40; i++) {
                StackTraceElement frame = frames[i];
                // Code coordinates only; intentionally exclude exception messages.
                trace.append("  at ").append(frame.getClassName()).append('.').append(frame.getMethodName())
                        .append('(').append(frame.getFileName()).append(':').append(frame.getLineNumber()).append(")\n");
            }
            Throwable cause = current.getCause();
            if (cause == current) break;
            current = cause;
        }
        return trace.toString();
    }

    private String errorDetails(Throwable error) {
        StringWriter text = new StringWriter();
        PrintWriter output = new PrintWriter(text);
        output.println("随课启动诊断（不包含课表或备份内容）");
        output.println("阶段：" + startupPhase);
        output.println("Android：" + Build.VERSION.RELEASE + " / API " + Build.VERSION.SDK_INT);
        output.println("设备：" + Build.MANUFACTURER + " " + Build.MODEL);
        try {
            PackageInfo provider = WebView.getCurrentWebViewPackage();
            output.println("WebView：" + (provider == null ? "未找到系统网页组件" : provider.packageName + " " + provider.versionName));
        } catch (RuntimeException | LinkageError providerError) {
            output.println("WebView 信息不可用：" + providerError.getClass().getName());
        }
        output.println(bootDiagnostics);
        output.println("原生错误码：" + nativeFailureCode);
        output.println("原生异常代码位置（异常消息已省略）：");
        output.print(safeNativeTrace(error));
        output.flush();
        return text.toString();
    }

    private void saveErrorDetails(String details) {
        Log.e("Suike", details);
        try (OutputStream output = new FileOutputStream(new File(getFilesDir(), "startup-error.txt"))) {
            output.write(details.getBytes(StandardCharsets.UTF_8));
        } catch (IOException | RuntimeException | LinkageError error) { Log.w("Suike", "Could not save startup diagnostic / " + error.getClass().getName()); }
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void showStartupError(Throwable error) {
        if (startupFailed) return;
        startupFailed = true;
        final String details = errorDetails(error);
        saveErrorDetails(details);
        disposeWebView();
        if (isFinishing() || isDestroyed()) return;
        try {
            FrameLayout frame = new FrameLayout(this);
            frame.setBackgroundColor(Color.rgb(243, 246, 245));
            installInsets(frame);
            ScrollView scroll = new ScrollView(this);
            LinearLayout content = new LinearLayout(this);
            content.setOrientation(LinearLayout.VERTICAL);
            content.setPadding(dp(24), dp(28), dp(24), dp(28));
            scroll.addView(content);
            frame.addView(scroll, new FrameLayout.LayoutParams(-1, -1));
            TextView title = new TextView(this);
            title.setText("课表暂时无法打开"); title.setTextSize(23); title.setTextColor(Color.rgb(24, 50, 43));
            content.addView(title);
            TextView message = new TextView(this);
            String reason = startupPhase.contains("WebView") ? "系统网页组件未能正常工作。" : "启动在“" + startupPhase + "”时遇到问题。";
            message.setText(reason + "\n你的本地课表和修改没有被清除。可以重试，或复制错误详情用于排查。\n\n简洁课表展示安装包内的原始课表，只读，不包含你之后的编辑。");
            message.setTextSize(16); message.setTextColor(Color.rgb(50, 65, 60));
            message.setPadding(0, dp(16), 0, dp(16)); content.addView(message);
            TextView fullError = new TextView(this);
            fullError.setText(details); fullError.setTextSize(12); fullError.setTextIsSelectable(true);
            fullError.setTextColor(Color.rgb(65, 65, 65)); fullError.setVisibility(View.GONE);
            Button retry = new Button(this); retry.setText("重试打开课表");
            retry.setOnClickListener(view -> {
                try { startTimetable(null); }
                catch (RuntimeException | LinkageError retryError) { showStartupError(retryError); }
            });
            content.addView(retry);
            Button simple = new Button(this); simple.setText("打开简洁课表（原始课表，只读）");
            simple.setOnClickListener(view -> {
                try {
                    View timetable = NativeTimetableView.create(this);
                    FrameLayout simpleFrame = new FrameLayout(this);
                    simpleFrame.setBackgroundColor(Color.rgb(243, 246, 245));
                    installInsets(simpleFrame);
                    LinearLayout simpleContent = new LinearLayout(this);
                    simpleContent.setOrientation(LinearLayout.VERTICAL);
                    Button returnToError = new Button(this);
                    returnToError.setText("返回错误详情");
                    returnToError.setOnClickListener(back -> {
                        try {
                            setContentView(frame);
                            optional("恢复诊断界面边距", frame::requestApplyInsets);
                        } catch (RuntimeException | LinkageError returnError) {
                            Log.e("Suike", "Could not restore diagnostic screen / " + returnError.getClass().getName());
                            toast("诊断界面暂时无法恢复，请重新打开应用");
                        }
                    });
                    LinearLayout.LayoutParams returnParams = new LinearLayout.LayoutParams(-1, -2);
                    returnParams.setMargins(dp(16), dp(8), dp(16), 0);
                    simpleContent.addView(returnToError, returnParams);
                    simpleContent.addView(timetable, new LinearLayout.LayoutParams(-1, 0, 1));
                    simpleFrame.addView(simpleContent, new FrameLayout.LayoutParams(-1, -1));
                    setContentView(simpleFrame);
                    optional("简洁课表边距", simpleFrame::requestApplyInsets);
                }
                catch (Exception | LinkageError fallbackError) {
                    startupPhase = "打开原始只读课表";
                    String fallbackDetails = details + "\n\n" + errorDetails(fallbackError);
                    fullError.setText(fallbackDetails); fullError.setVisibility(View.VISIBLE);
                    saveErrorDetails(fallbackDetails);
                    toast("简洁课表也未能打开，请复制错误详情");
                }
            });
            content.addView(simple);
            Button copy = new Button(this); copy.setText("复制错误详情");
            copy.setOnClickListener(view -> {
                try {
                    ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    if (clipboard == null) throw new IllegalStateException("系统剪贴板不可用");
                    clipboard.setPrimaryClip(ClipData.newPlainText("随课错误详情", fullError.getText()));
                    toast("已复制错误详情");
                } catch (RuntimeException | LinkageError clipboardError) { toast("复制失败，可展开错误详情查看"); }
            });
            content.addView(copy);
            Button expand = new Button(this); expand.setText("查看错误详情");
            expand.setOnClickListener(view -> {
                boolean visible = fullError.getVisibility() == View.VISIBLE;
                fullError.setVisibility(visible ? View.GONE : View.VISIBLE);
                expand.setText(visible ? "查看错误详情" : "收起错误详情");
            });
            content.addView(expand); content.addView(fullError);
            setContentView(frame);
            optional("诊断界面边距", frame::requestApplyInsets);
        } catch (RuntimeException | LinkageError uiError) {
            Log.e("Suike", "Could not create complete diagnostic screen / " + uiError.getClass().getName());
            try {
                TextView text = new TextView(this);
                text.setText("课表启动失败，本地数据未清除。\n\n" + details);
                text.setTextIsSelectable(true); text.setPadding(dp(24), dp(48), dp(24), dp(24));
                ScrollView scroll = new ScrollView(this); scroll.addView(text); setContentView(scroll);
            } catch (RuntimeException | LinkageError lastError) { Log.e("Suike", "Native diagnostic screen unavailable / " + lastError.getClass().getName()); }
        }
    }

    private void disposeWebView() {
        cancelStartupWatch();
        trustedLocalDocument = false;
        final WebView previous = webView;
        webView = null;
        teachingPortalOwner = null;
        backPending = false;
        optional("结束备份选择器", () -> completeImport(null));
        if (previous == null) return;
        optional("移除网页视图", () -> {
            if (previous.getParent() instanceof ViewGroup) ((ViewGroup) previous.getParent()).removeView(previous);
        });
        optional("移除备份桥接", () -> previous.removeJavascriptInterface("SuikeNative"));
        optional("停止网页", previous::stopLoading);
        optional("销毁网页组件", previous::destroy);
    }

    private static boolean isLocal(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && "suike.local".equals(uri.getAuthority());
    }
    private boolean trustedPage() { return webView != null && isLocal(Uri.parse(webView.getUrl() == null ? "" : webView.getUrl())); }
    private boolean trustedBridge(WebView owner) {
        return owner != null && owner == webView && trustedLocalDocument && !isFinishing() && !isDestroyed();
    }

    private static String prepareHtml(String html) throws IOException {
        String policy = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; " +
                "script-src 'unsafe-inline' https://suike.local; style-src 'unsafe-inline' https://suike.local; " +
                "img-src data: blob: https://suike.local; font-src https://suike.local; connect-src 'none'; " +
                "frame-src 'none'; child-src 'none'; worker-src blob:; object-src 'none'; media-src blob:; " +
                "base-uri 'none'; form-action 'none'; manifest-src 'none'\">";
        String nativeUi = "<script>document.documentElement.dataset.nativeApp='android';" +
                "document.addEventListener('DOMContentLoaded',function(){" +
                "var title=document.getElementById('installTitle');" +
                "var card=title&&title.closest('section.settings-card');" +
                "if(card&&card.querySelector('#installApp'))card.hidden=true;});</script>";
        int head = html.toLowerCase(Locale.ROOT).indexOf("<head");
        int end = head < 0 ? -1 : html.indexOf('>', head);
        if (end < 0) throw new IOException("Missing head");
        return html.substring(0, end + 1) + policy + nativeUi + html.substring(end + 1);
    }

    private final class LocalClient extends WebViewClient {
        @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
            if (view == webView) trustedLocalDocument = isLocal(Uri.parse(url));
        }
        @Override public void onPageFinished(WebView view, String url) {
            if (view == webView) trustedLocalDocument = isLocal(Uri.parse(url));
            if (view == webView && !startupFailed && !startupReady && !isFinishing() && !isDestroyed() && isLocal(Uri.parse(url)))
                requestStartupProbe(view, bootGeneration);
        }
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (isLocal(request.getUrl())) return false;
            if (request.isForMainFrame()) toast("随课只打开应用内的离线课表");
            return true;
        }
        @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
            if (isLocal(Uri.parse(url))) return false;
            toast("随课只打开应用内的离线课表"); return true;
        }
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!isLocal(uri) || !"GET".equals(request.getMethod()) || uri.getQuery() != null) return denied();
            String path = uri.getPath();
            String name = path == null || "/".equals(path) ? "index.html" : path.startsWith("/") ? path.substring(1) : path;
            if (!ASSETS.contains(name) && !AmbientAssets.allows(name)) return denied();
            try {
                InputStream content;
                if ("index.html".equals(name)) {
                    String html = new String(readLimited(getAssets().open(name), 8 * 1024 * 1024), StandardCharsets.UTF_8);
                    content = new ByteArrayInputStream(prepareHtml(html).getBytes(StandardCharsets.UTF_8));
                } else content = getAssets().open(name);
                String mime = mimeFor(name);
                WebResourceResponse response = new WebResourceResponse(mime, mime.startsWith("image/png") || mime.startsWith("image/webp") || mime.startsWith("font/") ? null : "UTF-8", content);
                return response;
            } catch (Exception error) { return denied(); }
        }
        @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) { handler.cancel(); }
        @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (view != webView || startupFailed || isFinishing() || isDestroyed() || !request.isForMainFrame() || !isLocal(request.getUrl())) return;
            startupPhase = "加载离线课表主页面";
            nativeFailureCode = "main-frame-" + error.getErrorCode();
            showStartupError(new IllegalStateException("系统网页组件载入失败，错误码 " + error.getErrorCode()));
        }
        @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            if (view == webView) {
                startupPhase = "WebView 网页渲染进程";
                nativeFailureCode = detail.didCrash() ? "renderer-crashed" : "renderer-reclaimed";
                showStartupError(new IllegalStateException(detail.didCrash() ? "系统网页渲染进程异常退出" : "系统回收了网页渲染进程"));
            } else {
                optional("移除失效网页视图", () -> {
                    if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
                });
                optional("销毁失效网页视图", view::destroy);
            }
            return true;
        }
        private WebResourceResponse denied() {
            return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", null,
                    new ByteArrayInputStream(new byte[0]));
        }
    }

    private final class LocalChrome extends WebChromeClient {
        @Override public boolean onConsoleMessage(ConsoleMessage message) {
            // Consume console output without reading or recording its text.
            // Startup failures come from the restricted bootstrap protocol.
            return true;
        }
        @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (!trustedPage()) { callback.onReceiveValue(null); return true; }
            if (noticePickerOpen || noticeOcrBusy) { callback.onReceiveValue(null); toast("请先完成通知截图识别"); return true; }
            if (fileChooser != null) fileChooser.onReceiveValue(null);
            synchronized (exportLock) {
                if (exportBusy) { callback.onReceiveValue(null); toast("请先完成当前备份保存"); return true; }
            }
            fileChooser = callback;
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            String accepted = String.join(",", params.getAcceptTypes());
            boolean media = accepted.contains("image/") || accepted.contains("video/");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, media
                    ? (accepted.contains("video/") ? new String[]{"video/mp4","video/webm"} : new String[]{"image/png","image/jpeg","image/webp"})
                    : new String[]{"application/json","text/json","text/plain","application/octet-stream"});
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try { startActivityForResult(intent, media ? OPEN_MEDIA : OPEN_JSON); }
            catch (ActivityNotFoundException error) { completeImport(null); toast("找不到系统文件选择器，无法导入备份"); }
            return true;
        }
        @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
            if (!isLocal(Uri.parse(url)) || isFinishing()) { result.cancel(); return true; }
            new AlertDialog.Builder(MainActivity.this).setTitle("随课").setMessage(message)
                    .setPositiveButton("知道了", (dialog, which) -> result.confirm())
                    .setOnCancelListener(dialog -> result.cancel()).show(); return true;
        }
        @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
            if (!isLocal(Uri.parse(url)) || isFinishing()) { result.cancel(); return true; }
            new AlertDialog.Builder(MainActivity.this).setTitle("随课").setMessage(message)
                    .setPositiveButton("确定", (dialog, which) -> result.confirm())
                    .setNegativeButton("取消", (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel()).show(); return true;
        }
        @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
        @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) { callback.invoke(origin, false, false); }
    }

    /** Local-only bridge. Never installed on the school portal or any external document. */
    public final class NativeBackupBridge {
        private final WebView owner;
        private NativeBackupBridge(WebView owner) { this.owner = owner; }
        @JavascriptInterface public String getDeepSeekConfig() {
            return (trustedBridge(owner) ? deepSeek().config() : DeepSeekClient.error("UNTRUSTED")).toString();
        }
        @JavascriptInterface public String saveDeepSeekConfig(String key, String model) {
            return (trustedBridge(owner) ? deepSeek().save(key, model) : DeepSeekClient.error("UNTRUSTED")).toString();
        }
        @JavascriptInterface public String clearDeepSeekConfig() {
            return (trustedBridge(owner) ? deepSeek().clear() : DeepSeekClient.error("UNTRUSTED")).toString();
        }
        @JavascriptInterface public void cancelDeepSeek() {
            if (trustedBridge(owner)) deepSeek().cancel();
        }
        @JavascriptInterface public void cancelDeepSeekDocument() {
            if (!trustedBridge(owner)) return;
            runOnUiThread(() -> { courseDocumentGeneration++; courseDocumentId=null; });
        }
        @JavascriptInterface public boolean pickDeepSeekDocument(String id) {
            // Only the local document can invoke Android's explicit file picker.
            if (!trustedBridge(owner) || id==null || !id.matches("[A-Za-z0-9-]{1,64}")) return false;
            runOnUiThread(() -> {
                if (!trustedBridge(owner)||!trustedPage()) return;
                if (courseDocumentPickerOpen||courseDocumentBusy||noticePickerOpen||noticeOcrBusy||teachingPortalOpen||fileChooser!=null) {
                    deliverCourseDocument(owner,id,"","请先完成当前文件读取。",""); return;
                }
                courseDocumentOwner=owner;courseDocumentId=id;courseDocumentGeneration++;courseDocumentPickerOpen=true;
                Intent picker=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                picker.putExtra(Intent.EXTRA_LOCAL_ONLY,true);
                picker.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"image/*","application/pdf",
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        "application/vnd.ms-excel","application/msword"});
                try { startActivityForResult(picker,OPEN_COURSE_DOCUMENT); }
                catch(RuntimeException error) { courseDocumentPickerOpen=false;deliverCourseDocument(owner,id,"","文件选择未能打开。",""); }
            }); return true;
        }
        @JavascriptInterface public void clearDeepSeekAttachments() {
            if (trustedBridge(owner)) CourseDocumentReader.clearAttachments();
        }
        @JavascriptInterface public boolean requestDeepSeek(String id, String action, String payload) {
            if (!trustedBridge(owner) || id == null || !id.matches("[A-Za-z0-9-]{1,64}") ||
                    !("test".equals(action) || "parse".equals(action)) || payload == null || payload.length() > 65536) return false;
            runOnUiThread(() -> {
                if (!trustedBridge(owner) || !trustedPage() || startupFailed || !startupReady) return;
                if (!deepSeek().start(action, payload, result -> deepSeekReply(owner, id, result)))
                    deepSeekReply(owner, id, DeepSeekClient.error("BUSY"));
            });
            return true;
        }
        @JavascriptInterface public void pageReady() {
            runOnUiThread(() -> {
                if (owner != webView || startupFailed || startupReady || isFinishing() || isDestroyed() || !trustedPage()) return;
                pageReadyNotified = true;
                requestStartupProbe(owner, bootGeneration);
            });
        }
        @JavascriptInterface public void weekLongPressHaptic() {
            runOnUiThread(() -> {
                if (!trustedBridge(owner) || !trustedPage() || startupFailed || !startupReady) return;
                owner.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS);
            });
        }
        @JavascriptInterface public void openTeachingPortal() { openTeachingPortalForSchool(SchoolAdapterRegistry.DEFAULT_SCHOOL); }
        @JavascriptInterface public void openTeachingPortalForSchool(String schoolId) {
            if (SchoolAdapterRegistry.find(schoolId) == null) return;
            runOnUiThread(() -> {
                if (owner != webView || startupFailed || !startupReady || isFinishing() || isDestroyed() || !trustedPage()) return;
                if (teachingPortalOpen) { toast("学校网页已经打开，请先完成或返回"); return; }
                if (noticePickerOpen || noticeOcrBusy || courseDocumentPickerOpen || courseDocumentBusy) { toast("请先完成当前文件读取"); return; }
                if (fileChooser != null) { toast("请先完成当前备份导入"); return; }
                synchronized (exportLock) {
                    if (exportBusy) { toast("请先完成当前备份保存"); return; }
                }
                teachingPortalOpen = true;
                teachingPortalOwner = owner;
                try { startActivityForResult(new Intent(MainActivity.this, PortalActivity.class).putExtra("suike.school", schoolId), OPEN_TEACHING_PORTAL); }
                catch (RuntimeException | LinkageError error) {
                    teachingPortalOpen = false;
                    teachingPortalOwner = null;
                    toast("暂时无法打开学校网页，请稍后重试");
                }
            });
        }
        @JavascriptInterface public boolean syncFeatures(String payload) {
            if (!trustedBridge(owner) || payload == null || payload.length() > FeatureRules.MAX_BYTES
                    || payload.getBytes(StandardCharsets.UTF_8).length > FeatureRules.MAX_BYTES) return false;
            synchronized (featureSyncLock) {
                pendingFeaturePayload = payload;
                pendingFeatureOwner = owner;
                if (featureSyncRunning) return true;
                featureSyncRunning = true;
                try { featureWorker.execute(MainActivity.this::drainFeatureSync); }
                catch (RuntimeException | LinkageError error) {
                    featureSyncRunning = false; pendingFeaturePayload = null; pendingFeatureOwner = null;
                    return false;
                }
            }
            return true;
        }
        @JavascriptInterface public String featuresStatus() {
            if (!trustedBridge(owner)) return featureUnavailable();
            try { return FeatureScheduler.status(MainActivity.this); }
            catch (RuntimeException | LinkageError error) { return featureUnavailable(); }
        }
        @JavascriptInterface public boolean requestPinWidget() {
            return pinWidget(CourseWidgetProvider.class);
        }
        @JavascriptInterface public boolean requestPinCompactWidget() {
            return pinWidget(CompactCourseWidgetProvider.class);
        }
        private boolean pinWidget(Class<?> provider) {
            if(!trustedBridge(owner))return false;
            AppWidgetManager manager=AppWidgetManager.getInstance(MainActivity.this);
            if(!manager.isRequestPinAppWidgetSupported())return false;
            runOnUiThread(()->{if(trustedBridge(owner)&&trustedPage())try{if(!manager.requestPinAppWidget(new ComponentName(MainActivity.this,provider),null,null))toast("请长按桌面，在小组件中找到「随课」");}catch(RuntimeException unavailable){toast("请长按桌面，在小组件中找到「随课」");}});
            return true;
        }
        @JavascriptInterface public boolean syncWidgetAppearance(boolean glass,int frost,boolean reducedMotion) {
            if(!trustedBridge(owner)||frost<0||frost>100)return false;
            try{featureWorker.execute(()->{if(trustedBridge(owner))CourseWidgetProvider.syncAppearance(MainActivity.this,glass,frost,reducedMotion);});return true;}
            catch(RuntimeException unavailable){return false;}
        }
        @JavascriptInterface public boolean consumeWidgetLaunch() {
            if(!trustedBridge(owner))return false;
            boolean launch=widgetLaunch;widgetLaunch=false;return launch;
        }
        @JavascriptInterface public String getWorkspaceCheckpoint() {
            if (!trustedBridge(owner)) throw new IllegalStateException("WORKSPACE_CHECKPOINT_UNTRUSTED");
            // JavascriptInterface methods run on WebView's bridge thread. Never dispatch this disk I/O to UI.
            try {
                String payload = WorkspaceCheckpoint.read(MainActivity.this);
                // Java String null becomes undefined in Chromium's bridge. Use an explicit JSON null token.
                return payload == null ? "null" : payload;
            }
            catch (RuntimeException | LinkageError error) { throw new IllegalStateException("WORKSPACE_CHECKPOINT_UNAVAILABLE"); }
        }
        @JavascriptInterface public boolean persistWorkspaceCheckpoint(String payload) {
            if (!trustedBridge(owner)) return false;
            try { return WorkspaceCheckpoint.persist(MainActivity.this, payload); }
            catch (RuntimeException | LinkageError error) { return false; }
        }
        @JavascriptInterface public boolean isFreshInstall() {
            if (!trustedBridge(owner)) return false;
            try {
                PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
                return info.firstInstallTime == info.lastUpdateTime;
            } catch (PackageManager.NameNotFoundException | RuntimeException | LinkageError error) { return false; }
        }
        @JavascriptInterface public boolean requestReminderPermission() {
            if (!trustedBridge(owner)) return false;
            runOnUiThread(() -> {
                if (!trustedBridge(owner) || !trustedPage()) return;
                try {
                    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                            != PackageManager.PERMISSION_GRANTED) {
                        if (reminderPermissionPending) return;
                        reminderPermissionPending = true; reminderPermissionOwner = owner;
                        requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REMINDER_PERMISSION);
                    } else refreshNativeFeatures(owner, true);
                } catch (RuntimeException | LinkageError error) {
                    reminderPermissionPending = false; reminderPermissionOwner = null;
                    deliverFeatureStatus(owner, featureUnavailable());
                }
            });
            return true;
        }
        @JavascriptInterface public boolean chooseNoticeScreenshot() {
            if (!trustedBridge(owner)) return false;
            runOnUiThread(() -> openNoticeScreenshot(owner));
            return true;
        }
        @JavascriptInterface public boolean exportBackup(String name, String json) {
            synchronized (exportLock) {
                if (exportBusy) { toast("正在保存备份，请勿重复点击"); return false; }
                exportBusy = true;
            }
            try {
                if (json == null || json.length() > MAX_BACKUP_BYTES) throw new IOException("Too large");
                byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
                validateBackup(bytes);
                File stage = File.createTempFile("suike-backup-", ".json", getCacheDir());
                synchronized (exportLock) { exportFile = stage; exportName = safeName(name); }
                try (OutputStream output = new FileOutputStream(stage)) { output.write(bytes); }
                runOnUiThread(() -> {
                    if (owner != webView || isFinishing() || isDestroyed() || !trustedPage()) { clearExport(); return; }
                    if (fileChooser != null) { clearExport(); toast("请先完成当前备份导入"); return; }
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("application/json");
                    intent.putExtra(Intent.EXTRA_TITLE, exportName);
                    intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    try { startActivityForResult(intent, SAVE_JSON); }
                    catch (ActivityNotFoundException error) { clearExport(); toast("找不到系统保存窗口，备份未导出"); }
                });
                return true;
            } catch (Exception error) { clearExport(); toast("备份数据无效或过大，未导出任何文件"); return false; }
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode==OPEN_COURSE_DOCUMENT) {
            courseDocumentPickerOpen=false;
            final WebView owner=courseDocumentOwner;final String id=courseDocumentId;final int epoch=courseDocumentGeneration;
            if(owner==null||id==null||!trustedBridge(owner))return;
            Uri uri=data==null?null:data.getData();
            if(resultCode!=RESULT_OK||uri==null||!"content".equals(uri.getScheme())){
                deliverCourseDocument(owner,id,"","CANCELLED","");return;
            }
            String found="课程文件";
            try(android.database.Cursor cursor=getContentResolver().query(uri,new String[]{android.provider.OpenableColumns.DISPLAY_NAME},null,null,null)){
                if(cursor!=null&&cursor.moveToFirst()){String value=cursor.getString(0);if(value!=null)found=value.replaceAll("[\\p{Cntrl}]","_");}
            }catch(RuntimeException ignored){}
            final String name=found.length()>120?found.substring(0,120):found;
            courseDocumentBusy=true;
            try{
                boolean accepted=CourseDocumentReader.read(MainActivity.this,uri,name,(text,error,attachment)->runOnUiThread(()->{
                    courseDocumentBusy=false;
                    if(epoch==courseDocumentGeneration)deliverCourseDocument(owner,id,text,error,name,attachment);
                    else CourseDocumentReader.clearAttachments();
                }));
                if(!accepted){courseDocumentBusy=false;deliverCourseDocument(owner,id,"","文件读取正忙，请稍后重试。",name);}
            }catch(RuntimeException error){courseDocumentBusy=false;deliverCourseDocument(owner,id,"","文件未能读取。",name);}
            return;
        }
        if (requestCode == OPEN_NOTICE_SCREENSHOT) {
            noticePickerOpen = false;
            final WebView owner = noticePickerOwner;
            noticePickerOwner = null;
            if (!trustedBridge(owner) || !trustedPage()) return;
            Uri image = resultCode == RESULT_OK && data != null ? data.getData() : null;
            if (image == null) { deliverNoticeText(owner, "", "CANCELLED"); return; }
            if (!"content".equals(image.getScheme())) { deliverNoticeText(owner, "", "INVALID_IMAGE"); return; }
            noticeOcrBusy = true;
            try {
                boolean accepted = NoticeOcr.recognize(MainActivity.this, image, (text, error) -> runOnUiThread(() -> {
                    noticeOcrBusy = false;
                    deliverNoticeText(owner, text, error);
                }));
                if (!accepted) { noticeOcrBusy = false; deliverNoticeText(owner, "", "BUSY"); }
            } catch (RuntimeException | LinkageError error) {
                noticeOcrBusy = false; deliverNoticeText(owner, "", "OCR_FAILED");
            }
        } else if (requestCode == OPEN_TEACHING_PORTAL) {
            teachingPortalOpen = false;
            final WebView owner = teachingPortalOwner;
            teachingPortalOwner = null;
            if (resultCode != RESULT_OK || data == null) return;
            new Thread(() -> {
                try {
                    // Internal basename, canonical directory, TTL, byte limit and exact schema are
                    // checked here. consume always deletes the file after reading, including failure.
                    JSONObject capture = PortalCaptureStore.consume(MainActivity.this, data);
                    String json = capture.toString().replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
                    runOnUiThread(() -> deliverTeachingCapture(owner, json));
                } catch (Exception error) { toast("读取到的课表无效或已过期，请重新打开学校网页读取；本地课表未改动"); }
            }, "suike-teaching-import").start();
        } else if (requestCode == OPEN_MEDIA) {
            Uri selected = resultCode == RESULT_OK && data != null ? data.getData() : null;
            if (selected == null || !trustedPage()) { completeImport(null); return; }
            if (!"content".equals(selected.getScheme())) { completeImport(null); toast("请选择系统文件列表中的图片或视频"); return; }
            new Thread(() -> {
                try {
                    String mime = getContentResolver().getType(selected);
                    if (!("image/png".equals(mime)||"image/jpeg".equals(mime)||"image/webp".equals(mime)||"video/mp4".equals(mime)||"video/webm".equals(mime))) throw new IOException("Media type");
                    readLimited(getContentResolver().openInputStream(selected), mime.startsWith("video/") ? 32*1024*1024 : 8*1024*1024);
                    runOnUiThread(() -> { if (trustedPage()) completeImport(selected); else completeImport(null); });
                } catch (Exception error) { runOnUiThread(() -> { completeImport(null); toast("壁纸文件无法读取，或超过大小限制"); }); }
            }, "suike-wallpaper").start();
        } else if (requestCode == OPEN_JSON) {
            Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
            if (uri == null) { completeImport(null); return; }
            if (!"content".equals(uri.getScheme())) { completeImport(null); toast("请选择系统文件列表中的 JSON 备份"); return; }
            new Thread(() -> {
                try {
                    validateBackup(readLimited(getContentResolver().openInputStream(uri), MAX_BACKUP_BYTES));
                    runOnUiThread(() -> completeImport(uri));
                } catch (Exception error) { runOnUiThread(() -> { completeImport(null); toast("文件不是有效备份或超过 5 MB，原课表未改动"); }); }
            }, "suike-import").start();
        } else if (requestCode == SAVE_JSON) {
            Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
            if (uri == null) { clearExport(); toast("已取消保存备份"); return; }
            File staged;
            synchronized (exportLock) { staged = exportFile; }
            if (!"content".equals(uri.getScheme()) || staged == null || !staged.isFile()) {
                clearExport(); toast("备份未保存，请重新导出"); return;
            }
            final File source = staged;
            new Thread(() -> {
                boolean saved = false;
                try (InputStream input = new FileInputStream(source); OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new IOException("No output");
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    output.flush(); saved = true;
                } catch (Exception error) { saved = false; toast("备份写入失败，请检查保存位置并重新导出"); }
                finally { clearExport(); }
                if (saved) toast("JSON 备份已保存");
            }, "suike-export").start();
        }
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REMINDER_PERMISSION) {
            WebView owner = reminderPermissionOwner;
            reminderPermissionPending = false; reminderPermissionOwner = null;
            refreshNativeFeatures(owner, true);
        }
    }

    private static String featureUnavailable() { return "{\"ok\":false,\"error\":\"feature_unavailable\"}"; }

    private void drainFeatureSync() {
        for (;;) {
            final String payload;
            final WebView owner;
            synchronized (featureSyncLock) {
                payload = pendingFeaturePayload; owner = pendingFeatureOwner;
                pendingFeaturePayload = null; pendingFeatureOwner = null;
                if (payload == null) { featureSyncRunning = false; return; }
            }
            if (!trustedBridge(owner)) continue;
            String status;
            try { status = FeatureScheduler.sync(MainActivity.this, payload); }
            catch (RuntimeException | LinkageError error) { status = featureUnavailable(); }
            final String result = status;
            runOnUiThread(() -> deliverFeatureStatus(owner, result));
        }
    }

    private void refreshNativeFeatures(WebView owner, boolean syncWeb) {
        try {
            featureWorker.execute(() -> {
                String status;
                try { FeatureScheduler.refresh(MainActivity.this); status = FeatureScheduler.status(MainActivity.this); }
                catch (RuntimeException | LinkageError error) { status = featureUnavailable(); }
                final String result = status;
                runOnUiThread(() -> {
                    deliverFeatureStatus(owner, result);
                    if (syncWeb) evaluateFeatureCallback(owner,
                            "if(typeof f.syncNative==='function')f.syncNative();");
                });
            });
        } catch (RuntimeException | LinkageError error) { /* Optional feature must never break startup. */ }
    }

    private void deliverFeatureStatus(WebView owner, String json) {
        // Pass canonical JSON as a quoted string, then parse inside the trusted local document.
        try {
            String canonical = new JSONObject(json).toString();
            evaluateFeatureCallback(owner, "if(typeof f.nativeStatus==='function')f.nativeStatus(JSON.parse("
                    + quoteJavascript(canonical) + "));");
        } catch (Exception | LinkageError error) { /* Do not log labels, screenshot text, or raw payloads. */ }
    }

    private void openNoticeScreenshot(WebView owner) {
        if (!trustedBridge(owner) || !trustedPage()) return;
        boolean exportInProgress;
        synchronized (exportLock) { exportInProgress = exportBusy; }
        if (noticePickerOpen || noticeOcrBusy || teachingPortalOpen || fileChooser != null || exportInProgress) {
            deliverNoticeText(owner, "", "BUSY"); return;
        }
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType("image/*").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        noticePickerOpen = true; noticePickerOwner = owner;
        try { startActivityForResult(picker, OPEN_NOTICE_SCREENSHOT); }
        catch (RuntimeException | LinkageError error) {
            noticePickerOpen = false; noticePickerOwner = null;
            deliverNoticeText(owner, "", "PICKER_UNAVAILABLE");
        }
    }

    private void deliverCourseDocument(WebView owner, String id, String text, String error, String name) {
        deliverCourseDocument(owner,id,text,error,name,"");
    }
    private void deliverCourseDocument(WebView owner, String id, String text, String error, String name, String attachment) {
        if (!trustedBridge(owner)||!trustedPage())return;
        try{
            JSONObject result=new JSONObject().put("text",text).put("error",error).put("name",name).put("attachmentId",attachment);
            String script="window.SuikeDeepSeek&&window.SuikeDeepSeek.receiveDocument("+JSONObject.quote(id)+","+result.toString()+");";
            owner.evaluateJavascript(script.replace("\u2028","\\u2028").replace("\u2029","\\u2029"),null);
        }catch(Exception ignored){}
    }
    private void deliverNoticeText(WebView owner, String text, String error) {
        String safeError = "none";
        if (!"none".equals(error)) safeError = Arrays.asList("NO_TEXT", "TEXT_TOO_LONG", "OCR_FAILED", "CANCELLED",
                "INVALID_IMAGE", "BUSY", "PICKER_UNAVAILABLE").contains(error) ? error : "OCR_FAILED";
        String value = text == null ? "" : text;
        if (value.length() > 20000) { value = ""; safeError = "TEXT_TOO_LONG"; }
        evaluateFeatureCallback(owner, "if(typeof f.receiveNoticeText==='function')f.receiveNoticeText("
                + quoteJavascript(value) + "," + quoteJavascript(safeError) + ");");
    }

    private static String quoteJavascript(String value) {
        return JSONObject.quote(value).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
    }

    private void evaluateFeatureCallback(WebView owner, String callback) {
        if (!trustedBridge(owner) || !trustedPage()) return;
        String script = "(function(){if(location.protocol!=='https:'||location.host!=='suike.local')return;" +
                "var f=window.SuikeFeatures;if(!f)return;try{" + callback + "}catch(_){}})();";
        try { owner.evaluateJavascript(script, null); }
        catch (RuntimeException | LinkageError error) { /* Optional callbacks cannot affect the boot flow. */ }
    }

    private void deliverTeachingCapture(WebView owner, String json) {
        if (owner == null || owner != webView || startupFailed || !startupReady || isFinishing() || isDestroyed() || !trustedPage()) {
            toast("本地课表界面尚未就绪，请重新打开学校网页读取");
            return;
        }
        if (fileChooser != null) { toast("请先完成备份导入，再重新读取教务课表"); return; }
        synchronized (exportLock) {
            if (exportBusy) { toast("请先完成备份保存，再重新读取教务课表"); return; }
        }
        // JSONObject serialization is data in a function argument, not page-provided JavaScript.
        String script = "(function(c){if(location.protocol!=='https:'||location.host!=='suike.local'||" +
                "!window.SuikeImport||typeof window.SuikeImport.receiveCapture!=='function')return false;" +
                "return window.SuikeImport.receiveCapture(c)===true;})(" + json + ");";
        try { owner.evaluateJavascript(script, result -> {
            if (owner != webView || isFinishing() || isDestroyed() || !trustedPage()) return;
            if (!"true".equals(result)) toast("本地课表未能生成导入预览，请重新读取；本地课表未改动");
        }); } catch (RuntimeException | LinkageError error) {
            toast("本地课表未能生成导入预览，请重新读取；本地课表未改动");
        }
    }

    private void completeImport(Uri uri) {
        ValueCallback<Uri[]> callback = fileChooser; fileChooser = null;
        if (callback != null) callback.onReceiveValue(uri == null ? null : new Uri[] { uri });
        else if (uri != null) toast("请重新点击导入备份，再选择一次文件");
    }
    private static void validateBackup(byte[] bytes) throws Exception {
        if (bytes.length == 0 || bytes.length > MAX_BACKUP_BYTES) throw new IOException("Backup size");
        JSONObject object = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        JSONObject settings = object.optJSONObject("settings");
        JSONArray courses = object.optJSONArray("courses"), periods = object.optJSONArray("periods");
        if (object.optInt("schemaVersion", -1) != 1 || settings == null || courses == null || courses.length() > 500 ||
                periods == null || periods.length() < 1 || periods.length() > 24) throw new IOException("Backup schema");
        if (object.has("appliedUpdateIds")) {
            JSONArray ids = object.optJSONArray("appliedUpdateIds");
            if (ids == null || ids.length() > 100) throw new IOException("Update ids");
            for (int i = 0; i < ids.length(); i++) {
                Object id = ids.get(i);
                if (!(id instanceof String) || ((String) id).trim().isEmpty() || ((String) id).length() > 160) throw new IOException("Update id");
            }
        }
        // The bundled JavaScript performs the full model validation before import.
    }
    private static byte[] readLimited(InputStream input, int limit) throws IOException {
        if (input == null) throw new IOException("No input");
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count, total = 0;
            while ((count = source.read(buffer)) != -1) {
                total += count; if (total > limit) throw new IOException("Too large");
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }
    private static String safeName(String requested) {
        if (requested == null) return "随课备份.json";
        String name = requested.replaceAll("[\\\\/\\p{Cntrl}]", "_").trim();
        if (name.isEmpty() || name.length() > 100) return "随课备份.json";
        return name.toLowerCase(Locale.ROOT).endsWith(".json") ? name : name + ".json";
    }
    private static String mimeFor(String name) {
        if (name.endsWith(".html")) return "text/html";
        if (name.endsWith(".css")) return "text/css";
        if (name.endsWith(".js")) return "application/javascript";
        if (name.endsWith(".svg")) return "image/svg+xml";
        if (name.endsWith(".webp")) return "image/webp";
        if (name.endsWith(".ttf")) return "font/ttf";
        return "image/png";
    }
    private void toast(String message) { runOnUiThread(() -> { if (!isDestroyed()) Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }); }
    private void clearExport() {
        synchronized (exportLock) {
            if (exportFile != null) exportFile.delete();
            exportFile = null; exportName = null; exportBusy = false;
        }
    }
    private void restoreExport(Bundle state) {
        if (state == null) return;
        String file = state.getString("exportFile"), name = state.getString("exportName");
        if (file != null && file.startsWith("suike-backup-") && file.endsWith(".json") && !file.contains("/") && !file.contains("\\")) {
            File staged = new File(getCacheDir(), file);
            if (staged.isFile() && staged.length() <= MAX_BACKUP_BYTES) { exportFile = staged; exportName = safeName(name); exportBusy = true; }
        }
    }
    @Override protected void onSaveInstanceState(Bundle outState) {
        synchronized (exportLock) { if (exportFile != null) { outState.putString("exportFile", exportFile.getName()); outState.putString("exportName", exportName); } }
        super.onSaveInstanceState(outState);
    }
    @Override public void onBackPressed() { handleBack(); }
    @Override protected void onResume() {
        super.onResume();
        refreshNativeFeatures(webView, false);
    }
    private void handleBack() {
        if (backPending) return;
        if (webView == null) { finish(); return; }
        if (!trustedPage()) { finish(); return; }
        backPending = true;
        final WebView active = webView;
        try { active.evaluateJavascript("(function(){var ds=document.querySelectorAll('dialog[open]');var d=ds[ds.length-1];" +
                "if(!d)return false;if(typeof d.close==='function')d.close();else d.removeAttribute('open');return true;})()", result -> {
            backPending = false;
            if (webView != active) return;
            try {
                if (!"true".equals(result)) { if (active.canGoBack()) active.goBack(); else finish(); }
            } catch (RuntimeException | LinkageError error) { finish(); }
        }); } catch (RuntimeException | LinkageError error) { backPending = false; finish(); }
    }
    @Override protected void onDestroy() {
        try {
            disposeWebView();
            synchronized (featureSyncLock) { pendingFeaturePayload = null; pendingFeatureOwner = null; }
            featureWorker.shutdownNow();
            if (deepSeekClient != null) deepSeekClient.close();
            CourseDocumentReader.clearAttachments();
            if (isFinishing()) optional("清理备份临时文件", this::clearExport);
        } finally { super.onDestroy(); }
    }
}
