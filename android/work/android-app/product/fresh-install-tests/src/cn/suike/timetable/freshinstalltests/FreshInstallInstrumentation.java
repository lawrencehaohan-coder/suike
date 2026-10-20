package cn.suike.timetable.freshinstalltests;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.webkit.WebView;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.lang.reflect.Field;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Uses the shipping page and first-install bridge. No fake flags or seed writes. */
public final class FreshInstallInstrumentation extends Instrumentation {
    private static final String TARGET = "cn.suike.timetable";
    private final JSONArray checks = new JSONArray();
    private Activity activity;
    private String stage;
    private String authorization;
    private String step = "emulator_guard";

    @Override public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        stage = arguments == null ? null : arguments.getString("stage");
        authorization = arguments == null ? null : arguments.getString("fresh_install_authorized");
        start();
    }
    @Override public void onStart() {
        JSONObject report = new JSONObject(); boolean passed = false;
        try {
            require("true".equals(authorization), "EXPLICIT_FRESH_INSTALL_REQUIRED");
            require(Build.VERSION.SDK_INT == 36 && "ranchu".equals(Build.HARDWARE), "EMULATOR_ONLY");
            require(TARGET.equals(getTargetContext().getPackageName()), "TARGET_MISMATCH");
            require("first".equals(stage) || "relaunch".equals(stage), "STAGE_INVALID");
            PackageInfo info = getTargetContext().getPackageManager().getPackageInfo(TARGET, 0);
            require("1.4.0".equals(info.versionName) && info.getLongVersionCode() == 9, "TARGET_VERSION_MISMATCH");
            require(info.firstInstallTime == info.lastUpdateTime, "NOT_A_REAL_FRESH_INSTALL");
            launch();
            if ("first".equals(stage)) firstLaunch(); else relaunched();
            passed = true;
        } catch (Throwable failure) {
            put(report, "failureStep", step); put(report, "failureType", failure.getClass().getSimpleName());
            String code = failure.getMessage();
            if (code != null && code.matches("[A-Z_]{3,80}")) put(report, "failureCode", code);
        } finally {
            try {
                if (activity != null && !activity.isDestroyed()) { runOnMainSync(() -> activity.finish()); waitForIdleSync(); }
            } catch (Throwable failure) { passed = false; put(report, "finishFailureType", failure.getClass().getSimpleName()); }
            put(report, "passed", passed); put(report, "stage", stage); put(report, "api", Build.VERSION.SDK_INT);
            put(report, "hardware", Build.HARDWARE); put(report, "checks", checks);
            put(report, "processId", android.os.Process.myPid());
            put(report, "seedOrStorageManuallyReset", false);
            put(report, "processRestartCoverage", "external_runner_force_stops_between_two_instrumentation_processes");
            Bundle result = new Bundle(); result.putString("qa_report", report.toString());
            finish(passed ? Activity.RESULT_OK : Activity.RESULT_CANCELED, result);
        }
    }
    private void firstLaunch() throws Exception {
        step = "first_install_empty";
        require(Boolean.TRUE.equals(eval("window.SuikeNative.isFreshInstall()")), "NATIVE_FRESH_FLAG_FALSE");
        JSONObject initial = summary();
        require(initial.getInt("courses") == 0 && initial.getInt("meetings") == 0, "FRESH_INSTALL_NOT_EMPTY");
        require(initial.getBoolean("skipLegacy") && !initial.getBoolean("setupCompleted"), "FRESH_SETUP_STATE_INVALID");
        require(initial.getBoolean("storagePresent"), "FRESH_STATE_NOT_PERSISTED");
        record("real_first_install_empty_setup_pending", new JSONObject().put("courses", 0).put("meetings", 0).put("skipLegacyImportBaseline", true).put("setupCompleted", false));

        step = "first_guide_automatic";
        waitForJs("!!document.getElementById('productDialog')&&document.getElementById('productDialog').open&&document.getElementById('productDialogTitle').textContent==='开始使用随课'", 15000);
        require(Boolean.TRUE.equals(eval("document.getElementById('setupMonday')!==null&&document.getElementById('setupMajor')!==null&&document.getElementById('setupClass')!==null&&document.getElementById('setupBatch')!==null")), "FIRST_GUIDE_FIELDS_MISSING");
        record("first_guide_opens_automatically", new JSONObject().put("automaticallyOpened", true));

        step = "save_first_guide";
        require(Boolean.TRUE.equals(eval("(function(){var values={setupMonday:'2026-08-31',setupMajor:'机器人工程',setupClass:'1',setupBatch:'1'};Object.keys(values).forEach(function(id){var input=document.getElementById(id);input.value=values[id];input.dispatchEvent(new Event('input',{bubbles:true}));});document.getElementById('productConfirm').click();return true;})()")), "GUIDE_SAVE_ACTION_FAILED");
        waitForJs("!document.getElementById('productDialog').open&&window.SuikeFeatures.getState().productSettings.setupCompleted===true", 10000);
        JSONObject configured = summary(); verifyConfigured(configured);
        record("guide_save_keeps_empty_and_persists_profile", new JSONObject().put("courses", 0).put("setupCompleted", true).put("mondayCorrect", true).put("majorCorrect", true).put("classNumber", 1).put("batchNumber", 1));
    }
    private void relaunched() throws Exception {
        step = "process_restart_persistence";
        JSONObject current = summary(); verifyConfigured(current);
        // Wait beyond the production first-guide timer. A momentary closed
        // dialog before its delayed callback would not prove setup persisted.
        SystemClock.sleep(1200);
        require(Boolean.TRUE.equals(eval("!document.getElementById('productDialog').open")), "GUIDE_REOPENED_AFTER_RESTART");
        record("real_process_restart_keeps_zero_courses_and_completed_setup", new JSONObject().put("courses", 0).put("meetings", 0).put("setupCompleted", true).put("firstGuideReopened", false).put("profilePreserved", true));
    }
    private void verifyConfigured(JSONObject data) throws Exception {
        require(data.getInt("courses") == 0 && data.getInt("meetings") == 0, "COURSES_REVIVED_AFTER_SETUP");
        require(data.getBoolean("skipLegacy") && data.getBoolean("setupCompleted"), "SETUP_NOT_PERSISTED");
        require("2026-08-31".equals(data.getString("monday")), "MONDAY_NOT_PERSISTED");
        require("机器人工程".equals(data.getString("major")), "MAJOR_NOT_PERSISTED");
        require(data.getInt("classNumber") == 1 && data.getInt("batchNumber") == 1, "GROUP_NOT_PERSISTED");
        require(data.getBoolean("storagePresent"), "CONFIGURED_STATE_NOT_PERSISTED");
        require(Boolean.TRUE.equals(eval("(function(){var saved=JSON.parse(localStorage.getItem('suike.timetable.v1'));return saved.courses.length===0&&saved.skipLegacyImportBaseline===true&&saved.productSettings.setupCompleted===true&&saved.settings.startMonday==='2026-08-31'&&saved.productSettings.profile.major==='机器人工程'&&saved.productSettings.profile.classNumber===1&&saved.productSettings.profile.batchNumber===1;})()")), "STORED_PROFILE_MISMATCH");
    }
    private JSONObject summary() throws Exception {
        Object value = eval("JSON.stringify((function(){var s=window.SuikeFeatures.getState(),p=s.productSettings;return {courses:s.courses.length,meetings:s.courses.reduce(function(n,c){return n+c.dates.length;},0),skipLegacy:s.skipLegacyImportBaseline===true,setupCompleted:p.setupCompleted,monday:s.settings.startMonday,major:p.profile.major,classNumber:p.profile.classNumber,batchNumber:p.profile.batchNumber,storagePresent:localStorage.getItem('suike.timetable.v1')!==null};})())");
        require(value instanceof String, "SUMMARY_MISSING"); return new JSONObject((String) value);
    }
    private void launch() throws Exception {
        step = "startup";
        Intent intent = new Intent(Intent.ACTION_MAIN).setClassName(TARGET, TARGET + ".MainActivity");
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        activity = startActivitySync(intent);
        waitForJs("!!(window.__suikeBoot&&window.__suikeBoot.ready&&document.documentElement.dataset.suikeReady==='true'&&window.SuikeFeatures)", 45000);
    }
    private WebView web() throws Exception {
        Field field = activity.getClass().getDeclaredField("webView"); field.setAccessible(true);
        WebView view = (WebView) field.get(activity); require(view != null, "WEBVIEW_MISSING"); return view;
    }
    private Object eval(String code) throws Exception {
        WebView view = web(); CountDownLatch done = new CountDownLatch(1); AtomicReference<String> result = new AtomicReference<>();
        runOnMainSync(() -> view.evaluateJavascript(code, value -> { result.set(value); done.countDown(); }));
        require(done.await(12, TimeUnit.SECONDS), "JS_CALLBACK_TIMEOUT");
        require(result.get() != null, "JS_CALLBACK_EMPTY"); return new JSONTokener(result.get()).nextValue();
    }
    private void waitForJs(String expression, long timeout) throws Exception {
        long until = SystemClock.elapsedRealtime() + timeout;
        while (SystemClock.elapsedRealtime() < until) { if (Boolean.TRUE.equals(eval(expression))) return; SystemClock.sleep(150); }
        throw new IllegalStateException("JS_WAIT_TIMEOUT");
    }
    private void record(String name, JSONObject details) throws Exception { checks.put(new JSONObject().put("name", name).put("passed", true).put("details", details)); }
    private static void require(boolean condition, String code) { if (!condition) throw new IllegalStateException(code); }
    private static void put(JSONObject object, String key, Object value) { try { object.put(key, value); } catch (Exception ignored) {} }
}
