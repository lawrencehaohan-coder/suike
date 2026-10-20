package cn.suike.timetable.featuretests;

import android.Manifest;
import android.app.Activity;
import android.app.Instrumentation;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import android.util.AtomicFile;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicBoolean;

/** Synthetic data only, refused on real hardware. Tests shipping classes, not copied implementations. */
public final class FeatureInstrumentation extends Instrumentation {
    private static final String TARGET = "cn.suike.timetable";
    private static final String CHANNEL = "suike_courses_v1";
    private static final String PREFIX = "qa-native-";
    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    private final JSONArray checks = new JSONArray();
    private String step = "emulator_guard";
    private Context target;
    private Class<?> scheduler;
    private Class<?> checkpoint;
    private byte[] originalSnapshot;
    private byte[] originalCheckpoint;
    private Map<String, ?> originalPreferences;
    private boolean captured;
    private Activity bridgeActivity;
    private boolean diagnostic;
    private boolean revision;
    private final JSONArray normalStartupRuns = new JSONArray();

    @Override public void onCreate(Bundle arguments) {
        revision = arguments != null && "revision-beta18".equals(arguments.getString("mode"));
        diagnostic = arguments != null && "checkpoint-diagnostic".equals(arguments.getString("mode"));
        super.onCreate(arguments); start();
    }
    @Override public void callActivityOnCreate(Activity activity, Bundle state) {
        super.callActivityOnCreate(activity, state);
        if (!diagnostic || !activity.getClass().getName().equals(TARGET + ".MainActivity")) return;
        // Test-only: retain the failed document long enough to inspect fixed metadata.
        // No production behavior, storage or bridge trust check is changed.
        try {
            Method cancel = activity.getClass().getDeclaredMethod("cancelStartupWatch"); cancel.setAccessible(true); cancel.invoke(activity);
            Field inFlight = activity.getClass().getDeclaredField("readyProbeInFlight"); inFlight.setAccessible(true); inFlight.setBoolean(activity, true);
        } catch (Exception failure) { throw new IllegalStateException("DIAGNOSTIC_WATCH_SUPPRESSION_FAILED"); }
    }
    @Override public void onStart() {
        if (revision) { runRevision(); return; }
        if (diagnostic) { runCheckpointDiagnostic(); return; }
        JSONObject report = new JSONObject(); boolean passed = false, restored = false;
        try {
            require(Build.VERSION.SDK_INT == 36 && "ranchu".equals(Build.HARDWARE), "EMULATOR_ONLY");
            target = getTargetContext();
            require(TARGET.equals(target.getPackageName()), "TARGET_MISMATCH");
            scheduler = Class.forName(TARGET + ".FeatureScheduler", true, target.getClassLoader());
            checkpoint = Class.forName(TARGET + ".WorkspaceCheckpoint", true, target.getClassLoader());
            require(target.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED,
                    "PREGRANT_NOTIFICATION_PERMISSION");
            require(courseNotificationCount() == 0, "CLEAN_COURSE_NOTIFICATIONS_REQUIRED");
            originalSnapshot = readSnapshot(); originalCheckpoint = readCheckpointBytes();
            originalPreferences = preferences().getAll(); captured = true;
            runSuite(); passed = true;
        } catch (Throwable failure) {
            put(report, "failureStep", step); put(report, "failureType", failure.getClass().getSimpleName());
            String code = failure.getMessage();
            if (code != null && code.matches("[A-Z_]{3,80}")) put(report, "failureCode", code);
        } finally {
            try { if (captured) { restore(); restored = true; } }
            catch (Throwable failure) { restored = false; put(report, "restoreFailureType", failure.getClass().getSimpleName()); }
            put(report, "passed", passed); put(report, "nativeSnapshotRestored", restored);
            put(report, "api", Build.VERSION.SDK_INT); put(report, "hardware", Build.HARDWARE); put(report, "checks", checks);
            put(report, "normalStartupRuns", normalStartupRuns);
            put(report, "alarmTimingCoverage", "production_receiver_invoked_after_due_time; OS_window_wakeup_not_measured");
            put(report, "notificationPermissionRestoration", "external_runner_restores_original_permission_after_instrumentation");
            Bundle result = new Bundle(); result.putString("qa_report", report.toString());
            finish(passed && restored ? Activity.RESULT_OK : Activity.RESULT_CANCELED, result);
        }
    }

    private void runSuite() throws Exception {
        step = "workspace_checkpoint"; testWorkspaceCheckpoint();
        step = "payload_validation";
        JSONObject base = payload(false, System.currentTimeMillis() + 30 * 60000L, 10);
        require(sync(base.toString()).getBoolean("ok"), "VALID_PAYLOAD_REJECTED");
        byte[] before = readSnapshot();
        List<String> invalid = new ArrayList<>();
        invalid.add(new JSONObject(base.toString()).put("schemaVersion", 2).toString());
        invalid.add(new JSONObject(base.toString()).put("enabled", "true").toString());
        JSONObject bad = new JSONObject(base.toString()); bad.getJSONArray("occurrences").getJSONObject(0).put("startMillis", 1.5); invalid.add(bad.toString());
        bad = new JSONObject(base.toString()); bad.getJSONArray("occurrences").getJSONObject(0).put("date", "2026-02-30"); invalid.add(bad.toString());
        bad = new JSONObject(base.toString()); bad.getJSONArray("occurrences").getJSONObject(0).put("name", "课程\n控制字符"); invalid.add(bad.toString());
        bad = new JSONObject(base.toString()); bad.getJSONArray("occurrences").put(bad.getJSONArray("occurrences").getJSONObject(0)); invalid.add(bad.toString());
        bad = new JSONObject(base.toString()); JSONArray tooMany = new JSONArray(); for (int i = 0; i < 50001; i++) tooMany.put(JSONObject.NULL);
        bad.put("occurrences", tooMany); invalid.add(bad.toString());
        invalid.add(base.toString().replace("\"leadMinutes\":10", "\"leadMinutes\":NaN"));
        invalid.add("{\"schemaVersion\":1,\"enabled\":false,\"occurrences\":[],\"x\":[[[[[[[[[0]]]]]]]]]}");
        char[] oversized = new char[1024 * 1024 + 1]; Arrays.fill(oversized, ' '); invalid.add(new String(oversized));
        for (String candidate : invalid) {
            require(!sync(candidate).getBoolean("ok"), "INVALID_PAYLOAD_ACCEPTED");
            require(Arrays.equals(before, readSnapshot()), "INVALID_PAYLOAD_OVERWROTE_STORE");
        }
        bad = new JSONObject(base.toString()).put("unusedCredential", "QA_SECRET_IGNORED");
        require(sync(bad.toString()).getBoolean("ok"), "UNKNOWN_FIELD_SYNC_FAILED");
        require(!new String(readSnapshot(), StandardCharsets.UTF_8).contains("QA_SECRET_IGNORED"), "UNKNOWN_FIELD_PERSISTED");
        record("strict_payload_rejects_without_overwrite", new JSONObject().put("rejectedFixtures", invalid.size()).put("unknownFieldDiscarded", true));

        step = "enable_disable_and_alarm";
        base = payload(true, System.currentTimeMillis() + 30 * 60000L, 10);
        long start = base.getJSONArray("occurrences").getJSONObject(0).getLong("startMillis");
        JSONObject enabled = sync(base.toString());
        require(enabled.getBoolean("notificationsAllowed"), "NOTIFICATIONS_NOT_ALLOWED");
        require(enabled.getLong("nextAlarmMillis") == start - 600000L, "REMINDER_ALARM_TIME_WRONG");
        JSONObject disabled = enable(false);
        require(!disabled.getBoolean("enabled") && disabled.getLong("nextAlarmMillis") == 0, "DISABLE_LEFT_REMINDER_ALARM");
        require(disabled.getInt("occurrenceCount") == 1, "DISABLE_ERASED_PROJECTION_DATA");
        require(sync(payload(false, start, 10).put("occurrences", new JSONArray()).toString()).getLong("nextAlarmMillis") == 0,
                "CLEAR_LEFT_STALE_ALARM");
        record("enable_disable_clear_cancel_stale_alarm", new JSONObject().put("reminderScheduled", true).put("disabledAlarmCleared", true).put("dataPreservedOnDisable", true));

        step = "desktop_widget_removed";
        require(!status().has("widgetCount"), "STALE_WIDGET_STATUS");
        for (android.appwidget.AppWidgetProviderInfo provider : android.appwidget.AppWidgetManager.getInstance(target).getInstalledProviders())
            require(!TARGET.equals(provider.provider.getPackageName()), "WIDGET_PROVIDER_STILL_REGISTERED");
        for (Method method : scheduler.getMethods()) require(!"requestPinWidget".equals(method.getName()), "WIDGET_API_STILL_PRESENT");
        record("desktop_widget_removed", new JSONObject().put("providerAbsent", true).put("pinApiAbsent", true));

        step = "notification_due_and_dedup";
        cancelOwnNotifications(); preferences().edit().remove("delivered").commit();
        JSONObject shortFuture = payload(true, System.currentTimeMillis() + 65000L, 1);
        require(sync(shortFuture.toString()).getBoolean("ok"), "SHORT_REMINDER_SYNC_FAILED");
        fireProductionReceiver(); require(ownNotifications().isEmpty(), "REMINDER_FIRED_EARLY");
        long due = shortFuture.getJSONArray("occurrences").getJSONObject(0).getLong("startMillis") - 60000L;
        while (System.currentTimeMillis() <= due + 200L) SystemClock.sleep(100);
        fireProductionReceiver(); waitForNotification();
        List<StatusBarNotification> notifications = ownNotifications();
        require(notifications.size() == 1, "REMINDER_NOTIFICATION_COUNT");
        long postTime = notifications.get(0).getPostTime();
        require(preferences().getStringSet("delivered", new HashSet<String>()).size() == 1, "DELIVERY_LEDGER_WRONG");
        SystemClock.sleep(150); fireProductionReceiver();
        require(ownNotifications().size() == 1 && ownNotifications().get(0).getPostTime() == postTime, "DUPLICATE_REMINDER_POSTED");
        require(enable(false).getLong("nextAlarmMillis") == 0, "DISABLE_LEFT_POSTED_REMINDER");
        waitForNotificationCount(0);
        record("production_receiver_future_due_notification_dedup", new JSONObject().put("beforeDueSuppressed", true).put("notificationPosted", true).put("secondReceiverDidNotRepost", true));

        step = "per_course_mute";
        JSONObject muted = payload(true, System.currentTimeMillis() + 60000L, 1);
        muted.put("courseOverrides", new JSONObject().put("qa-native-course", new JSONObject().put("enabled", false)));
        require(sync(muted.toString()).getLong("nextAlarmMillis") == 0, "COURSE_OFF_SCHEDULED_ALARM");
        fireProductionReceiver(); require(ownNotifications().isEmpty(), "COURSE_OFF_POSTED_NOTIFICATION");
        muted.put("courseOverrides", new JSONObject().put("qa-native-course", new JSONObject().put("enabled", true)));
        muted.put("mutedCourseIds", new JSONArray().put("qa-native-course"));
        require(sync(muted.toString()).getLong("nextAlarmMillis") == 0, "MUTED_COURSE_SCHEDULED_ALARM");
        fireProductionReceiver(); require(ownNotifications().isEmpty(), "MUTE_OVERRIDE_LOST");
        record("per_course_off_and_mute_override", new JSONObject().put("courseOffSuppressed", true).put("muteWinsEnabledOverride", true));

        step = "offline_chinese_ocr"; testOcr();
        step = "normal_main_activity_restarts"; testNormalRestarts();
        step = "workspace_checkpoint_bridge"; testCheckpointBridge();
    }

    /** Read-only test probes; ordinary production bootstrap may still perform its normal writes. */
    private void runCheckpointDiagnostic() {
        JSONObject report = new JSONObject(); boolean completed = false;
        try {
            require(Build.VERSION.SDK_INT == 36 && "ranchu".equals(Build.HARDWARE), "EMULATOR_ONLY");
            target = getTargetContext(); require(TARGET.equals(target.getPackageName()), "TARGET_MISMATCH");
            checkpoint = Class.forName(TARGET + ".WorkspaceCheckpoint", true, target.getClassLoader());
            report.put("mode", "checkpoint-diagnostic").put("testInvokesPersist", false).put("readyWatchSuppressedInTest", true);
            JSONObject files = new JSONObject();
            for (String suffix : new String[] { "", ".bak", ".new" }) {
                File file = new File(checkpointFile().getPath() + suffix);
                files.put(suffix.isEmpty() ? "base" : suffix.substring(1), new JSONObject().put("exists", file.exists()).put("bytes", file.exists() ? file.length() : 0));
            }
            report.put("checkpointFilesBeforeLaunch", files);
            try {
                String raw = readCheckpoint();
                JSONObject direct = new JSONObject().put("returnedNull", raw == null);
                if (raw != null) {
                    JSONObject outer = new JSONObject(raw), values = outer.getJSONObject("values");
                    direct.put("chars", raw.length()).put("version", outer.optInt("version", -1)).put("outerKeyCount", outer.length()).put("valueKeyCount", values.length());
                    JSONObject inner = new JSONObject();
                    for (String key : new String[] { "suike.timetable.v1", "suike.history.v1", "suike.semesters.v1", "suike.workspace.transaction.v1" }) {
                        Object value = values.opt(key); JSONObject shape = new JSONObject().put("isNull", value == JSONObject.NULL).put("isString", value instanceof String);
                        if (value instanceof String) {
                            try { Object parsed = new JSONTokener((String) value).nextValue(); shape.put("innerJsonType", parsed instanceof JSONObject ? "object" : parsed instanceof JSONArray ? "array" : "scalar"); }
                            catch (Exception ignored) { shape.put("innerJsonType", "invalid"); }
                        }
                        inner.put(key, shape);
                    }
                    direct.put("innerShapes", inner);
                }
                report.put("directRead", direct);
            } catch (Throwable failure) { report.put("directRead", diagnosticFailure(failure)); }
            Method validate = checkpoint.getDeclaredMethod("validate", String.class); validate.setAccessible(true);
            JSONObject values = new JSONObject();
            for (String key : new String[] { "suike.timetable.v1", "suike.history.v1", "suike.semesters.v1", "suike.workspace.transaction.v1" }) values.put(key, JSONObject.NULL);
            JSONArray fixtures = new JSONArray();
            for (int fixture = 0; fixture < 2; fixture++) {
                if (fixture == 1) values.put("suike.timetable.v1", "{\"text\":\"高等数学\\n课程\",\"v\":1}");
                try { validate.invoke(null, new JSONObject().put("version", 1).put("values", values).toString()); fixtures.put(new JSONObject().put("accepted", true)); }
                catch (Throwable failure) { fixtures.put(diagnosticFailure(failure)); }
            }
            report.put("validationOnlyFixtures", fixtures);
            bridgeActivity = startActivitySync(new Intent().setComponent(new ComponentName(TARGET, TARGET + ".MainActivity")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            JSONArray samples = new JSONArray(); long until = SystemClock.elapsedRealtime() + 10000;
            while (SystemClock.elapsedRealtime() < until && samples.length() < 20) {
                Field webField = bridgeActivity.getClass().getDeclaredField("webView"); webField.setAccessible(true);
                WebView web = (WebView) webField.get(bridgeActivity);
                JSONObject snapshot = new JSONObject();
                snapshot.put("trustedLocalDocument", diagnosticField("trustedLocalDocument")).put("startupFailed", diagnosticField("startupFailed")).put("startupReady", diagnosticField("startupReady"));
                if (web == null) { snapshot.put("webViewMissing", true); samples.put(snapshot); break; }
                Object probe = evaluate(web, DIAGNOSTIC_PROBE); snapshot.put("js", probe == null ? JSONObject.NULL : probe); samples.put(snapshot);
                if (probe instanceof JSONObject && "complete".equals(((JSONObject) probe).optString("documentState"))) break;
                SystemClock.sleep(250);
            }
            report.put("samples", samples).put("nativeBootDiagnostics", diagnosticField("bootDiagnostics")).put("nativeFailureCode", diagnosticField("nativeFailureCode"));
            completed = true;
        } catch (Throwable failure) { put(report, "diagnosticFailure", diagnosticFailure(failure)); }
        finally {
            if (bridgeActivity != null) { try { runOnMainSync(() -> bridgeActivity.finish()); waitForIdleSync(); } catch (RuntimeException ignored) { } bridgeActivity = null; }
            put(report, "diagnosticCompleted", completed); put(report, "runtimeSuitePassed", false);
            Bundle result = new Bundle(); result.putString("qa_report", report.toString()); finish(completed ? Activity.RESULT_OK : Activity.RESULT_CANCELED, result);
        }
    }
    private Object diagnosticField(String name) throws Exception {
        Field field = bridgeActivity.getClass().getDeclaredField(name); field.setAccessible(true); return field.get(bridgeActivity);
    }
    private static JSONObject diagnosticFailure(Throwable failure) {
        while (failure instanceof InvocationTargetException && failure.getCause() != null) failure = failure.getCause();
        JSONObject value = new JSONObject(); put(value, "threw", true); put(value, "type", failure.getClass().getSimpleName());
        String code = failure.getMessage(); if (code != null && code.matches("[A-Z_]{3,80}")) put(value, "code", code); return value;
    }
    private static final String DIAGNOSTIC_PROBE =
            "(function(){var r={documentState:document.readyState,local:location.protocol==='https:'&&location.host==='suike.local'};" +
            "function pick(v,a){return typeof v==='string'&&a.indexOf(v)>=0?v:'unknown';}" +
            "function err(e){return {name:pick(e&&e.name,['Error','TypeError','SyntaxError','ReferenceError','RangeError','SecurityError']),code:pick(e&&e.code,['CHECKPOINT_INVALID','CHECKPOINT_WRITE_FAILED','CHECKPOINT_KEY_INVALID','WORKSPACE_CHECKPOINT_UNAVAILABLE','WORKSPACE_CHECKPOINT_UNTRUSTED','TRANSACTION_INVALID','TRANSACTION_RECOVERY_FAILED','STATE_INVALID','LEDGER_INVALID','LEGACY_MARKER_INVALID','HISTORY_INVALID','SEMESTER_ARCHIVE_INVALID','STORAGE_READ_FAILED','JSON_INVALID','VALIDATOR_REQUIRED'])};}" +
            "var b=window.__suikeBoot||{},e=b.error||{};r.phase=pick(b.phase,['bootstrap','seed','model','app','state','render','ready']);r.bootReady=b.ready===true;r.bootError={kind:pick(e.kind,['init','script','promise','csp','resource']),name:pick(e.name,['Error','TypeError','SyntaxError','ReferenceError','RangeError','SecurityError'])};" +
            "var n=window.SuikeNative;r.bridgeType=typeof n;r.getterType=n?typeof n.getWorkspaceCheckpoint:'absent';r.setterType=n?typeof n.persistWorkspaceCheckpoint:'absent';" +
            "if(r.local&&n&&typeof n.getWorkspaceCheckpoint==='function'){try{var v=n.getWorkspaceCheckpoint();r.read={type:typeof v,isNull:v===null,isUndefined:v===undefined,isStringNull:v==='null'};if(typeof v==='string'){r.read.length=v.length;try{var o=JSON.parse(v);r.read.jsonType=o===null?'null':Array.isArray(o)?'array':typeof o;r.read.version=o&&o.version===1;r.read.valueKeyCount=o&&o.values&&typeof o.values==='object'?Object.keys(o.values).length:0;}catch(e){r.read.parseError=err(e);}}}catch(e){r.read={threw:true,error:err(e)};}}" +
            "r.adapterType=typeof window.SuikeWorkspaceStorage;if(r.local&&window.SuikeWorkspaceStorage&&n){try{var a=SuikeWorkspaceStorage.createStorage({getItem:function(){return null;},setItem:function(){},removeItem:function(){}},n);r.adapter={created:true,durable:a.durable===true};" +
            "if(window.SuikeWorkspaceEngine&&window.TimetableModel&&window.JustSafeMerge){try{var keys=SuikeWorkspaceStorage.KEYS,values={};keys.forEach(function(k){values[k]=a.getItem(k);});var memory={getItem:function(k){return values[k];},setItem:function(k,v){values[k]=String(v);},removeItem:function(k){values[k]=null;}};" +
            "var w=SuikeWorkspaceEngine.createWorkspaceStore({storage:memory,validateState:function(v){return TimetableModel.validateState(v);},validateLedger:function(v){return JustSafeMerge.validateLedger(v);}});r.recovery={ok:true,recovered:w.recover()===true};}catch(e){r.recovery={ok:false,error:err(e)};}}" +
            "}catch(e){r.adapter={created:false,error:err(e)};}}return r;})()";

    private JSONObject payload(boolean enabled, long start, int lead) throws Exception {
        long dayEnd = Instant.ofEpochMilli(start).atZone(ZONE).toLocalDate().plusDays(1).atStartOfDay(ZONE).toInstant().toEpochMilli();
        long end = Math.min(start + 30 * 60000L, dayEnd);
        JSONObject course = new JSONObject().put("id", "qa-native-occurrence").put("courseId", "qa-native-course")
                .put("date", Instant.ofEpochMilli(start).atZone(ZONE).toLocalDate().toString()).put("name", "QA_NATIVE_COURSE")
                .put("room", "QA_NATIVE_ROOM").put("startMillis", start).put("endMillis", end);
        return new JSONObject().put("schemaVersion", 1).put("enabled", enabled).put("leadMinutes", lead)
                .put("mutedCourseIds", new JSONArray()).put("occurrences", new JSONArray().put(course));
    }
    private JSONObject sync(String payload) throws Exception { return new JSONObject((String) scheduler.getMethod("sync", Context.class, String.class).invoke(null, target, payload)); }
    private JSONObject status() throws Exception { return new JSONObject((String) scheduler.getMethod("status", Context.class).invoke(null, target)); }
    private JSONObject enable(boolean value) throws Exception { return new JSONObject((String) scheduler.getMethod("setEnabled", Context.class, boolean.class).invoke(null, target, value)); }
    private void refresh() throws Exception { scheduler.getMethod("refresh", Context.class).invoke(null, target); }
    private SharedPreferences preferences() { return target.getSharedPreferences("native-feature-state-v1", Context.MODE_PRIVATE); }
    private void fireProductionReceiver() throws Exception {
        Class<?> receiver = Class.forName(TARGET + ".FeatureAlarmReceiver", true, target.getClassLoader());
        receiver.getMethod("onReceive", Context.class, Intent.class).invoke(receiver.getConstructor().newInstance(), target,
                new Intent("cn.suike.timetable.FEATURE_ALARM"));
    }

    private List<StatusBarNotification> ownNotifications() {
        List<StatusBarNotification> result = new ArrayList<>();
        for (StatusBarNotification active : ((NotificationManager) target.getSystemService(Context.NOTIFICATION_SERVICE)).getActiveNotifications())
            if (CHANNEL.equals(active.getNotification().getChannelId()) && active.getTag() != null && active.getTag().startsWith(PREFIX)) result.add(active);
        return result;
    }
    private int courseNotificationCount() {
        int count = 0;
        for (StatusBarNotification active : ((NotificationManager) target.getSystemService(Context.NOTIFICATION_SERVICE)).getActiveNotifications())
            if (CHANNEL.equals(active.getNotification().getChannelId())) count++;
        return count;
    }
    private void cancelOwnNotifications() {
        NotificationManager manager = (NotificationManager) target.getSystemService(Context.NOTIFICATION_SERVICE);
        for (StatusBarNotification notification : ownNotifications()) manager.cancel(notification.getTag(), notification.getId());
    }
    private void waitForNotification() throws Exception {
        long deadline = SystemClock.uptimeMillis() + 5000;
        while (SystemClock.uptimeMillis() < deadline) { if (!ownNotifications().isEmpty()) return; SystemClock.sleep(100); }
        throw new AssertionError("NOTIFICATION_NOT_POSTED");
    }
    private void waitForNotificationCount(int count) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 5000;
        while (SystemClock.uptimeMillis() < deadline) { if (ownNotifications().size() == count) return; SystemClock.sleep(100); }
        throw new AssertionError("NOTIFICATION_CANCEL_NOT_COMPLETED");
    }

    private void testOcr() throws Exception {
        ClassLoader loader = target.getClassLoader(); Class<?> ocr = Class.forName(TARGET + ".NoticeOcr", true, loader);
        Class<?> callbackType = Class.forName(TARGET + ".NoticeOcr$Result", true, loader);
        CountDownLatch complete = new CountDownLatch(1); AtomicReference<String> text = new AtomicReference<>("");
        AtomicReference<String> error = new AtomicReference<>("CALLBACK_MISSING");
        Object callback = Proxy.newProxyInstance(loader, new Class<?>[] { callbackType }, (proxy, method, args) -> {
            if (method.getName().equals("completed")) { text.set((String) args[0]); error.set((String) args[1]); complete.countDown(); }
            return null;
        });
        long began = SystemClock.elapsedRealtime();
        boolean accepted = (Boolean) ocr.getMethod("recognize", Context.class, Uri.class, callbackType).invoke(null, target,
                Uri.parse("content://" + SyntheticNoticeProvider.AUTHORITY + "/notice.png"), callback);
        require(accepted, "OCR_BUSY_UNEXPECTED"); require(complete.await(90, TimeUnit.SECONDS), "OCR_TIMEOUT");
        require("none".equals(error.get()), "OFFLINE_OCR_FAILED");
        String normalized = text.get().replaceAll("\\s+", "");
        require(normalized.contains("高等数学") && normalized.contains("通知") && normalized.contains("教室")
                && normalized.contains("A301"), "CHINESE_OCR_EXPECTED_WORDS_MISSING");
        record("production_offline_ocr_synthetic_content_provider", new JSONObject().put("chineseCourseRecognized", true)
                .put("noticeAndRoomRecognized", true).put("durationMillis", SystemClock.elapsedRealtime() - began).put("recognizedCharacters", text.get().length()));
    }

    private void testWorkspaceCheckpoint() throws Exception {
        new AtomicFile(checkpointFile()).delete();
        require(readCheckpoint() == null, "MISSING_CHECKPOINT_NOT_NULL");
        JSONObject values = new JSONObject().put("suike.timetable.v1", "not inner JSON: 高等数学")
                .put("suike.history.v1", JSONObject.NULL).put("suike.semesters.v1", "[]")
                .put("suike.workspace.transaction.v1", JSONObject.NULL);
        JSONObject valid = new JSONObject().put("version", 1).put("values", values);
        String durable = valid.toString();
        require(persistCheckpoint(durable) && durable.equals(readCheckpoint()), "CHECKPOINT_ROUNDTRIP_FAILED");
        List<String> rejected = new ArrayList<>();
        rejected.add(new JSONObject(durable).put("version", 2).toString());
        rejected.add(new JSONObject(durable).put("extra", "forbidden").toString());
        JSONObject invalid = new JSONObject(durable); invalid.getJSONObject("values").remove("suike.history.v1"); rejected.add(invalid.toString());
        invalid = new JSONObject(durable); invalid.getJSONObject("values").put("unexpected.key", "forbidden"); rejected.add(invalid.toString());
        invalid = new JSONObject(durable); invalid.getJSONObject("values").put("suike.timetable.v1", true); rejected.add(invalid.toString());
        rejected.add(durable.replace("\"version\":1", "\"version\":1,\"version\":1"));
        rejected.add(durable.replace("\"suike.history.v1\":null", "\"suike.history.v1\":null,\"suike.history.v1\":null"));
        rejected.add(durable.replace("\"version\":1", "'version':1"));
        char[] multibyte = new char[6 * 1024 * 1024]; Arrays.fill(multibyte, '中');
        invalid = new JSONObject(durable); invalid.getJSONObject("values").put("suike.timetable.v1", new String(multibyte));
        rejected.add(invalid.toString());
        for (String payload : rejected) {
            require(!persistCheckpoint(payload), "INVALID_CHECKPOINT_ACCEPTED");
            require(durable.equals(readCheckpoint()), "INVALID_CHECKPOINT_OVERWROTE_STORE");
        }
        writeCheckpointRaw("broken checkpoint".getBytes(StandardCharsets.UTF_8)); expectCheckpointReadFailure();
        writeCheckpointRaw(new byte[] { (byte) 0xc3, 0x28 }); expectCheckpointReadFailure();
        require(persistCheckpoint(durable), "CHECKPOINT_RECOVERY_WRITE_FAILED");
        try (FileOutputStream partial = new FileOutputStream(new File(checkpointFile().getPath() + ".new"))) {
            partial.write("incomplete".getBytes(StandardCharsets.UTF_8)); partial.getFD().sync();
        }
        require(durable.equals(readCheckpoint()), "PARTIAL_CHECKPOINT_REPLACED_COMMIT");
        record("workspace_checkpoint_durable_roundtrip_reject_corruption", new JSONObject().put("invalidFixturesRejected", rejected.size())
                .put("invalidWritesPreservedPrevious", true).put("opaqueInnerStringsAccepted", true)
                .put("corruptReadThrowsInsteadOfNull", true).put("invalidUtf8Rejected", true).put("partialWriteRecovered", true));
    }
    private boolean persistCheckpoint(String payload) throws Exception {
        return (Boolean) checkpoint.getMethod("persist", Context.class, String.class).invoke(null, target, payload);
    }
    private String readCheckpoint() throws Exception { return (String) checkpoint.getMethod("read", Context.class).invoke(null, target); }
    private void expectCheckpointReadFailure() throws Exception {
        try { readCheckpoint(); throw new AssertionError("CORRUPT_CHECKPOINT_READ_AS_ABSENT"); }
        catch (InvocationTargetException failure) {
            require(failure.getCause() instanceof IllegalStateException
                    && "WORKSPACE_CHECKPOINT_UNAVAILABLE".equals(failure.getCause().getMessage())
                    && failure.getCause().getCause() == null, "CHECKPOINT_READ_ERROR_LEAKED_DETAILS");
        }
    }
    private File checkpointFile() { return new File(target.getFilesDir(), "workspace-checkpoint-v1.json"); }
    private byte[] readCheckpointBytes() throws Exception {
        File file = checkpointFile();
        if (!file.exists() && !new File(file.getPath() + ".bak").exists()) return null;
        try (FileInputStream in = new AtomicFile(file).openRead(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] block = new byte[8192]; int n;
            while ((n = in.read(block)) != -1) { require(out.size() + n <= 16 * 1024 * 1024, "CHECKPOINT_TOO_LARGE"); out.write(block, 0, n); }
            return out.toByteArray();
        }
    }
    private void writeCheckpointRaw(byte[] bytes) throws Exception {
        AtomicFile file = new AtomicFile(checkpointFile()); FileOutputStream out = file.startWrite();
        try { out.write(bytes); out.getFD().sync(); file.finishWrite(out); }
        catch (Exception error) { file.failWrite(out); throw error; }
    }

    private void testCheckpointBridge() throws Exception {
        // Restore the pre-test valid workspace before allowing the real app to bootstrap its JS validators.
        if (originalCheckpoint == null) new AtomicFile(checkpointFile()).delete(); else writeCheckpointRaw(originalCheckpoint);
        bridgeActivity = startActivitySync(new Intent().setClassName(TARGET, TARGET + ".MainActivity")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        Field readyField = bridgeActivity.getClass().getDeclaredField("startupReady"); readyField.setAccessible(true);
        Field webField = bridgeActivity.getClass().getDeclaredField("webView"); webField.setAccessible(true);
        long deadline = SystemClock.uptimeMillis() + 20000; boolean ready = false;
        while (SystemClock.uptimeMillis() < deadline) {
            AtomicReference<Boolean> loaded = new AtomicReference<>(false);
            runOnMainSync(() -> { try { loaded.set(readyField.getBoolean(bridgeActivity)); } catch (Exception ignored) {} });
            if (loaded.get()) { ready = true; break; } SystemClock.sleep(100);
        }
        require(ready, "CHECKPOINT_BRIDGE_APP_NOT_READY");
        WebView web = (WebView) webField.get(bridgeActivity);
        Object existing = evaluate(web, "window.SuikeNative.getWorkspaceCheckpoint()");
        String candidate;
        if ("null".equals(existing)) {
            JSONObject values = new JSONObject().put("suike.timetable.v1", JSONObject.NULL).put("suike.history.v1", JSONObject.NULL)
                    .put("suike.semesters.v1", JSONObject.NULL).put("suike.workspace.transaction.v1", JSONObject.NULL);
            candidate = new JSONObject().put("version", 1).put("values", values).toString();
        } else { require(existing instanceof String, "CHECKPOINT_BRIDGE_READ_TYPE"); candidate = (String) existing; }
        new AtomicFile(checkpointFile()).delete();
        require(Boolean.TRUE.equals(evaluate(web, "(function(){var p=SuikeNative.getWorkspaceCheckpoint();return typeof p==='string'&&p==='null';})()")),
                "CHECKPOINT_BRIDGE_ABSENCE_SENTINEL");
        String quoted = JSONObject.quote(candidate).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
        require(Boolean.TRUE.equals(evaluate(web, "(function(){var p=" + quoted + ";return SuikeNative.persistWorkspaceCheckpoint(p)===true&&SuikeNative.getWorkspaceCheckpoint()===p;})()")),
                "CHECKPOINT_BRIDGE_SYNCHRONOUS_ROUNDTRIP");
        require(Boolean.TRUE.equals(evaluate(web, "(function(){var p=SuikeNative.getWorkspaceCheckpoint();return SuikeNative.persistWorkspaceCheckpoint('{\"version\":1,\"values\":{}}')===false&&SuikeNative.getWorkspaceCheckpoint()===p;})()")),
                "CHECKPOINT_BRIDGE_INVALID_OVERWROTE");
        writeCheckpointRaw("corrupt synthetic checkpoint".getBytes(StandardCharsets.UTF_8));
        require(Boolean.TRUE.equals(evaluate(web, "(function(){try{var p=SuikeNative.getWorkspaceCheckpoint();return p!==null&&typeof p!=='string';}catch(_){return true;}})()")),
                "CHECKPOINT_BRIDGE_CORRUPT_READ_AS_ABSENT");
        writeCheckpointRaw(candidate.getBytes(StandardCharsets.UTF_8));
        runOnMainSync(() -> bridgeActivity.finish()); waitForIdleSync(); bridgeActivity = null;
        record("trusted_webview_synchronous_checkpoint_bridge", new JSONObject().put("absenceIsExplicitJsonNullString", true).put("writeReadCompletedBeforeJsReturn", true)
                .put("prevalidationFailurePreservedCommit", true).put("corruptReadFailedClosed", true));
    }

    private void testNormalRestarts() throws Exception {
        if (originalCheckpoint == null) new AtomicFile(checkpointFile()).delete(); else writeCheckpointRaw(originalCheckpoint);
        for (int attempt = 1; attempt <= 20; attempt++) {
            launchNormalAndAwaitReady(attempt, "restored_original_checkpoint"); finishBridgeActivity();
        }
        record("twenty_normal_main_activity_restarts", new JSONObject().put("attempts", 20)
                .put("watchdogDisabled", false).put("nativeWatchdogMillis", 15000).put("originalWorkspaceUtf8Bytes", originalCheckpoint == null ? 0 : originalCheckpoint.length)
                .put("runs", normalStartupRuns));
    }

    private WebView launchNormalAndAwaitReady(int attempt, String fixture) throws Exception {
        long started = SystemClock.elapsedRealtime(); JSONObject run = new JSONObject().put("attempt", attempt).put("fixture", fixture);
        normalStartupRuns.put(run);
        bridgeActivity = startActivitySync(new Intent().setClassName(TARGET, TARGET + ".MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        Field ready = bridgeActivity.getClass().getDeclaredField("startupReady"); ready.setAccessible(true);
        Field failed = bridgeActivity.getClass().getDeclaredField("startupFailed"); failed.setAccessible(true);
        Field deadline = bridgeActivity.getClass().getDeclaredField("bootDeadline"); deadline.setAccessible(true);
        Field failureCode = bridgeActivity.getClass().getDeclaredField("nativeFailureCode"); failureCode.setAccessible(true);
        Field web = bridgeActivity.getClass().getDeclaredField("webView"); web.setAccessible(true);
        Field trust = bridgeActivity.getClass().getDeclaredField("trustedLocalDocument"); trust.setAccessible(true);
        Field bootDiagnostics = bridgeActivity.getClass().getDeclaredField("bootDiagnostics"); bootDiagnostics.setAccessible(true);
        JSONArray earlySamples = new JSONArray(); run.put("earlySamples", earlySamples);
        AtomicBoolean probeInFlight = new AtomicBoolean(false); long lastProbe = 0;
        long observationDeadline = deadline.getLong(bridgeActivity) + 1200;
        for (;;) {
            AtomicReference<Boolean> isReady = new AtomicReference<>(false), isFailed = new AtomicReference<>(false);
            runOnMainSync(() -> {
                try { isReady.set(ready.getBoolean(bridgeActivity)); isFailed.set(failed.getBoolean(bridgeActivity)); }
                catch (IllegalAccessException error) { throw new IllegalStateException("NORMAL_STARTUP_REFLECTION_FAILED"); }
            });
            long now = SystemClock.elapsedRealtime();
            if (!isFailed.get() && earlySamples.length() < 40 && now - lastProbe >= 200 && probeInFlight.compareAndSet(false, true)) {
                lastProbe = now; final Activity owner = bridgeActivity;
                runOnMainSync(() -> {
                    try {
                        WebView view = (WebView) web.get(owner);
                        if (view == null) { probeInFlight.set(false); return; }
                        JSONObject sample = new JSONObject().put("elapsedMs", SystemClock.elapsedRealtime() - started)
                                .put("trustedBeforeProbe", trust.getBoolean(owner));
                        view.evaluateJavascript(DIAGNOSTIC_PROBE, raw -> {
                            try {
                                Object decoded = new JSONTokener(raw).nextValue();
                                sample.put("js", decoded instanceof JSONObject ? decoded : JSONObject.NULL)
                                        .put("callbackElapsedMs", SystemClock.elapsedRealtime() - started).put("trustedAtCallback", trust.getBoolean(owner));
                                synchronized (earlySamples) { earlySamples.put(sample); }
                            } catch (Exception ignored) { }
                            finally { probeInFlight.set(false); }
                        });
                    } catch (Exception ignored) { probeInFlight.set(false); }
                });
            }
            if (isReady.get()) {
                run.put("ready", true).put("elapsedMs", SystemClock.elapsedRealtime() - started).put("failureCode", "none");
                return (WebView) web.get(bridgeActivity);
            }
            if (isFailed.get() || SystemClock.elapsedRealtime() >= observationDeadline) {
                run.put("ready", false).put("elapsedMs", SystemClock.elapsedRealtime() - started)
                        .put("failureCode", isFailed.get() ? "NATIVE_STARTUP_FAILED" : "NORMAL_READY_OBSERVATION_TIMEOUT");
                Object nativeCode = failureCode.get(bridgeActivity);
                if (nativeCode instanceof String && ((String) nativeCode).matches("(?:none|main-frame--?[0-9]{1,3}|renderer-crashed|renderer-reclaimed)")) run.put("nativeFailureCode", nativeCode);
                run.put("nativeBootDiagnostics", bootDiagnostics.get(bridgeActivity));
                throw new AssertionError(isFailed.get() ? "NATIVE_STARTUP_FAILED" : "NORMAL_READY_OBSERVATION_TIMEOUT");
            }
            SystemClock.sleep(50);
        }
    }

    private void finishBridgeActivity() {
        if (bridgeActivity == null) return;
        runOnMainSync(() -> bridgeActivity.finish()); waitForIdleSync(); bridgeActivity = null;
    }

    private Object evaluate(WebView web, String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1); AtomicReference<Object> value = new AtomicReference<>();
        runOnMainSync(() -> web.evaluateJavascript(script, result -> {
            try { value.set(new JSONTokener(result).nextValue()); } catch (Exception ignored) { value.set(null); }
            done.countDown();
        }));
        require(done.await(20, TimeUnit.SECONDS), "CHECKPOINT_BRIDGE_CALLBACK_TIMEOUT"); return value.get();
    }

    private byte[] readSnapshot() throws Exception {
        File file = new File(target.getFilesDir(), "native-features-v1.json");
        if (!file.exists() && !new File(file.getPath() + ".bak").exists()) return null;
        try (FileInputStream in = new AtomicFile(file).openRead(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] block = new byte[8192]; int n; while ((n = in.read(block)) != -1) { require(out.size() + n <= 1048576, "SNAPSHOT_TOO_LARGE"); out.write(block, 0, n); }
            return out.toByteArray();
        }
    }
    private void restore() throws Exception {
        if (bridgeActivity != null) { runOnMainSync(() -> bridgeActivity.finish()); waitForIdleSync(); bridgeActivity = null; }
        cancelOwnNotifications(); waitForNotificationCount(0);
        Field field = scheduler.getDeclaredField("LOCK"); field.setAccessible(true);
        synchronized (field.get(null)) {
            AtomicFile file = new AtomicFile(new File(target.getFilesDir(), "native-features-v1.json"));
            if (originalSnapshot == null) file.delete();
            else { FileOutputStream out = file.startWrite(); try { out.write(originalSnapshot); file.finishWrite(out); } catch (Exception error) { file.failWrite(out); throw error; } }
            SharedPreferences.Editor edit = preferences().edit().clear();
            for (Map.Entry<String, ?> entry : originalPreferences.entrySet()) {
                Object value = entry.getValue(); String key = entry.getKey();
                if (value instanceof String) edit.putString(key, (String) value);
                else if (value instanceof Boolean) edit.putBoolean(key, (Boolean) value);
                else if (value instanceof Integer) edit.putInt(key, (Integer) value);
                else if (value instanceof Long) edit.putLong(key, (Long) value);
                else if (value instanceof Float) edit.putFloat(key, (Float) value);
                else if (value instanceof Set) edit.putStringSet(key, new HashSet<>((Set<String>) value));
            }
            require(edit.commit(), "PREFERENCES_RESTORE_FAILED"); refresh();
            require(Arrays.equals(originalSnapshot, readSnapshot()), "NATIVE_SNAPSHOT_NOT_RESTORED");
            Object expected = originalPreferences.get("delivered");
            Set<String> actual = preferences().getStringSet("delivered", new HashSet<String>());
            require(expected == null ? actual.isEmpty() : expected.equals(actual), "DELIVERY_LEDGER_NOT_RESTORED");
        }
        Field checkpointLock = checkpoint.getDeclaredField("LOCK"); checkpointLock.setAccessible(true);
        synchronized (checkpointLock.get(null)) {
            if (originalCheckpoint == null) new AtomicFile(checkpointFile()).delete();
            else writeCheckpointRaw(originalCheckpoint);
            require(Arrays.equals(originalCheckpoint, readCheckpointBytes()), "WORKSPACE_CHECKPOINT_NOT_RESTORED");
        }
    }

    private void revisionWait(WebView web, String expression, String code) throws Exception {
        long end=SystemClock.elapsedRealtime()+30000;
        do { if(Boolean.TRUE.equals(evaluate(web, expression)))return;SystemClock.sleep(100); } while(SystemClock.elapsedRealtime()<end);
        throw new AssertionError(code);
    }
    private void revisionPicture(String name) throws Exception {
        SystemClock.sleep(500);final AtomicReference<android.graphics.Bitmap> capturedImage=new AtomicReference<>();
        final CountDownLatch captureDone=new CountDownLatch(1);final AtomicReference<Integer> captureCode=new AtomicReference<>();
        runOnMainSync(()->{android.view.View decor=bridgeActivity.getWindow().getDecorView();android.graphics.Bitmap frame=android.graphics.Bitmap.createBitmap(decor.getWidth(),decor.getHeight(),android.graphics.Bitmap.Config.ARGB_8888);capturedImage.set(frame);android.view.PixelCopy.request(bridgeActivity.getWindow(),frame,result->{captureCode.set(result);captureDone.countDown();},new android.os.Handler(android.os.Looper.getMainLooper()));});
        require(captureDone.await(5,TimeUnit.SECONDS)&&captureCode.get()!=null&&captureCode.get()==android.view.PixelCopy.SUCCESS,"APP_WINDOW_CAPTURE_FAILED");
        android.graphics.Bitmap image=capturedImage.get();require(image!=null,"SCREENSHOT_UNAVAILABLE");
        File imageRoot=target.getExternalFilesDir(null);if(imageRoot==null)imageRoot=target.getFilesDir();
        File directory=new File(imageRoot,"revision-beta18");require(directory.isDirectory()||directory.mkdirs(),"SCREENSHOT_DIRECTORY_UNAVAILABLE");
        try(FileOutputStream out=new FileOutputStream(new File(directory,name+".png"))){require(image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out),"SCREENSHOT_WRITE_FAILED");}finally{image.recycle();}
    }
    private void runRevision() {
        JSONObject report=new JSONObject();boolean passed=false,restored=false;WebView web=null;String appearance=null,wallpaperMode=null;boolean savedAppearance=false,mediaOwned=false;
        try {
            require(Build.VERSION.SDK_INT==36&&"ranchu".equals(Build.HARDWARE),"EMULATOR_ONLY");target=getTargetContext();require(TARGET.equals(target.getPackageName()),"TARGET_MISMATCH");
            require("1.6.0-beta.18".equals(target.getPackageManager().getPackageInfo(TARGET,0).versionName),"VERSION_MISMATCH");
            scheduler=Class.forName(TARGET+".FeatureScheduler",true,target.getClassLoader());checkpoint=Class.forName(TARGET+".WorkspaceCheckpoint",true,target.getClassLoader());
            step="normal_launch";web=launchNormalAndAwaitReady(1,"beta18-original");SystemClock.sleep(700);
            originalSnapshot=readSnapshot();originalCheckpoint=readCheckpointBytes();originalPreferences=preferences().getAll();captured=true;
            Object stored=evaluate(web,"localStorage.getItem('suike.appearance.v1')");appearance=stored instanceof String?(String)stored:null;Object modeStored=evaluate(web,"localStorage.getItem('suike.wallpaper.mode.v1')");wallpaperMode=modeStored instanceof String?(String)modeStored:null;savedAppearance=true;
            evaluate(web,"(function(){window.__qaMediaEmpty=false;var r=indexedDB.open('suike.wallpaper.v1',1);r.onsuccess=function(){var db=r.result,tx=db.transaction('media','readonly');var q=tx.objectStore('media').get('current');q.onsuccess=function(){window.__qaMediaEmpty=!q.result;db.close();};};})()");
            revisionWait(web,"window.__qaMediaEmpty===true","EXISTING_MEDIA_MUST_BE_PRESERVED");mediaOwned=true;
            step="pending_time_editor";
            evaluate(web,"(function(){document.querySelectorAll('dialog[open]').forEach(d=>d.close());var s=SuikeFeatures.getState();s.periods=[['08:00','08:45'],['08:55','09:40'],['10:00','10:45'],['10:55','11:40'],['14:00','14:45'],['14:55','15:40'],['16:00','16:45'],['16:55','17:40'],['19:00','19:45'],['19:55','20:40']].map(p=>({start:p[0],end:p[1]}));var date=new Date(Date.now()+28800000).toISOString().slice(0,10);s.courses=[{id:'qa-revision',name:'Time Test',day:TimetableModel.dayOf(date),start:null,end:null,timeMode:'pending',timeNote:'19:00开始，结束时间待确认',sourceTime:'',dates:[date],room:'A101',teacher:'',color:'teal'}];s.importLedger=null;s.skipLegacyImportBaseline=true;s.productSettings=SuikeFeatures.settings();s.productSettings.setupCompleted=true;s.productSettings.reminders.enabled=false;SuikeFeatures.commitState(s,'runtime fixture');document.querySelector('#agendaPending button').click();document.getElementById('editCourse').click();document.getElementById('courseFinish').value='20:05';document.getElementById('courseFinish').dispatchEvent(new Event('change',{bubbles:true}));})()");
            revisionPicture("course-times");
            require(Boolean.TRUE.equals(evaluate(web,"document.getElementById('courseBegin').value==='19:00'&&!document.getElementById('pendingTime').checked")),"CLOCK_FIELDS_NOT_LINKED");
            evaluate(web,"document.querySelector('#courseForm button[type=submit]').click()");
            revisionWait(web,"SuikeFeatures.getState().courses[0].timeMode==='clock'&&SuikeFeatures.getState().courses[0].sourceTime==='19:00-20:05'","TIME_NOT_CONFIRMED");record("pending_time_becomes_confirmed",new JSONObject());SystemClock.sleep(250);
            step="periods_11_12";evaluate(web,"document.querySelector('[data-view=settings]').click();document.getElementById('settingsPeriodsDetails').open=true");
            for(int n=11;n<=12;n++){
                evaluate(web,"document.getElementById('addPeriod').click();document.getElementById('periodStart').value='"+(n==11?"20:50":"21:45")+"';document.getElementById('periodEnd').value='"+(n==11?"21:35":"22:30")+"';document.getElementById('productConfirm').click()");
                revisionWait(web,"SuikeFeatures.getState().periods.length==="+n,"PERIOD_APPEND_FAILED");SystemClock.sleep(250);
            }
            require(Boolean.TRUE.equals(evaluate(web,"document.querySelectorAll('.grid-time').length===12&&!document.getElementById('addPeriod').disabled")),"GRID_NOT_EXTENDED");record("periods_and_grid_extend_to_12",new JSONObject());
            step="daily_period_count";
            evaluate(web,"var s=SuikeFeatures.getState(),c=s.courses[0];s.courses.push({id:'qa-occupied-guard',name:'节次保护',day:c.day,start:9,end:10,dates:c.dates.slice(),sourceTime:'19:00-20:40',room:'',teacher:'',color:'teal'});SuikeFeatures.commitState(s,'occupied guard fixture')");
            evaluate(web,"document.getElementById('editDailyPeriods').click();document.getElementById('dailyPeriodCount').value='9';document.getElementById('dailyPeriodCount').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('productConfirm').click()");
            require(Boolean.TRUE.equals(evaluate(web,"SuikeFeatures.getState().periods.length===12&&document.getElementById('productError').textContent.includes('仍有')")),"OCCUPIED_PERIOD_REMOVED");
            evaluate(web,"document.getElementById('dailyPeriodCount').value='13';document.getElementById('dailyPeriodCount').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('dailyPeriodStart13').value='22:40';document.getElementById('dailyPeriodEnd13').value='23:25';document.getElementById('productConfirm').click()");
            revisionWait(web,"SuikeFeatures.getState().periods.length===13&&document.querySelectorAll('.grid-time').length===13","DAILY_PERIOD_COUNT_NOT_SAVED");record("daily_count_and_occupied_course_protection",new JSONObject());
            evaluate(web,"var s=SuikeFeatures.getState();s.courses=s.courses.filter(c=>c.id!=='qa-occupied-guard');SuikeFeatures.commitState(s,'remove guard fixture')");
            step="chat_layout";evaluate(web,"document.getElementById('deepSeekEntry').click();document.getElementById('deepSeekConfig').open=false");revisionPicture("deepseek-chat");
            require(Boolean.TRUE.equals(evaluate(web,"document.getElementById('deepSeekChat').getAttribute('role')==='log'&&document.getElementById('deepSeekCourseText').placeholder==='发消息，或添加课程文件'")),"CHAT_UI_MISSING");record("chat_page_and_minimal_entry_render",new JSONObject());
            evaluate(web,"document.querySelector('#deepSeekDialog .ai-head .icon-button').click();document.getElementById('settingsDisplayDetails').open=true");SystemClock.sleep(250);
            step="local_image_wallpaper";
            evaluate(web,"(function(){var c=document.createElement('canvas');c.width=400;c.height=800;var x=c.getContext('2d');var g=x.createLinearGradient(0,0,400,800);g.addColorStop(0,'#142537');g.addColorStop(.45,'#477c9b');g.addColorStop(.7,'#d6c9a8');g.addColorStop(1,'#f2e9d2');x.fillStyle=g;x.fillRect(0,0,400,800);for(var j=0;j<800;j+=36){x.strokeStyle=j%72?'rgba(255,255,255,.22)':'rgba(0,0,0,.15)';x.lineWidth=2;x.beginPath();x.moveTo(0,j);x.bezierCurveTo(100,j-24,280,j+24,400,j-8);x.stroke();}c.toBlob(function(blob){try{var d=new DataTransfer();d.items.add(new File([blob],'runtime-wallpaper.png',{type:'image/png'}));var input=document.getElementById('wallpaperImage');input.files=d.files;input.dispatchEvent(new Event('change',{bubbles:true}));}catch(e){window.__qaImageError=e.name+':'+e.message;}},'image/png');})()");
            revisionWait(web,"document.documentElement.dataset.wallpaper==='on'&&SuikeAppearance.isEnabled()&&document.getElementById('wallpaperStatus').textContent.startsWith('图片')","IMAGE_WALLPAPER_NOT_SAVED");
            evaluate(web,"document.getElementById('displaySettings').scrollIntoView({block:'center'})");revisionPicture("wallpaper-settings");record("local_image_saves_and_enables_glass",new JSONObject());
            step="settings_icons";
            evaluate(web,"document.getElementById('settingsDisplayDetails').open=false;document.getElementById('displaySettings').scrollIntoView({block:'start'});document.getElementById('toast').hidden=true");
            require(Boolean.TRUE.equals(evaluate(web,"(function(){var base=document.querySelector('#settingsForm .section-icon'),display=document.querySelector('#displaySettings .card-heading .section-icon'),imported=document.querySelector('[aria-labelledby=teachingImportTitle] .card-heading .section-icon');return !!(display&&imported&&display.querySelector('svg')&&imported.querySelector('svg'))&&getComputedStyle(display).width===getComputedStyle(base).width&&getComputedStyle(imported.querySelector('svg')).strokeWidth===getComputedStyle(base.querySelector('svg')).strokeWidth;})()")),"SETTINGS_ICONS_MISSING_OR_INCONSISTENT");
            revisionPicture("settings-icons");record("settings_icons_use_shared_geometry",new JSONObject());
            step="shared_fluid_rims";
            evaluate(web,"window.__qaFrame=function(id){var el=document.getElementById(id),v=el.style.backdropFilter,k=v.indexOf('#');if(k<0)return null;var name=v.substring(k+1,v.lastIndexOf(')'));if(name.charCodeAt(name.length-1)===34||name.charCodeAt(name.length-1)===39)name=name.slice(0,-1);var f=document.getElementById(name);return f?{el:el,filter:f,image:f.querySelector('feImage')}:null;};window.__qaFrameFits=function(id){var t=window.__qaFrame(id);return !!t&&+t.filter.getAttribute('width')===t.el.offsetWidth&&+t.filter.getAttribute('height')===t.el.offsetHeight&&+t.image.getAttribute('height')===t.el.offsetHeight;};document.getElementById('settingsDisplayDetails').open=false;document.getElementById('displaySettings').scrollIntoView({block:'start'});SuikeAppearance.setFrost(0,true)");
            revisionWait(web,"window.__qaFrameFits('displaySettings')","INITIAL_CARD_OPTICS_NOT_READY");
            evaluate(web,"var f=document.getElementById('settingsDisplayDetails');window.__qaOriginalFilter=window.__qaFrame('displaySettings').filter.id;f.querySelector('summary').click();window.__qaFold=f.getAnimations()[0];window.__qaFold.pause();window.__qaFold.currentTime=70;window.__qaFoldHeight=f.getBoundingClientRect().height");
            revisionWait(web,"window.__qaFrameFits('displaySettings')","STRETCHED_FRAME_NOT_FOLLOWING_CARD");
            require(Boolean.TRUE.equals(evaluate(web,"document.getElementById('displaySettings').classList.contains('lg-refracted-card')&&window.__qaFrame('displaySettings').filter.id===window.__qaOriginalFilter&&getComputedStyle(document.getElementById('displaySettings')).boxShadow==='none'&&getComputedStyle(document.getElementById('displaySettings')).borderTopColor==='rgba(0, 0, 0, 0)'")),"STRETCH_REMOVED_OR_FIXED_OUTER_RIM_REMAINS");
            revisionPicture("fluid-rim-expanding-early");
            evaluate(web,"window.__qaFold.currentTime=180");
            revisionWait(web,"window.__qaFrameFits('displaySettings')","MID_FOLD_FRAME_NOT_STRETCHED");
            require(Boolean.TRUE.equals(evaluate(web,"document.getElementById('settingsDisplayDetails').getBoundingClientRect().height>window.__qaFoldHeight&&window.__qaFrame('displaySettings').filter.id===window.__qaOriginalFilter")),"OPTICAL_STRETCH_DID_NOT_PERSIST");
            require(Boolean.TRUE.equals(evaluate(web,"window.__qaFrame('displaySettings').el.querySelector('.lg-optical-sheen').dataset.vectorRim==='true'&&+window.__qaFrame('displaySettings').el.querySelector('.lg-optical-sheen').dataset.lensResolution>1&&window.__qaFrame('displaySettings').el.querySelector('.lg-optical-sheen').style.backgroundImage.includes('svg')")),"SCALABLE_RIM_OR_HIGH_RES_LENS_MISSING");
            revisionPicture("fluid-rim-expanding-middle");
            evaluate(web,"window.__qaFold.finish()");
            revisionWait(web,"!document.getElementById('settingsDisplayDetails').classList.contains('lg-folding')&&window.__qaFrameFits('displaySettings')&&window.__qaFrame('displaySettings').filter.id!==window.__qaOriginalFilter","SETTLED_OPTICS_NOT_REBUILT");
            revisionPicture("fluid-rim-expanded-settled");
            evaluate(web,"var f=document.getElementById('settingsDisplayDetails');f.querySelector('summary').click();window.__qaFold=f.getAnimations()[0];window.__qaFold.pause();window.__qaFold.currentTime=100;window.__qaReverseHeight=f.getBoundingClientRect().height;f.querySelector('summary').click();window.__qaFold=f.getAnimations()[0];window.__qaFold.pause();window.__qaFold.currentTime=0");
            require(Boolean.TRUE.equals(evaluate(web,"Math.abs(document.getElementById('settingsDisplayDetails').getBoundingClientRect().height-window.__qaReverseHeight)<1.5")),"RAPID_REVERSAL_SNAPPED_HEIGHT");
            evaluate(web,"window.__qaFold.finish()");
            revisionWait(web,"!document.getElementById('settingsDisplayDetails').classList.contains('lg-folding')&&window.__qaFrameFits('displaySettings')","REVERSAL_DID_NOT_SETTLE");
            evaluate(web,"var f=document.getElementById('settingsSemesterDetails');f.open=false;f.closest('.settings-card').scrollIntoView({block:'start'})");
            revisionWait(web,"window.__qaFrameFits('settingsForm')","SECOND_CARD_OPTICS_NOT_READY");
            evaluate(web,"var f=document.getElementById('settingsSemesterDetails');window.__qaSemesterFilter=window.__qaFrame('settingsForm').filter.id;f.querySelector('summary').click();window.__qaFold=f.getAnimations()[0];window.__qaFold.pause();window.__qaFold.currentTime=140");
            revisionWait(web,"window.__qaFrameFits('settingsForm')","SECOND_CARD_FRAME_NOT_STRETCHED");
            require(Boolean.TRUE.equals(evaluate(web,"window.__qaFrame('settingsForm').filter.id===window.__qaSemesterFilter&&getComputedStyle(document.getElementById('settingsForm')).boxShadow==='none'")),"SECOND_CARD_KEPT_FIXED_OUTER_RIM");
            revisionPicture("fluid-semester-middle");
            evaluate(web,"window.__qaFold.finish()");
            revisionWait(web,"!document.getElementById('settingsSemesterDetails').classList.contains('lg-folding')&&window.__qaFrameFits('settingsForm')&&window.__qaFrame('settingsForm').filter.id!==window.__qaSemesterFilter","SECOND_CARD_DID_NOT_SETTLE");
            evaluate(web,"var c=document.getElementById('settingsForm');window.__qaOldPadding=c.style.paddingBottom;window.__qaFrameRetargeted=false;var t=window.__qaFrame('settingsForm');window.__qaResizeWatch=new MutationObserver(()=>{if(+t.filter.getAttribute('height')===c.offsetHeight)window.__qaFrameRetargeted=true;});window.__qaResizeWatch.observe(t.filter,{attributes:true,attributeFilter:['height']});c.style.paddingBottom='80px'");
            revisionWait(web,"window.__qaFrameRetargeted===true","GENERAL_RESIZE_DID_NOT_STRETCH_FRAME");
            evaluate(web,"window.__qaResizeWatch.disconnect();document.getElementById('settingsForm').style.paddingBottom=window.__qaOldPadding");
            revisionWait(web,"window.__qaFrameFits('settingsForm')","GENERAL_RESIZE_DID_NOT_SETTLE");
            record("shared_cards_keep_fluid_stretch_without_stationary_outer_rim",new JSONObject());
            step="custom_deepseek";
            evaluate(web,"document.getElementById('deepSeekEntry').click();document.getElementById('deepSeekConfig').open=true;SuikeAppearance.setFrost(0,true)");
            revisionWait(web,"document.getElementById('deepSeekDialog').open&&getComputedStyle(document.getElementById('deepSeekDialog')).color==='rgb(255, 255, 255)'","CUSTOM_CHAT_INK_MISSING");
            require(Boolean.TRUE.equals(evaluate(web,"(function(){var d=document.getElementById('deepSeekDialog'),c=d.querySelector('.ai-composer'),v=d.querySelector('.ai-scroll-content'),s=getComputedStyle(d),m=s.backgroundColor.match(/[0-9.]+/g);return m.length===4&&+m[3]<.1&&s.filter==='none'&&getComputedStyle(d,'::backdrop').backdropFilter==='blur(18px)'&&v.getBoundingClientRect().bottom<=c.getBoundingClientRect().top+1&&getComputedStyle(c).backdropFilter==='blur(18px)'&&getComputedStyle(document.getElementById('deepSeekApiKey')).color==='rgb(255, 255, 255)';})()")),"CHAT_MATERIAL_OR_SCROLL_VIEWPORT_WRONG");
            revisionPicture("deepseek-custom-config");
            evaluate(web,"document.getElementById('deepSeekConfig').open=false;var b=document.createElement('div');b.id='qa-chat-bubble';b.className='ai-bubble ai-bubble-user';b.textContent='周五第 3–4 节，在实验楼 201 上实验课';document.getElementById('deepSeekChat').prepend(b)");
            revisionPicture("deepseek-custom-chat");
            evaluate(web,"document.getElementById('qa-chat-bubble').remove();document.getElementById('deepSeekConfig').open=true;document.querySelector('#deepSeekConfig .suike-control-trigger').click()");
            revisionWait(web,"document.getElementById('suikePicker').open&&document.getElementById('deepSeekDialog').open","DEEPSEEK_NESTED_PICKER_MISSING");
            require(Boolean.TRUE.equals(evaluate(web,"getComputedStyle(document.getElementById('suikePicker'),'::backdrop').backdropFilter==='blur(18px)'&&getComputedStyle(document.getElementById('suikePicker')).color==='rgb(255, 255, 255)'")),"DEEPSEEK_NESTED_APPEARANCE_MISSING");
            revisionPicture("deepseek-custom-nested");
            evaluate(web,"document.querySelector('#suikePicker .picker-close').click()");
            revisionWait(web,"!document.getElementById('suikePicker').open","PICKER_DID_NOT_CLOSE");
            evaluate(web,"document.querySelector('#deepSeekDialog .ai-head .icon-button').click()");
            revisionWait(web,"!document.getElementById('deepSeekDialog').open","CHAT_DID_NOT_CLOSE");
            record("custom_chat_and_nested_picker_share_glass_without_overlap",new JSONObject());
            step="display_card_glass";
            evaluate(web,"(function(){var s=SuikeFeatures.getState(),date=TimetableModel.addDays(s.courses[0].dates[0],1);s.courses[0].dates=[date];s.courses[0].day=TimetableModel.dayOf(date);SuikeFeatures.commitState(s,'future runtime fixture');})();document.querySelector('[data-view=today]').click();SuikeAppearance.setFrost(0,true);window.__qaAlpha=function(el){var color=getComputedStyle(el).backgroundColor;var m=color.match(/[0-9.]+/g)||[];return m.length>3?Number(m[3]):1;};");
            revisionWait(web,"window.__qaAlpha(document.querySelector('.next-card'))<.05&&window.__qaAlpha(document.querySelector('.next-card'))>.02&&document.documentElement.dataset.appearance==='custom'&&getComputedStyle(document.querySelector('.next-card')).backdropFilter!=='none'","DISPLAY_GLASS_MISSING");
            if(Boolean.TRUE.equals(evaluate(web,"!!(SuikeLiquidUI.optics&&SuikeLiquidUI.optics.supported)")))revisionWait(web,"document.querySelector('.next-card').style.backdropFilter.includes('url(')","DISPLAY_REFRACTION_MISSING");
            revisionWait(web,"getComputedStyle(document.querySelector('.next-card')).color==='rgb(255, 255, 255)'&&!window.SuikeGlassLegibility","FIXED_FOREGROUND_MISSING");
            require(Boolean.TRUE.equals(evaluate(web,"parseFloat(document.documentElement.style.getPropertyValue('--lg-nav-blur'))<1&&parseFloat(document.documentElement.style.getPropertyValue('--lg-sheet-blur'))<1")),"HIDDEN_BLUR_FLOOR");
            require(Boolean.TRUE.equals(evaluate(web,"getComputedStyle(document.getElementById('weekLoad')).backdropFilter==='none'&&!document.getElementById('weekLoad').querySelector('.lg-optical-sheen')")),"WEEK_LOAD_MUST_NOT_REFRACT");
            evaluate(web,"document.getElementById('toast').hidden=true;window.scrollTo(0,0)");
            require(Boolean.TRUE.equals(evaluate(web,"document.querySelector('.lg-scroll-edge').parentElement===document.querySelector('.bottom-nav').parentElement")),"NAV_OCCLUDED_BY_SCROLL_EDGE");
            revisionPicture("today-clear-glass");
            step="modal_backdrop_depth";
            evaluate(web,"document.querySelector('.next-card').click()");
            revisionWait(web,"document.getElementById('courseDialog').open&&getComputedStyle(document.getElementById('courseDialog'),'::backdrop').backdropFilter==='blur(18px)'","DETAIL_BACKDROP_NOT_BLURRED");
            require(Boolean.TRUE.equals(evaluate(web,"getComputedStyle(document.getElementById('courseDialog')).filter==='none'&&SuikeAppearance.frostLevels().sheetBlur===.8")),"FOREGROUND_MUST_STAY_CLEAR");
            revisionPicture("detail-modal-blurred");
            evaluate(web,"document.getElementById('editCourse').click()");
            revisionWait(web,"document.getElementById('editDialog').open&&!document.getElementById('courseDialog').open","EDIT_MODAL_NOT_OPEN");
            evaluate(web,"document.querySelector('#editDialog .suike-control-trigger').click()");
            revisionWait(web,"document.getElementById('suikePicker').open&&document.getElementById('editDialog').open","NESTED_PICKER_NOT_OPEN");
            require(Boolean.TRUE.equals(evaluate(web,"getComputedStyle(document.getElementById('suikePicker'),'::backdrop').backdropFilter==='blur(18px)'&&getComputedStyle(document.getElementById('suikePicker')).filter==='none'")),"NESTED_MODAL_BACKDROP_NOT_BLURRED");
            revisionPicture("nested-modal-blurred");
            evaluate(web,"document.querySelector('#suikePicker .picker-close').click()");
            revisionWait(web,"!document.getElementById('suikePicker').open&&document.getElementById('editDialog').open","LOWER_MODAL_DID_NOT_REMAIN_OPEN");
            revisionPicture("edit-modal-blurred");
            evaluate(web,"document.getElementById('cancelEdit').click()");
            revisionWait(web,"document.querySelectorAll('dialog[open]').length===0","MODAL_BLUR_DID_NOT_DISMISS");
            require(Boolean.TRUE.equals(evaluate(web,"SuikeAppearance.getFrost()===0&&getComputedStyle(document.getElementById('app')).filter==='none'")),"DISMISSAL_MUST_RESTORE_CLEAR_PAGE");
            revisionPicture("modal-dismissed-clear");record("custom_modal_stack_blurs_only_back_layers",new JSONObject());
            step="uniform_wallpaper_foreground";
            evaluate(web,"window.__qaOriginalImage=document.querySelector('#suikeWallpaper img').src;var c=document.createElement('canvas');c.width=8;c.height=8;var x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,8,8);document.querySelector('#suikeWallpaper img').src=c.toDataURL('image/png')");
            revisionWait(web,"document.querySelector('#suikeWallpaper img').complete","BRIGHT_IMAGE_NOT_READY");
            revisionPicture("today-white-wallpaper");
            require(Boolean.TRUE.equals(evaluate(web,"getComputedStyle(document.querySelector('.next-card')).color==='rgb(255, 255, 255)'&&getComputedStyle(document.querySelector('.next-card')).textShadow!=='none'")),"BRIGHT_WALLPAPER_CHANGED_TEXT");
            evaluate(web,"var c=document.createElement('canvas');c.width=8;c.height=8;var x=c.getContext('2d');x.fillStyle='#000';x.fillRect(0,0,8,8);document.querySelector('#suikeWallpaper img').src=c.toDataURL('image/png')");
            revisionWait(web,"document.querySelector('#suikeWallpaper img').complete","DARK_IMAGE_NOT_READY");
            revisionPicture("today-black-wallpaper");
            require(Boolean.TRUE.equals(evaluate(web,"getComputedStyle(document.querySelector('.next-card')).color==='rgb(255, 255, 255)'")),"DARK_WALLPAPER_CHANGED_TEXT");
            evaluate(web,"document.querySelector('#suikeWallpaper img').src=window.__qaOriginalImage");
            revisionWait(web,"document.querySelector('#suikeWallpaper img').complete","ORIGINAL_FIXTURE_NOT_READY");
            record("bright_and_dark_wallpapers_keep_fixed_text",new JSONObject());
            evaluate(web,"SuikeAppearance.setFrost(100,true)");
            revisionWait(web,"window.__qaAlpha(document.querySelector('.next-card'))>.85","DISPLAY_FROST_NOT_SYNCED");revisionWait(web,"getComputedStyle(document.getElementById('weekLoad')).color==='rgb(255, 255, 255)'","NESTED_PIXEL_CHART_CONTRAST");revisionPicture("today-frosted-glass");
            evaluate(web,"document.getElementById('theme').value='light';document.getElementById('theme').dispatchEvent(new Event('change',{bubbles:true}));SuikeAppearance.setEnabled(false)");
            revisionWait(web,"getComputedStyle(document.querySelector('.next-card')).backdropFilter==='none'","DISPLAY_GLASS_DID_NOT_DISABLE");
            evaluate(web,"document.getElementById('theme').value='custom';document.getElementById('theme').dispatchEvent(new Event('change',{bubbles:true}));SuikeAppearance.setFrost(0,true);document.querySelector('[data-view=settings]').click();document.getElementById('settingsDisplayDetails').open=true");
            evaluate(web,"document.getElementById('theme').value='light';document.getElementById('theme').dispatchEvent(new Event('change',{bubbles:true}));SuikeAppearance.setEnabled(true);SuikeAppearance.setFrost(0,true);document.querySelector('[data-view=today]').click();document.getElementById('toast').hidden=true;window.scrollTo(0,0)");
            revisionWait(web,"getComputedStyle(document.querySelector('.next-card')).backdropFilter==='none'&&SuikeAppearance.frostLevels().sheetBlur===10&&SuikeAppearance.frostLevels().sheetTint===.55","STANDARD_BASELINE_CHANGED");
            revisionPicture("today-standard-light");
            evaluate(web,"document.getElementById('theme').value='dark';document.getElementById('theme').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('toast').hidden=true");
            revisionPicture("today-standard-dark");
            evaluate(web,"document.getElementById('theme').value='custom';document.getElementById('theme').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-view=settings]').click()");
            record("display_cards_refraction_frost_and_switch_synchronized",new JSONObject());
            step="minute_affairs_manual";
            evaluate(web,"document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelector('[data-view=today]').click();window.__qaPeriods=JSON.stringify(SuikeFeatures.getState().periods);document.getElementById('addCourse').click();var f=document.getElementById('courseForm');f.elements.namedItem('name').value='团组织会议';document.getElementById('courseBegin').value='06:40';document.getElementById('courseFinish').value='06:50';document.getElementById('courseFinish').dispatchEvent(new Event('change',{bubbles:true}));f.querySelector('button[type=submit]').click();");
            revisionWait(web,"SuikeFeatures.getState().courses.some(c=>c.name==='团组织会议'&&c.timeMode==='clock'&&c.start===null&&c.end===null&&c.sourceTime==='06:40-06:50')","MINUTE_MANUAL_SAVE_FAILED");
            require(Boolean.TRUE.equals(evaluate(web,"JSON.stringify(SuikeFeatures.getState().periods)===window.__qaPeriods&&document.querySelector('.agenda-minute')&&document.querySelectorAll('.grid-time').length===13")),"MINUTE_AFFECTED_PERIODS");
            revisionPicture("minute-today-custom");record("minute_manual_save_without_period_mutation",new JSONObject());
            step="minute_ai_preview";
            evaluate(web,"window.__qaRealNative=window.SuikeNative;window.SuikeNative={getDeepSeekConfig:()=>JSON.stringify({ok:true,configured:true,model:'deepseek-flash'}),requestDeepSeek:(id,action,payload)=>{window.__qaAI={id:id,payload:JSON.parse(payload)};return true;},cancelDeepSeek:()=>{},clearDeepSeekAttachments:()=>{}};document.getElementById('deepSeekEntry').click();var day=new Date(Date.now()+28800000).toISOString().slice(0,10);window.__qaAIQuote=day+' 12:00-12:10 午间事务';document.getElementById('deepSeekCourseText').value=window.__qaAIQuote;document.getElementById('deepSeekParse').click();SuikeDeepSeek.receive(window.__qaAI.id,{ok:true,result:{protocol:2,status:'scope',mode:'personal',basis:'个人消息',candidates:[]}});SuikeDeepSeek.receive(window.__qaAI.id,{ok:true,result:{protocol:2,status:'ready',courses:[{name:'午间事务',room:'',teacher:'',audience:{kind:'personal',classIds:[],groupIds:[],evidence:window.__qaAIQuote},schedule:{dates:[day],weekday:String(TimetableModel.dayOf(day)),weeks:'',periods:'',clock:'12:00-12:10'},source:{location:'老师消息',quote:window.__qaAIQuote}}]}});window.SuikeNative=window.__qaRealNative;");
            require(Boolean.TRUE.equals(evaluate(web,"!SuikeFeatures.getState().courses.some(c=>c.name==='午间事务')&&!document.getElementById('deepSeekPreview').hidden&&document.getElementById('deepSeekPreview').textContent.includes('12:00')&&!document.getElementById('deepSeekPreview').textContent.includes('null')&&window.__qaAI.payload.context.program.clockOnlyArrangements===true")),"MINUTE_AI_PREVIEW_INVALID");
            revisionPicture("minute-ai-preview");
            evaluate(web,"document.getElementById('deepSeekConfirm').click();");
            revisionWait(web,"SuikeFeatures.getState().courses.some(c=>c.name==='午间事务'&&c.sourceTime==='12:00-12:10'&&c.start===null)","MINUTE_AI_CONFIRM_FAILED");
            evaluate(web,"document.querySelector('#deepSeekDialog [aria-label=\"关闭 DeepSeek\"]').click();document.querySelector('.toast-undo').click();");
            revisionWait(web,"!SuikeFeatures.getState().courses.some(c=>c.name==='午间事务')","MINUTE_AI_UNDO_FAILED");record("minute_ai_evidence_preview_confirm_undo",new JSONObject());
            step="minute_grid_geometry";
            evaluate(web,"var s=SuikeFeatures.getState(),day=s.courses.find(c=>c.name==='团组织会议').dates[0];function e(id,a,b){return {id:id,name:id,day:TimetableModel.dayOf(day),start:null,end:null,timeMode:'clock',sourceTime:a+'-'+b,dates:[day],color:'teal',room:'',teacher:''};}s.courses.push(e('午间事务','12:00','12:10'),e('课间事务','08:45','08:55'),e('短事务','08:10','08:20'),{id:'qa-regular',name:'工程力学',day:TimetableModel.dayOf(day),start:1,end:2,dates:[day],sourceTime:'',room:'A201',teacher:'',color:'teal'});SuikeFeatures.commitState(s,'minute geometry fixture');document.querySelector('[data-view=week]').click();document.getElementById('toast').hidden=true;window.scrollTo(0,0);");
            require(Boolean.TRUE.equals(evaluate(web,"(function(){var g=document.getElementById('weekGrid'),items=Array.from(g.querySelectorAll('.minute-arrangement')),tiny=items.find(x=>x.getAttribute('aria-label').startsWith('团组织会议')),slot=g.querySelector('.grid-slot');window.__qaMinuteGeometry=items.map(x=>({label:x.getAttribute('aria-label'),height:x.getBoundingClientRect().height,top:x.getBoundingClientRect().top-g.getBoundingClientRect().top}));return items.length===5&&Math.abs(tiny.getBoundingClientRect().height-76*10/45)<1&&Math.abs(tiny.getBoundingClientRect().top-g.getBoundingClientRect().top-(48+Number(tiny.dataset.minuteTop)))<2&&slot.dataset.weekPeriod==='1'&&Math.abs(slot.getBoundingClientRect().height-76)<1&&g.scrollWidth<=g.clientWidth+1&&JSON.stringify(SuikeFeatures.getState().periods)===window.__qaPeriods;})()")),"MINUTE_PROPORTION_OR_GRID_CHANGED");
            revisionPicture("minute-week-custom");
            evaluate(web,"document.querySelector('.minute-day-list').click();");
            revisionWait(web,"document.getElementById('minuteListDialog').open&&document.getElementById('minuteListDialog').textContent.includes('06:40')","MINUTE_ACCESSIBLE_LIST_MISSING");revisionPicture("minute-day-list");
            evaluate(web,"document.querySelector('#minuteListDialog .dialog-heading button').click();document.getElementById('theme').value='light';document.getElementById('theme').dispatchEvent(new Event('change',{bubbles:true}));");
            revisionPicture("minute-week-light");
            evaluate(web,"document.querySelector('[data-view=today]').click();document.getElementById('toast').hidden=true;window.scrollTo(0,0);");
            revisionPicture("minute-today-light");
            require(Boolean.TRUE.equals(evaluate(web,"(function(){var s=SuikeFeatures.getState(),c=s.courses.find(c=>c.name==='团组织会议'),d=c.dates[0],p=SuikeProductCore.nativePayload(s,Date.parse(d+'T00:00:00+08:00'),TimetableModel),o=p.occurrences.find(c=>c.name==='团组织会议');return o&&o.endMillis-o.startMillis===600000;})()")),"MINUTE_NATIVE_PROJECTION_FAILED");record("minute_proportional_grid_collisions_and_native_projection",new JSONObject());
            evaluate(web,"document.getElementById('theme').value='custom';document.getElementById('theme').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-view=settings]').click();");
            step="local_video_wallpaper";
            evaluate(web,"(function(){window.__qaVideoError='';try{var c=document.createElement('canvas');c.width=128;c.height=128;var x=c.getContext('2d'),stream=c.captureStream(5),rec=new MediaRecorder(stream,{mimeType:'video/webm'}),chunks=[],tick=0;var timer=setInterval(function(){x.fillStyle=tick++%2?'#78909c':'#b0bec5';x.fillRect(0,0,128,128);},100);rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};rec.onstop=function(){clearInterval(timer);stream.getTracks().forEach(t=>t.stop());var d=new DataTransfer();d.items.add(new File(chunks,'runtime-wallpaper.webm',{type:'video/webm'}));var input=document.getElementById('wallpaperVideo');input.files=d.files;input.dispatchEvent(new Event('change',{bubbles:true}));};rec.start();setTimeout(()=>rec.stop(),1100);}catch(e){window.__qaVideoError=e.name;}})()");
            revisionWait(web,"document.getElementById('wallpaperStatus').textContent.startsWith('视频')&&document.querySelector('#suikeWallpaper video')&&document.querySelector('#suikeWallpaper video').readyState>=2","VIDEO_WALLPAPER_NOT_SAVED");
            require(Boolean.TRUE.equals(evaluate(web,"document.querySelector('#suikeWallpaper video').muted&&document.querySelector('#suikeWallpaper video').loop")),"VIDEO_NOT_MUTED_OR_LOOPING");revisionWait(web,"document.querySelector('#suikeWallpaper video').currentTime>0&&!document.querySelector('#suikeWallpaper video').paused","VIDEO_NOT_PLAYING");record("local_video_decodes_and_loops_muted",new JSONObject());
            step="wallpaper_restart";finishBridgeActivity();web=launchNormalAndAwaitReady(2,"beta18-video");
            revisionWait(web,"document.querySelector('#suikeWallpaper video')&&document.querySelector('#suikeWallpaper video').readyState>=2","VIDEO_DID_NOT_RESTORE");
            require(Boolean.TRUE.equals(evaluate(web,"SuikeFeatures.getState().periods.length===13&&SuikeFeatures.getState().courses[0].timeMode==='clock'&&SuikeFeatures.getState().courses.some(c=>c.name==='团组织会议'&&c.start===null&&c.sourceTime==='06:40-06:50')")),"COURSE_OR_PERIODS_LOST");record("wallpaper_and_course_state_survive_activity_restart",new JSONObject());
            evaluate(web,"document.querySelector('[data-view=week]').click()");revisionPicture("week-wallpaper");
            evaluate(web,"document.querySelector('[data-view=today]').click()");revisionPicture("today-wallpaper");
            step="fixed_foreground_scroll";
            evaluate(web,"window.__qaFixedFont=getComputedStyle(document.querySelector('.next-card')).fontFamily;window.__qaFixedSize=getComputedStyle(document.querySelector('.next-card')).fontSize;window.scrollTo(0,document.body.scrollHeight)");
            SystemClock.sleep(600);
            require(Boolean.TRUE.equals(evaluate(web,"getComputedStyle(document.querySelector('.next-card')).color==='rgb(255, 255, 255)'&&getComputedStyle(document.querySelector('.next-card')).fontFamily===window.__qaFixedFont&&getComputedStyle(document.querySelector('.next-card')).fontSize===window.__qaFixedSize&&!document.querySelector('[data-glass-ink]')")),"SCROLL_OR_VIDEO_CHANGED_FOREGROUND");
            evaluate(web,"window.scrollTo(0,0)");record("scroll_and_video_keep_text_color_and_typography",new JSONObject());
            step="stable_custom_material";
            require(Boolean.TRUE.equals(evaluate(web,"(function(){var wrap=document.createElement('div');wrap.innerHTML='<button class=week-course>Course</button><button class=\"picker-day is-selected\">1</button>';document.body.appendChild(wrap);var course=wrap.children[0],pick=wrap.children[1];course.style.transition='none';pick.style.transition='none';function read(ink){wrap.dataset.glassInk=ink;var c=getComputedStyle(course),p=getComputedStyle(pick);return {fill:c.backgroundColor,edge:c.borderLeftColor,selected:p.backgroundColor,text:c.color};}var light=read('light'),dark=read('dark');window.__qaMaterialDiagnostic=JSON.stringify({light:light,dark:dark});wrap.remove();return light.fill===dark.fill&&light.edge===dark.edge&&light.selected===dark.selected&&light.text===dark.text&&light.text==='rgb(255, 255, 255)';})()")),"FOREGROUND_OR_MATERIAL_CHANGED_WITH_LEGACY_TONE");
            record("fixed_text_and_material_ignore_legacy_tone",new JSONObject());
            passed=true;
        } catch(Throwable failure){put(report,"failureStep",step);put(report,"failureType",failure.getClass().getSimpleName());put(report,"failureCode",failure.getMessage());if(web!=null){try{put(report,"mediaDiagnostic",evaluate(web,"JSON.stringify({status:document.getElementById('wallpaperStatus').textContent,wallpaper:document.documentElement.dataset.wallpaper,imageError:window.__qaImageError||'',videoError:window.__qaVideoError||'',material:window.__qaMaterialDiagnostic||'',layer:document.getElementById('suikeWallpaper').children.length})"));revisionPicture("failure");}catch(Throwable ignored){}}}
        finally {
            if(web!=null){try{evaluate(web,"if(window.__qaRealNative)window.SuikeNative=window.__qaRealNative");}catch(Throwable ignored){}}
            if(web!=null&&savedAppearance&&mediaOwned){try{
                evaluate(web,"document.getElementById('removeWallpaper').click()");revisionWait(web,"document.documentElement.dataset.wallpaper==='off'","MEDIA_REMOVE_FAILED");
                if(appearance==null)evaluate(web,"SuikeAppearance.setEnabled(false);localStorage.removeItem('suike.appearance.v1')");
                else evaluate(web,"localStorage.setItem('suike.appearance.v1',"+JSONObject.quote(appearance)+")");
                if(wallpaperMode==null)evaluate(web,"localStorage.removeItem('suike.wallpaper.mode.v1')");else evaluate(web,"localStorage.setItem('suike.wallpaper.mode.v1',"+JSONObject.quote(wallpaperMode)+")");
            }catch(Throwable failure){passed=false;put(report,"mediaCleanupFailed",true);}}
            if(captured){try{restore();restored=true;}catch(Throwable failure){passed=false;put(report,"restoreFailed",true);}}
            put(report,"passed",passed);put(report,"originalCheckpointRestored",restored);put(report,"checks",checks);put(report,"paidApiCalled",false);put(report,"syntheticMedia",true);put(report,"physicalDevice",false);put(report,"screenshotScope","app-window-pixelcopy");
            Bundle bundle=new Bundle();bundle.putString("revisionReport",report.toString());finish(passed?Activity.RESULT_OK:Activity.RESULT_CANCELED,bundle);
        }
    }

    private void record(String name, JSONObject details) throws Exception {
        checks.put(new JSONObject().put("name",name).put("passed",true).put("details",details));
        android.util.Log.i("SuikeRevision",step+" passed: "+name);
        if(target!=null){File root=target.getExternalFilesDir(null);if(root!=null){try(FileOutputStream out=new FileOutputStream(new File(root,"revision-progress.json"))){out.write(new JSONObject().put("step",step).put("lastPassed",name).put("checks",checks.length()).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));}}}
    }
    private static void require(boolean okay, String code) { if (!okay) throw new AssertionError(code); }
    private static void put(JSONObject json, String key, Object value) { try { json.put(key, value); } catch (Exception ignored) {} }
}
