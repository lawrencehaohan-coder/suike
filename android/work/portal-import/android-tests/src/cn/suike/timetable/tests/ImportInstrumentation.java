package cn.suike.timetable.tests;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Internal same-signature test APK. Refuses real devices and never reads school login data. */
public final class ImportInstrumentation extends Instrumentation {
    private static final String TARGET = "cn.suike.timetable";
    private static final String STORAGE = "suike.timetable.v1";
    private final JSONArray checks = new JSONArray();
    private Activity activity;
    private Activity portal;
    private String driver;
    private String fixture;
    private String step = "emulator_guard";
    private String mode = "full";
    private static final String SCHOOL_TIMES="[{\"period\":1,\"start\":\"08:15\",\"end\":\"09:00\"},{\"period\":2,\"start\":\"09:10\",\"end\":\"09:55\"},{\"period\":3,\"start\":\"10:15\",\"end\":\"11:00\"},{\"period\":4,\"start\":\"11:10\",\"end\":\"11:55\"},{\"period\":5,\"start\":\"14:15\",\"end\":\"15:00\"},{\"period\":6,\"start\":\"15:10\",\"end\":\"15:55\"},{\"period\":7,\"start\":\"16:15\",\"end\":\"17:00\"},{\"period\":8,\"start\":\"17:10\",\"end\":\"17:55\"},{\"period\":9,\"start\":\"19:15\",\"end\":\"20:00\"},{\"period\":10,\"start\":\"20:10\",\"end\":\"20:55\"}]";

    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); if(arguments!=null&&arguments.getString("mode")!=null)mode=arguments.getString("mode"); start(); }
    @Override public void onStart() {
        JSONObject report = new JSONObject(); boolean passed = false, cleaned = false;
        try {
            require(Build.VERSION.SDK_INT == 36 && "ranchu".equals(Build.HARDWARE), "EMULATOR_ONLY");
            require(TARGET.equals(getTargetContext().getPackageName()), "TARGET_MISMATCH");
            driver = asset("test-driver.js"); fixture = new JSONObject(asset("teaching-fixture.json")).toString();
            if("numerals".equals(mode)){runNumericSuite();runPickerSuite();runWidgetSuite();}else if("scopewidget".equals(mode)){runAiScopeSuite();runWidgetSuite();}else if("pickers".equals(mode)){runPickerSuite();runSchoolSuite();}else if("enhancements".equals(mode)){runEnhancementsSuite();runSchoolSuite();}else if("promoted".equals(mode)){runPromotionSuite();runSchoolSuite();}else if("schools".equals(mode))runSchoolSuite();else if("reduced".equals(mode))runReducedSuite();else if("responsive".equals(mode))runResponsiveSuite();else runSuite(); passed = true;
        } catch (Throwable failure) {
            while(failure instanceof java.lang.reflect.InvocationTargetException&&failure.getCause()!=null)failure=failure.getCause();
            put(report, "failureStep", step);
            put(report, "failureType", failure.getClass().getSimpleName());
            if (failure.getMessage() != null && failure.getMessage().matches("[A-Z_]{3,64}")) put(report, "failureCode", failure.getMessage());
            // Deliberately omit messages, stack traces, backups, page contents and credentials.
        } finally {
            try {
                if (portal != null) { runOnMainSync(() -> portal.finish()); portal = null; waitForIdleSync(); }
                if (activity != null && !activity.isDestroyed()) {
                    eval(web(activity), "(function(){window.__suikeQA.fixtureStorage('" + STORAGE + "',null);return true;})()");
                    restart();
                    JSONObject fresh = object("window.__suikeQA.summary()");
                    cleaned = fresh.getInt("meetings") == 181 && fresh.getInt("ledgerEntries") == 0;
                    runOnMainSync(() -> activity.finish()); waitForIdleSync();
                }
            } catch (Throwable ignored) { cleaned = false; }
            put(report, "passed", passed); put(report, "cleanInitialStateRestored", cleaned);
            put(report, "api", Build.VERSION.SDK_INT); put(report, "hardware", Build.HARDWARE);
            put(report, "checks", checks);
            Bundle result = new Bundle(); result.putString("qa_report", report.toString());
            finish(passed && cleaned ? Activity.RESULT_OK : Activity.RESULT_CANCELED, result);
        }
    }

    private void runNumericSuite() throws Exception {
        step="numeric_font_startup";launch();
        eval(web(activity),"window.__qaFontsReady=false;Promise.all([400,500,600,700].map(function(w){return document.fonts.load(w+' 16px \"Suike Numbers\"','0123456789:./-%');})).then(function(){window.__qaFontsReady=true;});true");
        waitForJs(web(activity),"window.__qaFontsReady===true",10000);
        JSONObject info=object("(function(){var e=document.querySelector('.inst-clock'),s=getComputedStyle(e),c=document.createElement('canvas').getContext('2d');c.font='40px \"Suike Numbers\"';return {font:s.fontFamily,loaded:document.fonts.check('400 16px \"Suike Numbers\"','0123456789:'),one:c.measureText('1111').width,eight:c.measureText('8888').width,styleCount:document.querySelectorAll('#suikeNumeralStyles').length};})()");
        require(info.getBoolean("loaded")&&info.getString("font").startsWith("\"Suike Numbers\"")&&info.getInt("styleCount")==1,"NUMERIC_FONT_NOT_LOADED");
        require(Math.abs(info.getDouble("one")-info.getDouble("eight"))<.05,"NUMERIC_WIDTH_UNSTABLE");
        record("offline_numeric_face_loaded_and_equal_width",info);
        eval(web(activity),"document.querySelector('[data-view=today]').click();document.documentElement.setAttribute('data-theme','light');window.scrollTo(0,0);true");screenshot("numerals-today-light.png");
        eval(web(activity),"document.documentElement.setAttribute('data-theme','dark');true");screenshot("numerals-today-dark.png");
        eval(web(activity),"document.documentElement.setAttribute('data-theme','light');document.querySelector('[data-view=week]').click();window.scrollTo(0,0);true");screenshot("numerals-week.png");
        require(Boolean.TRUE.equals(eval(web(activity),"Array.from(document.querySelectorAll('.period-number,.period-time,.week-range')).every(function(e){return getComputedStyle(e).fontFamily.indexOf('Suike Numbers')===0||getComputedStyle(e).fontFamily.indexOf('\"Suike Numbers\"')===0;})")),"NUMERIC_WEEK_FONT_MISSING");
        require(Boolean.TRUE.equals(eval(web(activity),"innerWidth<360||(document.querySelector('.week-range').getBoundingClientRect().top<document.querySelector('.week-title-row').getBoundingClientRect().bottom-1)")),"NUMERIC_DATE_HEADER_WRAPPED");
        record("numeric_today_week_light_and_dark",new JSONObject().put("passed",true));
        eval(web(activity),"document.querySelector('[data-view=today]').click();true");
        WebView target=web(activity);final int originalWidth=target.getLayoutParams().width;
        try {
            runOnMainSync(()->{android.view.ViewGroup.LayoutParams lp=target.getLayoutParams();lp.width=Math.round(320*target.getResources().getDisplayMetrics().density);target.setLayoutParams(lp);});
            waitForJs(target,"Math.abs(innerWidth-320)<2",5000);
            require(Boolean.TRUE.equals(eval(target,"(function(){var e=document.querySelector('.inst-clock');return e.scrollWidth<=Math.ceil(e.parentElement.clientWidth)+1&&document.documentElement.scrollWidth<=innerWidth+1;})()")),"NUMERIC_CLOCK_NARROW_OVERFLOW");
            screenshot("numerals-today-320.png");record("numeric_clock_fits_320px",new JSONObject().put("passed",true));
        } finally {runOnMainSync(()->{android.view.ViewGroup.LayoutParams lp=target.getLayoutParams();lp.width=originalWidth;target.setLayoutParams(lp);});}
    }

    private void runSuite() throws Exception {
        step = "startup"; launch();
        eval(web(activity), "['suike.history.v1','suike.semesters.v1','suike.workspace.transaction.v1'].forEach(function(k){window.__suikeQA.fixtureStorage(k,null);});true");
        eval(web(activity), "(function(){window.__suikeQA.fixtureStorage('" + STORAGE + "',null);return true;})()"); restart();
        JSONObject initial = object("window.__suikeQA.summary()");
        eval(web(activity),"SuikeAppearance.setEnabled(true);true");
        require(initial.getInt("meetings") == 181 && initial.getInt("labMeetings") == 13 && initial.getInt("ledgerEntries") == 0, "INITIAL_COUNTS");
        record("startup_ready_default181_labs13", initial);
        runLayoutSuite();
        runLiquidSuite();
        runRequestedUiSuite();
        runPeriodTimesSuite();

        step = "first_upgrade_deleted_night";
        eval(web(activity), "(function(){var s=JSON.parse(JSON.stringify(window.TIMETABLE_SEED));s.courses=s.courses.filter(function(c){return c.id!=='imported-016';});window.__suikeQA.fixtureStorage('" + STORAGE + "',JSON.stringify(s));return true;})()");
        restart(); JSONObject deletedNightPreview = preview();
        require(deletedNightPreview.getInt("additions") == 0 && deletedNightPreview.getInt("deletedRows") == 4, "DELETED_NIGHT_REVIVED");
        JSONObject deletedNight = object("window.__suikeQA.confirm()");
        require(deletedNight.getInt("meetings") == 177 && deletedNight.getInt("labMeetings") == 13 && deletedNight.getInt("tombstones") == 4, "DELETED_NIGHT_COMMIT");
        record("first_upgrade_deleted_night_stays_deleted", deletedNight);
        eval(web(activity), "(function(){window.__suikeQA.fixtureStorage('" + STORAGE + "',null);return true;})()"); restart();

        step = "preview_cancel";
        String storedBefore = stored(); JSONObject preview = preview();
        require(preview.getInt("read") == 168 && preview.getInt("additions") == 0, "PREVIEW_COUNTS");
        require(Boolean.TRUE.equals(eval(web(activity), "window.__suikeQA.cancel()")), "CANCEL_FAILED");
        require(storedBefore.equals(stored()), "CANCEL_WROTE_DATA"); record("preview168_no_additions_cancel_unchanged", preview);

        step = "confirm_ledger"; preview();
        require(Boolean.TRUE.equals(eval(web(activity), "window.__suikeQA.acceptOneSourceUpdate()")), "SOURCE_CHECKBOX_FAILED");
        JSONObject committed = object("window.__suikeQA.confirm()");
        require(committed.getInt("meetings") == 181 && committed.getInt("labMeetings") == 13 && committed.getInt("ledgerEntries") == 168 && committed.getInt("acceptedSourceMeetings") == 1, "LEDGER_COUNTS");
        record("confirm_keeps181_and_records168", committed);

        step = "backup_restart";
        Object backupValue = eval(web(activity), "window.__suikeQA.exportBackup()");
        require(backupValue instanceof String, "BACKUP_CAPTURE_FAILED"); String backup = (String) backupValue;
        JSONObject backupObject = new JSONObject(backup);
        require(backupObject.getJSONObject("importLedger").getJSONArray("entries").length() == 168, "BACKUP_LEDGER_MISSING");
        Method validate = activity.getClass().getDeclaredMethod("validateBackup", byte[].class); validate.setAccessible(true);
        validate.invoke(null, (Object) backup.getBytes(StandardCharsets.UTF_8));
        // Round-trip through the same local serialized format, without printing any content.
        eval(web(activity), "(function(){var s=window.TimetableModel.validateState(JSON.parse(" + JSONObject.quote(backup) + "));window.__suikeQA.fixtureStorage('" + STORAGE + "',JSON.stringify(s));return true;})()");
        restart(); JSONObject restarted = object("window.__suikeQA.summary()");
        require(restarted.getInt("ledgerEntries") == 168 && restarted.getInt("meetings") == 181, "RESTART_LOST_LEDGER");
        JSONObject repeat = preview(); require(repeat.getInt("additions") == 0, "REPEAT_DUPLICATED");
        eval(web(activity), "window.__suikeQA.cancel()"); record("actual_export_payload_roundtrip_restart_idempotent", restarted);

        step = "manual_edits";
        JSONObject edits = object("window.__suikeQA.prepareEdits()");
        object("window.__suikeQA.editCourse(" + JSONObject.quote(edits.getString("renamedId")) + ",{name:'测试_保留改名'})");
        waitForJs(web(activity), "!document.querySelector('dialog[open]')", 5000);
        object("window.__suikeQA.editCourse(" + JSONObject.quote(edits.getString("movedId")) + ",{start:7,end:8})");
        waitForJs(web(activity), "!document.querySelector('dialog[open]')", 5000);
        object("window.__suikeQA.deleteCourse(" + JSONObject.quote(edits.getString("deletedId")) + ")");
        waitForJs(web(activity), "!document.querySelector('dialog[open]')", 5000);
        JSONObject changed = object("window.__suikeQA.summary()");
        int deletedCount = edits.getInt("deletedCount"), protectedCount = edits.getInt("protectedCount");
        require(changed.getInt("meetings") == 181 - deletedCount, "DELETE_COUNT");
        restart(); JSONObject afterRestart = object("window.__suikeQA.verifyEdits(" + edits.toString() + ")");
        JSONObject editedPreview = preview();
        require(editedPreview.getInt("additions") == 0 && editedPreview.getInt("protectedRows") >= protectedCount && editedPreview.getInt("deletedRows") >= deletedCount, "EDIT_PROTECTION_PREVIEW");
        JSONObject protectedState = object("window.__suikeQA.confirm()");
        object("window.__suikeQA.verifyEdits(" + edits.toString() + ")");
        require(protectedState.getInt("meetings") == 181 - deletedCount && protectedState.getInt("labMeetings") == 13 && protectedState.getInt("tombstones") >= deletedCount, "EDIT_OR_LABS_LOST");
        record("rename_reschedule_delete_survive_reimport_labs13", protectedState);

        step = "external_portal_launch";
        ActivityMonitor monitor = addMonitor(TARGET + ".PortalActivity", null, false);
        eval(web(activity), "window.__suikeQA.openPortal()"); portal = waitForMonitorWithTimeout(monitor, 15000); removeMonitor(monitor);
        require(portal != null, "PORTAL_DID_NOT_OPEN");
        step = "external_portal_webview_exists";
        Field windowsField = portal.getClass().getDeclaredField("windows"); windowsField.setAccessible(true);
        @SuppressWarnings("unchecked") List<WebView> windows = (List<WebView>) windowsField.get(portal);
        require(windows != null && !windows.isEmpty(), "PORTAL_WEBVIEW_MISSING");
        step = "external_portal_mock_ready";
        WebView external = windows.get(0);
        final String testPage = "https://client.v.just.edu.cn/http/webvpn-internal-qa/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html";
        final byte[] testHtml = fixtureHtml().getBytes(StandardCharsets.UTF_8);
        runOnMainSync(() -> {
            // Test-only request interceptor: this own fixture never reaches the school server.
            // loadUrl also exercises the same navigation path as the shipping local shell.
            external.stopLoading(); external.getSettings().setBlockNetworkLoads(true);
            external.setWebViewClient(new WebViewClient() {
                @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    byte[] body = testPage.equals(request.getUrl().toString()) ? testHtml : new byte[0];
                    return new WebResourceResponse("text/html", "UTF-8", new ByteArrayInputStream(body));
                }
            });
            external.loadUrl(testPage);
        });
        waitForJs(external, "document.getElementById('kbgrid_table_0')!==null", 15000);
        step = "external_portal_bridge_absent";
        require(Boolean.TRUE.equals(eval(external, "typeof window.SuikeNative==='undefined' && typeof window.SuikeImport==='undefined'")), "EXTERNAL_NATIVE_BRIDGE_PRESENT");
        step = "external_portal_settings";
        AtomicReference<Boolean> portalSafe = new AtomicReference<>(false);
        runOnMainSync(() -> { WebSettings s = external.getSettings(); portalSafe.set(!s.getAllowFileAccess() && !s.getAllowContentAccess() && s.getMixedContentMode() == WebSettings.MIXED_CONTENT_NEVER_ALLOW); });
        require(Boolean.TRUE.equals(portalSafe.get()), "PORTAL_SETTINGS_UNSAFE");
        record("school_button_opens_bridge_free_external_webview", new JSONObject().put("bridgeAbsent", true).put("fileContentAccessDenied", true));

        step = "native_capture_result_preview";
        Field read = portal.getClass().getDeclaredField("readButton"); read.setAccessible(true);
        android.widget.Button readButton = (android.widget.Button) read.get(portal);
        String beforeNativeRead = stored();
        runOnMainSync(readButton::performClick);
        waitForJs(web(activity), "!!document.querySelector('.teaching-preview')&&!document.querySelector('.teaching-preview').hidden", 15000);
        JSONObject nativePreview = object("window.__suikeQA.inspectPreview()");
        require(nativePreview.getInt("read") == 168 && nativePreview.getInt("additions") == 0, "NATIVE_READ_COUNTS");
        require(beforeNativeRead.equals(stored()), "NATIVE_READ_WROTE_BEFORE_CONFIRM");
        require(Boolean.TRUE.equals(eval(web(activity),"!!document.getElementById('teachingImportTimes')&&document.getElementById('teachingImportTimes').checked&&document.getElementById('teachingPeriodPreview').textContent.indexOf('08:15')>=0")),"NATIVE_PERIOD_CLOCKS_MISSING");
        record("native_collector_clock_headers_pass_strict_contract_and_reach_preview",new JSONObject().put("explicitSlots",10).put("uncommitted",true));
        record("native_button_collector_internal_result_generates_preview_only", nativePreview);
        eval(web(activity), "window.__suikeQA.cancel()"); portal = null; waitForIdleSync();

        step = "offline_boundary";
        AtomicReference<Boolean> localSafe = new AtomicReference<>(false);
        runOnMainSync(() -> { WebSettings s = webUnchecked(activity).getSettings(); localSafe.set(s.getBlockNetworkLoads() && s.getBlockNetworkImage() && !s.getAllowFileAccess() && !s.getAllowUniversalAccessFromFileURLs()); });
        require(Boolean.TRUE.equals(localSafe.get()), "LOCAL_NETWORK_BOUNDARY_CHANGED");
        require(Boolean.TRUE.equals(eval(web(activity), "(function(){var m=document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]'),c=m?m.content:'';return location.origin==='https://suike.local'&&c.indexOf(\"default-src 'none'\")>=0&&c.indexOf(\"connect-src 'none'\")>=0&&c.indexOf(\"form-action 'none'\")>=0;})()")), "CSP_CHANGED");
        record("offline_main_network_block_and_csp_intact", new JSONObject().put("networkBlocked", true).put("cspStrict", true));
        runClearSuite();
        runProductSuite();
    }
    private void runPeriodTimesSuite() throws Exception {
        String before=stored();
        step="period_editor_validation";
        eval(web(activity),"document.querySelector('[data-view=settings]').click();document.getElementById('settingsPeriodsDetails').open=true;document.querySelector('[data-period=\"1\"]').click();true");
        waitForJs(web(activity),"document.getElementById('productDialog').open&&!!document.getElementById('periodStart')",5000);
        eval(web(activity),"document.getElementById('periodEnd').value='09:00';document.getElementById('productConfirm').click();true");
        require(before.equals(stored())&&Boolean.TRUE.equals(eval(web(activity),"!document.getElementById('productError').hidden&&document.getElementById('productError').textContent.indexOf('重叠')>=0")),"INVALID_PERIOD_EDIT_WROTE");
        eval(web(activity),"document.querySelector('#productDialog .pd-foot .button-outline').click();true");
        waitForJs(web(activity),"!document.getElementById('productDialog').open",5000);
        require(before.equals(stored()),"PERIOD_CANCEL_WROTE");
        record("period_click_editor_rejects_overlap_and_cancel_preserves_data",new JSONObject().put("cancelNoWrite",true).put("overlapRejected",true));

        step="period_editor_save_restart";
        eval(web(activity),"document.querySelector('[data-period=\"1\"]').click();document.getElementById('periodStart').value='08:05';document.getElementById('periodEnd').value='08:50';true");screenshot("period-editor.png");
        eval(web(activity),"document.getElementById('productConfirm').click();true");
        waitForJs(web(activity),"!document.getElementById('productDialog').open",5000);
        require(Boolean.TRUE.equals(eval(web(activity),"(function(){var s=window.__suikeQA.state(),c=s.courses.find(function(c){return c.start===1;}),p=SuikeProductCore.nativePayload(s,Date.parse('2026-08-01T00:00:00+08:00'),TimetableModel),o=p.occurrences.find(function(o){return o.courseId===SuikeProductCore.nativeId(c.id);});return s.periods[0].start==='08:05'&&TimetableModel.timeRange(c,s.periods).start==='08:05'&&!!o&&o.startMillis===Date.parse(o.date+'T08:05:00+08:00');})()")),"PERIOD_SAVE_PROJECTION_NOT_UPDATED");
        String backup=String.valueOf(eval(web(activity),"window.__suikeQA.exportBackup()"));
        require("08:05".equals(new JSONObject(backup).getJSONArray("periods").getJSONObject(0).getString("start")),"PERIOD_BACKUP_MISSING");
        restart();require(Boolean.TRUE.equals(eval(web(activity),"window.__suikeQA.state().periods[0].start==='08:05'")),"PERIOD_EDIT_LOST_ON_RESTART");
        eval(web(activity),"document.querySelector('[data-view=settings]').click();document.getElementById('settingsPeriodsDetails').open=true;document.querySelector('.period-list').scrollIntoView({block:'center'});true");screenshot("period-settings.png");
        record("manual_period_time_updates_course_clock_projection_backup_and_restart",new JSONObject().put("start","08:05").put("nativeProjectionUpdated",true).put("backupAndRestart",true));

        JSONObject timed=new JSONObject(fixture);timed.put("periods",new JSONArray(SCHOOL_TIMES));String capture=timed.toString();
        step="period_import_choice";
        String custom=stored();
        eval(web(activity),"window.__suikeQA.preview("+capture+");true");
        require(custom.equals(stored())&&Boolean.TRUE.equals(eval(web(activity),"document.getElementById('teachingImportTimes').checked")),"TIMES_PREVIEW_WRITES");
        screenshot("period-import-preview.png");
        eval(web(activity),"document.getElementById('teachingImportTimes').click();window.__suikeQA.confirm();true");
        require(Boolean.TRUE.equals(eval(web(activity),"window.__suikeQA.state().periods[0].start==='08:05'")),"TIMES_OPT_OUT_OVERWRITTEN");
        record("import_clock_preview_is_readonly_and_optout_keeps_custom_times",new JSONObject().put("previewNoWrite",true).put("optOutPreserved",true));

        step="period_import_confirm";
        eval(web(activity),"window.__suikeQA.preview("+capture+");window.__suikeQA.confirm();true");
        JSONObject counts=object("window.__suikeQA.summary()");
        require(counts.getInt("meetings")==181&&counts.getInt("labMeetings")==13,"TIMES_IMPORT_CHANGED_COURSE_COUNTS");
        require(Boolean.TRUE.equals(eval(web(activity),"window.__suikeQA.state().periods[0].start==='08:15'&&window.__suikeQA.state().periods[9].end==='20:55'&&window.__suikeQA.state().courses.find(function(c){return c.name==='形势与政策2';}).sourceTime==='18:30-20:05'")),"TIMES_IMPORT_NOT_APPLIED_OR_SPECIAL_NIGHT_CHANGED");
        String imported=stored();eval(web(activity),"window.__suikeQA.preview("+capture+");window.__suikeQA.confirm();true");require(imported.equals(stored()),"REPEAT_TIME_IMPORT_NOT_IDEMPOTENT");
        record("confirmed_school_times_update_settings_idempotently_preserve_labs_special_night",counts);

        step="period_import_missing_stale";
        eval(web(activity),"window.__suikeQA.preview("+fixture+");true");
        require(Boolean.TRUE.equals(eval(web(activity),"document.getElementById('teachingPeriodPreview').textContent.indexOf('未提供明确')>=0")),"MISSING_CLOCK_EXPLANATION_MISSING");
        eval(web(activity),"document.getElementById('settingsPeriodsDetails').open=true;document.querySelector('[data-period=\"1\"]').click();document.getElementById('periodStart').value='08:20';document.getElementById('periodEnd').value='09:05';document.getElementById('productConfirm').click();true");
        waitForJs(web(activity),"!document.getElementById('productDialog').open",5000);
        String edit=stored();eval(web(activity),"document.getElementById('confirmTeachingImport').click();true");
        require(edit.equals(stored())&&Boolean.TRUE.equals(eval(web(activity),"document.querySelector('.teaching-message').textContent.indexOf('重新核对')>=0")),"STALE_TIME_PREVIEW_OVERWROTE_EDIT");
        record("missing_school_clocks_keep_local_times_and_stale_preview_cannot_overwrite_edit",new JSONObject().put("missingClockRetained",true).put("staleRejected",true));

        step="native_period_contract";
        Class<?> contract=Class.forName(TARGET+".PortalCaptureContract",true,getTargetContext().getClassLoader());
        java.lang.reflect.Method parse=contract.getMethod("parse",String.class);require(parse.invoke(null,capture)!=null,"NATIVE_TIME_CAPTURE_REJECTED");
        JSONObject invalid=new JSONObject(capture);invalid.getJSONArray("periods").getJSONObject(0).put("start","25:00");boolean rejected=false;
        try{parse.invoke(null,invalid.toString());}catch(java.lang.reflect.InvocationTargetException expected){rejected=true;}
        require(rejected,"NATIVE_INVALID_TIME_ACCEPTED");
        record("native_capture_contract_accepts_only_bounded_valid_period_times",new JSONObject().put("validAccepted",true).put("invalidRejected",true));
        eval(web(activity),"window.__suikeQA.fixtureStorage('"+STORAGE+"',"+JSONObject.quote(before)+");['suike.history.v1','suike.semesters.v1','suike.workspace.transaction.v1'].forEach(function(k){window.__suikeQA.fixtureStorage(k,null);});true");restart();
    }
    private void verifySevenDays(JSONObject layout) throws Exception {
        require(layout.getBoolean("noPan") && layout.getJSONArray("allDays").length()==7,"WEEK_HORIZONTAL_PAN");
        JSONArray days=layout.getJSONArray("allDays");
        for(int i=0;i<days.length();i++){
            JSONObject day=days.getJSONObject(i);
            require(day.getDouble("left")>=0&&day.getDouble("right")<=layout.getDouble("width")+.5,"WEEK_DAY_OFFSCREEN");
        }
        require(layout.getInt("courseCount")>0,"WEEK_COURSES_MISSING");
        require(layout.getDouble("gridWidth")>200,"WEEK_GRID_HIDDEN");
        require(!"none".equals(layout.getString("clockDisplay")),"WEEK_HEADER_COMPRESSED");
        JSONArray heights=layout.getJSONArray("rowHeights");
        for(int i=0;i<heights.length();i++)require(Math.abs(heights.getDouble(i)-76)<.1,"WEEK_ROW_HEIGHT_CHANGED");
    }
    private void runRequestedUiSuite() throws Exception {
        step="requested_glass_edge_alignment";
        String before=stored();
        eval(web(activity),"document.querySelector('[data-view=settings]').click();document.getElementById('settingsSemesterDetails').open=true;window.scrollTo(0,0);true");
        SystemClock.sleep(450);
        eval(web(activity),"(function(){var e=document.querySelector('#settingsSemesterDetails>summary'),r=e.getBoundingClientRect();e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,isPrimary:true,pointerType:'touch',clientX:r.left+20,clientY:r.top+20}));return true;})()");
        JSONObject geometry=object("window.__suikeQA.requestedLayout()");
        require("none".equals(geometry.getString("summaryTransform"))&&"none".equals(geometry.getString("summaryShadow")),"NESTED_SUMMARY_GLASS_EDGE");
        require(Math.abs(geometry.getDouble("lensTop")-geometry.getDouble("activeTop"))<.1&&Math.abs(geometry.getDouble("lensHeight")-geometry.getDouble("activeHeight"))<.1,"LENS_VERTICAL_EDGE_MISMATCH");
        require(Math.abs(geometry.getDouble("lensLeft")-geometry.getDouble("activeLeft"))<.1&&Math.abs(geometry.getDouble("lensWidth")-geometry.getDouble("activeWidth"))<.1,"LENS_FRACTIONAL_EDGE_MISMATCH");
        eval(web(activity),"window.__suikeQA.release();true");screenshot("glass-switch.png");
        record("glass_single_disclosure_outline_and_exact_lens_bounds",geometry);

        step="requested_glass_switch_classic";
        eval(web(activity),"document.getElementById('glassEnabled').click();document.documentElement.setAttribute('data-theme','dark');true");
        waitForJs(web(activity),"!SuikeAppearance.isEnabled()&&document.querySelectorAll('filter[id^=suike-clear-]').length===0",5000);
        JSONObject classic=object("window.__suikeQA.requestedLayout()");
        require("not all".equals(classic.getString("media"))&&"rgb(19, 19, 18)".equals(classic.getString("paper"))&&"10px".equals(classic.getString("cardRadius"))&&"6px".equals(classic.getString("addRadius")),"CLASSIC_BASELINE_NOT_RESTORED");
        require(classic.getString("navFilter").isEmpty()&&classic.getInt("filters")==0,"CLASSIC_OPTICS_STILL_ACTIVE");
        require(before.equals(stored()),"APPEARANCE_CHANGED_COURSES");screenshot("classic-settings-dark.png");
        eval(web(activity),"document.querySelector('[data-view=week]').click();window.scrollTo(0,0);true");
        verifySevenDays(object("window.__suikeQA.requestedLayout()"));screenshot("classic-week.png");
        restart();
        require(Boolean.TRUE.equals(eval(web(activity),"!SuikeAppearance.isEnabled()&&!document.getElementById('glassEnabled').checked&&document.getElementById('suikeLiquidStyles').media==='not all'&&document.querySelectorAll('filter[id^=suike-clear-]').length===0")),"GLASS_PREFERENCE_NOT_PERSISTED");
        record("glass_switch_restores_142_styles_persists_and_preserves_data",classic);

        step="requested_glass_toggle_race";
        eval(web(activity),"SuikeAppearance.setEnabled(true);document.getElementById('addCourseWeek').click();SuikeAppearance.setEnabled(false);SuikeAppearance.setEnabled(true);SuikeAppearance.setEnabled(false);document.getElementById('cancelEdit').click();true");
        SystemClock.sleep(900);
        require(Boolean.TRUE.equals(eval(web(activity),"document.querySelectorAll('filter[id^=suike-clear-]').length===0&&document.querySelectorAll('.lg-optical-sheen').length===0&&document.querySelectorAll('.lg-pressed,.lg-hovered,.lg-folding,.lg-glass-motion').length===0")),"GLASS_ASYNC_REATTACHED_WHILE_OFF");
        eval(web(activity),"SuikeAppearance.setEnabled(true);true");
        waitForJs(web(activity),"SuikeLiquidUI.optics.surfaces>0",5000);
        require(Boolean.TRUE.equals(eval(web(activity),"document.querySelectorAll('.lg-nav-lens').length===1&&document.querySelectorAll('#glassEnabled').length===1")),"GLASS_TOGGLE_DUPLICATED_UI");
        require(before.equals(stored()),"GLASS_TOGGLE_CHANGED_DATA");
        record("glass_rapid_toggle_does_not_reinstall_stale_maps_or_duplicate_ui",new JSONObject().put("courseDataUnchanged",true));

        step="requested_week_conflict_selection";
        eval(web(activity),"(function(){var s=window.__suikeQA.state(),c=JSON.parse(JSON.stringify(s.courses.find(function(c){return c.start===1&&c.end===2;})));window.__qaOverlapDate=c.dates[0];c.id='qa-overlap';c.name='测试冲突课程';s.courses.push(c);window.__suikeQA.fixtureStorage('"+STORAGE+"',JSON.stringify(s));return true;})()");
        restart();
        eval(web(activity),"document.querySelector('[data-view=week]').click();(function(){var c=window.__suikeQA.state().courses.find(function(c){return c.id==='qa-overlap';}),s=document.getElementById('weekSelect');s.value=TimetableModel.mondayOf(c.dates[0]);s.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.week-conflict-group').click();return true;})()");
        waitForJs(web(activity),"document.getElementById('weekConflictDialog').open",5000);
        require(Boolean.TRUE.equals(eval(web(activity),"Array.from(document.querySelectorAll('.week-conflict-list>button')).some(function(b){return b.textContent.indexOf('测试冲突课程')>=0;})")),"CONFLICT_COURSE_INACCESSIBLE");screenshot("week-conflicts.png");
        eval(web(activity),"Array.from(document.querySelectorAll('.week-conflict-list>button')).find(function(b){return b.textContent.indexOf('测试冲突课程')>=0;}).click();true");
        waitForJs(web(activity),"document.getElementById('courseDialog').open&&document.getElementById('courseDetail').textContent.indexOf('测试冲突课程')>=0",5000);
        record("seven_day_conflict_group_opens_each_original_course_detail",new JSONObject().put("conflictingCourseSelectable",true));
        eval(web(activity),"window.__suikeQA.fixtureStorage('"+STORAGE+"',"+JSONObject.quote(before)+");true");restart();
    }
    private void runResponsiveSuite() throws Exception {
        step="responsive_week";launch();
        for(boolean glass:new boolean[]{true,false}){
            eval(web(activity),"SuikeAppearance.setEnabled("+glass+");document.querySelector('[data-view=week]').click();(function(){var c=window.__suikeQA.state().courses.find(function(c){return c.end>8&&!c.pendingTime;});if(c){var s=document.getElementById('weekSelect');s.value=TimetableModel.mondayOf(c.dates[0]);s.dispatchEvent(new Event('change',{bubbles:true}));}window.scrollTo(0,0);return true;})()");
            SystemClock.sleep(450);JSONObject layout=object("window.__suikeQA.requestedLayout()");verifySevenDays(layout);
            record("seven_columns_with_vertical_space_"+layout.getInt("width")+"px_"+(glass?"glass":"classic"),layout);
            screenshot("week-"+layout.getInt("width")+"-"+(glass?"glass":"classic")+".png");
            eval(web(activity),"window.scrollTo(0,document.documentElement.scrollHeight);true");
            SystemClock.sleep(350);
            JSONObject bottom=object("window.__suikeQA.requestedLayout()");
            require(bottom.getDouble("gridBottom")<=bottom.getDouble("navTop"),"WEEK_LAST_ROW_UNREACHABLE");
            screenshot("week-"+layout.getInt("width")+"-"+(glass?"glass":"classic")+"-bottom.png");
            eval(web(activity),"(function(){var b=document.querySelector('.week-course');window.__qaCourseLabel=b.getAttribute('aria-label');b.click();return true;})()");
            waitForJs(web(activity),"document.getElementById('courseDialog').open||document.getElementById('weekConflictDialog').open",5000);
            eval(web(activity),"document.querySelectorAll('dialog[open]').forEach(function(d){d.close();});true");
        }
        eval(web(activity),"SuikeAppearance.setEnabled(true);true");
    }
    private void runLiquidSuite() throws Exception {
        step="liquid_material_and_upstream";
        waitForJs(web(activity),"window.SuikeLiquidUI&&SuikeLiquidUI.optics&&SuikeLiquidUI.optics.surfaces>0",5000);
        JSONObject ui=object("window.__suikeQA.liquid()");
        require(ui.getBoolean("ready") && ui.getInt("displacementChannels")>=1 && ui.getBoolean("offlineMap"),"LIQUID_FILTER_MISSING");
        require(ui.getString("commit").equals("b857e5cd1ce3daf5599fc9a838364e591aa0c0e5") && ui.getString("filter").contains("suike-clear-") && ui.getString("backdrop").contains("blur")&&ui.getJSONObject("optics").getInt("passes")==1,"UPSTREAM_FILTER_NOT_ACTIVE");
        String before=stored();
        record("shape_matched_single_pass_filter_on_real_backdrop",ui);
        runClearMaterialProbe();

        step="liquid_navigation";
        eval(web(activity),"document.documentElement.setAttribute('data-theme','light');window.__suikeQA.sampleFrames();document.querySelector('[data-view=week]').click();window.__qaHadViewMotion=document.getElementById('weekView').getAnimations().length>0;window.scrollTo(0,0);true");
        require(Boolean.TRUE.equals(eval(web(activity),"window.__qaHadViewMotion")),"VIEW_TRANSITION_MISSING");
        waitForJs(web(activity),"window.__qaFrameSample.done",5000);
        ui=object("window.__suikeQA.liquid()");
        require(Math.abs(ui.getDouble("lensLeft")-ui.getDouble("activeLeft"))<.5 && Math.abs(ui.getDouble("lensWidth")-ui.getDouble("activeWidth"))<.5,"NAV_LENS_NOT_ALIGNED");
        for(int i=0;i<ui.getJSONArray("touchHeights").length();i++)require(ui.getJSONArray("touchHeights").getDouble(i)>=44,"NAV_TOUCH_TOO_SMALL");
        JSONObject frames=object("(function(){var a=window.__qaFrameSample.intervals;return {frames:a.length,averageMs:a.reduce(function(x,y){return x+y;},0)/a.length,maxMs:Math.max.apply(Math,a)};})()");
        require(frames.getInt("frames")>=6,"ANIMATION_FRAMES_MISSING");
        ui.put("frameSample",frames);screenshot("liquid-week.png");
        eval(web(activity),"['settings','today','week','settings'].forEach(function(v){document.querySelector('[data-view='+v+']').click();});true");
        SystemClock.sleep(400);ui=object("window.__suikeQA.liquid()");
        require(ui.getInt("visibleViews")==1 && "settings".equals(ui.getString("view")) && Math.abs(ui.getDouble("lensLeft")-ui.getDouble("activeLeft"))<.5,"RAPID_NAV_STATE_WRONG");
        record("liquid_navigation_lens_interruptible_and_touch_targets",ui.put("frameSample",frames));

        step="liquid_press_feedback";
        eval(web(activity),"document.querySelector('[data-view=week]').click();document.getElementById('clearTimetable').scrollIntoView({block:'center'});true");
        waitForJs(web(activity),"document.getAnimations().length===0",5000);
        require(Boolean.TRUE.equals(eval(web(activity),"window.__suikeQA.press('clearTimetable')")),"PRESS_FEEDBACK_MISSING");
        SystemClock.sleep(120);
        String transform=(String)eval(web(activity),"getComputedStyle(document.getElementById('clearTimetable')).transform");
        require(transform!=null&&!"none".equals(transform)&&!"matrix(1, 0, 0, 1, 0, 0)".equals(transform),"PRESS_DEFORMATION_MISSING");
        screenshot("liquid-pressed.png");eval(web(activity),"window.__suikeQA.release()");
        SystemClock.sleep(360);
        require(Boolean.TRUE.equals(eval(web(activity),"!document.querySelector('.lg-pressed')&&!document.getElementById('clearTimetableDialog').open")),"PRESS_NOT_RELEASED");
        record("liquid_touch_press_deforms_without_triggering_action",new JSONObject().put("transform",transform).put("released",true));

        step="liquid_disclosure";
        eval(web(activity),"document.querySelector('[data-view=settings]').click();window.scrollTo(0,0);document.querySelector('#settingsSemesterDetails>summary').click();var fold=document.getElementById('settingsSemesterDetails');window.__qaFoldAnimation=fold.getAnimations()[0];window.__qaFoldAnimation.pause();window.__qaFoldAnimation.currentTime=80;window.__qaFoldMid=fold.getBoundingClientRect().height;true");
        require(Boolean.TRUE.equals(eval(web(activity),"document.getElementById('settingsSemesterDetails').open&&document.getElementById('settingsSemesterDetails').classList.contains('lg-folding')")),"DISCLOSURE_ANIMATION_MISSING");
        double mid=((Number)eval(web(activity),"window.__qaFoldMid")).doubleValue();
        eval(web(activity),"window.__qaFoldAnimation.play();true");
        waitForJs(web(activity),"!document.getElementById('settingsSemesterDetails').classList.contains('lg-folding')",5000);
        double expanded=((Number)eval(web(activity),"document.getElementById('settingsSemesterDetails').getBoundingClientRect().height")).doubleValue();
        require(mid<expanded&&mid>20,"DISCLOSURE_NOT_INTERPOLATED");
        eval(web(activity),"document.querySelector('#settingsSemesterDetails>summary').click();document.querySelector('#settingsSemesterDetails>summary').click();true");
        waitForJs(web(activity),"!document.getElementById('settingsSemesterDetails').classList.contains('lg-folding')",5000);
        require(Boolean.TRUE.equals(eval(web(activity),"document.getElementById('settingsSemesterDetails').open")),"DISCLOSURE_INTERRUPT_WRONG");
        eval(web(activity),"document.querySelector('#settingsSemesterDetails>summary').click();true");
        waitForJs(web(activity),"!document.getElementById('settingsSemesterDetails').open",5000);
        for(String theme:new String[]{"light","dark"}){
            eval(web(activity),"document.documentElement.setAttribute('data-theme','"+theme+"');true");screenshot("liquid-settings-"+theme+".png");
            eval(web(activity),"document.querySelector('[data-view=today]').click();document.documentElement.setAttribute('data-theme','"+theme+"');window.scrollTo(0,0);true");screenshot("liquid-today-"+theme+".png");
            eval(web(activity),"document.querySelector('[data-view=settings]').click();window.scrollTo(0,0);true");
        }
        record("liquid_disclosures_interpolate_and_reverse_without_losing_controls",new JSONObject().put("midHeight",mid).put("expandedHeight",expanded));

        step="liquid_dialog_interrupt";
        eval(web(activity),"document.documentElement.setAttribute('data-theme','light');document.querySelector('[data-view=week]').click();window.__suikeQA.sampleFrames(280);document.getElementById('addCourseWeek').click();true");
        require(Boolean.TRUE.equals(eval(web(activity),"document.getElementById('timeNoteField').getBoundingClientRect().height===0&&document.getElementById('confirmedStartField').getBoundingClientRect().height>0")),"CONDITIONAL_FIELDS_WRONGLY_VISIBLE");
        screenshot("liquid-dialog.png");
        waitForJs(web(activity),"window.__qaFrameSample.done&&getComputedStyle(document.getElementById('editDialog')).backdropFilter.indexOf('suike-clear-')>=0",5000);
        JSONObject dialogFrames=object("(function(){var a=window.__qaFrameSample.intervals.slice().sort(function(x,y){return x-y;});return {frames:a.length,averageMs:a.reduce(function(x,y){return x+y;},0)/a.length,p95Ms:a[Math.floor(a.length*.95)],maxMs:Math.max.apply(Math,a)};})()");
        JSONObject mapWork=object("JSON.parse(JSON.stringify(SuikeLiquidUI.optics))");
        eval(web(activity),"document.getElementById('cancelEdit').click();document.getElementById('addCourseWeek').click();true");
        SystemClock.sleep(350);
        require(Boolean.TRUE.equals(eval(web(activity),"document.getElementById('editDialog').open&&!document.getElementById('editDialog').classList.contains('closing')")),"REOPENED_DIALOG_CLOSED");
        eval(web(activity),"document.getElementById('cancelEdit').click();true");
        waitForJs(web(activity),"!document.getElementById('editDialog').open",5000);
        require(before.equals(stored()),"UI_MOTION_CHANGED_COURSES");
        record("liquid_dialog_can_reopen_during_close_and_preserves_data",new JSONObject().put("reopened",true).put("courseDataUnchanged",true).put("frameSample",dialogFrames).put("mapWork",mapWork));
        step="workflow_step_motion";
        eval(web(activity),"SuikeFeatures.openNoticeImport();document.getElementById('noticeCourseName').value='工程力学实验';document.getElementById('noticeText').value='第9、10、12周，周六下午第5-6节，地点：船海楼118。';true");
        SystemClock.sleep(350);
        eval(web(activity),"document.getElementById('productConfirm').click();true");
        require(Boolean.TRUE.equals(eval(web(activity),"document.querySelector('#productDialog .pd-body').getAnimations().length===1")),"WORKFLOW_TRANSITION_MISSING");
        require(before.equals(stored()),"WORKFLOW_PREVIEW_WROTE_DATA");
        eval(web(activity),"document.querySelector('#productDialog .pd-foot .button-outline').click();true");
        waitForJs(web(activity),"!document.getElementById('productDialog').open",5000);
        record("workflow_preview_step_animates_without_writing_data",new JSONObject().put("animated",true).put("courseDataUnchanged",true));

    }
    private void runClearMaterialProbe() throws Exception {
        step="pure_monochrome_material";
        JSONObject colors=new JSONObject();
        for(String theme:new String[]{"light","dark"}){
            eval(web(activity),"document.documentElement.setAttribute('data-theme','"+theme+"');true");
            JSONObject color=object("(function(){var s=getComputedStyle(document.body),n=getComputedStyle(document.querySelector('.bottom-nav'));return {background:s.backgroundColor,image:s.backgroundImage,nav:n.backgroundColor};})()");
            require(("light".equals(theme)?"rgb(255, 255, 255)":"rgb(0, 0, 0)").equals(color.getString("background"))&&"none".equals(color.getString("image")),"PURE_BLACK_WHITE_LOST");
            colors.put(theme,color);
        }
        eval(web(activity),"document.documentElement.setAttribute('data-theme','light');true");
        step="pixel_refraction_probe";
        JSONObject geometry=object("window.__suikeQA.opticalProbe()");
        Bitmap plain=null,bent=null;
        try{
            plain=captureBitmap();eval(web(activity),"window.__suikeQA.enableProbeRefraction()");bent=captureBitmap();
            final int[] location=new int[2];final WebView targetWeb=web(activity);runOnMainSync(()->targetWeb.getLocationOnScreen(location));
            double scale=((double)plain.getWidth())/geometry.getDouble("viewportWidth");
            int left=location[0]+(int)Math.round(geometry.getDouble("left")*scale),top=location[1]+(int)Math.round(geometry.getDouble("top")*scale);
            int width=(int)Math.round(geometry.getDouble("width")*scale),height=(int)Math.round(geometry.getDouble("height")*scale);
            double center=0,edge=0;int centers=0,edges=0,grayDelta=0;
            for(int y=(int)(height*.48);y<(int)(height*.52);y++)for(int x=0;x<width;x++){
                int a=plain.getPixel(left+x,top+y),b=bent.getPixel(left+x,top+y);
                int ar=(a>>16)&255,br=(b>>16)&255,bg=(b>>8)&255,bb=b&255;
                grayDelta=Math.max(grayDelta,Math.max(Math.abs(br-bg),Math.abs(bg-bb)));
                double diff=Math.abs(ar-br);
                if(x>width*.3&&x<width*.7){center+=diff;centers++;}
                if((x>scale*2&&x<scale*10)||(x>width-scale*10&&x<width-scale*2)){edge+=diff;edges++;}
            }
            center/=centers;edge/=edges;
            require(edge>8&&edge>center+3&&center<12&&grayDelta<=1,"BACKGROUND_REFRACTION_NOT_VISIBLE");
            colors.put("pixelProbe",new JSONObject().put("edgeMeanDifference",edge).put("centerMeanDifference",center).put("maximumChannelDifference",grayDelta));
        }finally{
            if(plain!=null)plain.recycle();if(bent!=null)bent.recycle();eval(web(activity),"window.__suikeQA.closeOpticalProbe()");
        }
        record("pure_black_white_clear_glass_bends_background_edges_keeps_center_clear",colors);
    }
    private Bitmap captureBitmap() throws Exception {
        eval(web(activity),"window.__qaPaintReady=false;requestAnimationFrame(function(){requestAnimationFrame(function(){window.__qaPaintReady=true;});});true");
        waitForJs(web(activity),"window.__qaPaintReady===true",5000);SystemClock.sleep(350);waitForIdleSync();
        Bitmap shot=getUiAutomation().takeScreenshot();require(shot!=null,"SCREENSHOT_FAILED");return shot;
    }
    private void runReducedSuite() throws Exception {
            step="liquid_reduced_motion";launch();
            waitForJs(web(activity),"window.SuikeLiquidUI.motionReduced()",5000);
            eval(web(activity),"document.querySelector('[data-view=settings]').click();document.querySelector('#settingsSemesterDetails>summary').click();true");
            require(Boolean.TRUE.equals(eval(web(activity),"document.getElementById('settingsSemesterDetails').open&&!document.querySelector('.lg-folding')&&document.getAnimations().length===0&&getComputedStyle(document.querySelector('.lg-nav-lens')).transitionDuration==='0s'")),"REDUCED_MOTION_NOT_RESPECTED");
            eval(web(activity),"document.getElementById('addCourseWeek').click();true");
            require(Boolean.TRUE.equals(eval(web(activity),"getComputedStyle(document.getElementById('editDialog')).animationName==='none'")),"REDUCED_DIALOG_ANIMATED");
            eval(web(activity),"document.getElementById('cancelEdit').click();true");
            require(Boolean.TRUE.equals(eval(web(activity),"!document.getElementById('editDialog').open")),"REDUCED_CLOSE_DELAYED");
            record("system_reduce_motion_disables_motion_but_keeps_controls",new JSONObject().put("systemAnimatorScale",0).put("mediaQueryReduced",true));
    }
    private void runLayoutSuite() throws Exception {
        step = "ui_equal_week_buttons";
        eval(web(activity), "document.querySelector('[data-view=week]').click();document.getElementById('addCourseWeek').scrollIntoView({block:'center'});true");
        JSONObject layout = object("window.__suikeQA.layout()"), add = layout.getJSONObject("add"), clear = layout.getJSONObject("clear");
        require(Math.abs(add.getDouble("width")-clear.getDouble("width"))<0.5 && Math.abs(add.getDouble("height")-clear.getDouble("height"))<0.5, "BUTTON_SIZES_DIFFER");
        require(add.getDouble("height")>=44 && "12px".equals(add.getString("radius")) && add.getString("radius").equals(clear.getString("radius")), "BUTTON_STYLE_MISMATCH");
        require(add.getString("background").equals(clear.getString("background")) && add.getString("border").equals(clear.getString("border")) && !layout.getBoolean("horizontalOverflow"), "BUTTON_VISUAL_MISMATCH");
        screenshot("week-buttons.png"); record("week_buttons_same_size_radius_and_palette", layout);
        step = "ui_compact_settings";
        eval(web(activity), "document.querySelector('[data-view=settings]').click();window.scrollTo(0,0);true");
        layout = object("window.__suikeQA.layout()");
        require(layout.getJSONArray("folds").length()==4 && layout.getInt("settingsHeight")<1300 && !layout.getBoolean("horizontalOverflow"), "SETTINGS_NOT_COMPACT");
        for(int i=0;i<4;i++) require(!layout.getJSONArray("folds").getJSONObject(i).getBoolean("open"), "SETTINGS_FOLD_OPEN");
        eval(web(activity), "document.querySelector('#settingsSemesterDetails>summary').click();true");
        require(Boolean.TRUE.equals(eval(web(activity), "document.getElementById('theme').getBoundingClientRect().height>0")), "SETTINGS_CONTROLS_HIDDEN");
        eval(web(activity), "document.querySelector('#settingsSemesterDetails>summary').click();document.querySelector('#settingsPeriodsDetails>summary').click();true");
        require(Boolean.TRUE.equals(eval(web(activity), "document.querySelector('.period-list').getBoundingClientRect().height>0&&document.querySelectorAll('.period-list>div').length>=8")), "PERIODS_UNAVAILABLE");
        eval(web(activity), "document.querySelector('#settingsPeriodsDetails>summary').click();window.scrollTo(0,0);true");
        waitForJs(web(activity),"document.querySelectorAll('details.lg-folding').length===0",5000);
        for(String theme:new String[]{"light","dark","auto"}) {
            eval(web(activity), "document.documentElement.setAttribute('data-theme','"+theme+"');true"); screenshot("settings-compact-"+theme+".png");
        }
        record("settings_long_sections_fold_without_losing_controls", layout);
        step = "ui_large_import"; clearTimetable();
        String before = stored(); JSONObject preview = object("window.__suikeQA.preview(window.__suikeQA.largeCapture())");
        require(preview.getInt("read")==300 && preview.getInt("additions")==300, "LARGE_PREVIEW_COUNT");
        step = "ui_large_import_geometry";
        eval(web(activity), "document.getElementById('toast').hidden=true;document.querySelector('.teaching-message').scrollIntoView({block:'start'});true");
        waitForJs(web(activity),"document.getAnimations().length===0",5000);
        JSONObject view = object("window.__suikeQA.importLayout()");
        require(view.getInt("rows")==300 && view.getDouble("listHeight")<=322 && view.getInt("scrollHeight")>10000 && view.getBoolean("beforeList"), "IMPORT_LIST_NOT_BOUNDED");
        require(view.getDouble("confirmTop")>=0 && view.getDouble("confirmBottom")<view.getDouble("navTop") && !view.getBoolean("horizontalOverflow"), "IMPORT_CONFIRM_NOT_VISIBLE");
        require(Boolean.TRUE.equals(eval(web(activity), "(function(){var b=document.getElementById('confirmTeachingImport'),r=b.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2).closest('button')===b;})()")), "IMPORT_CONFIRM_OBSCURED");
        for(String theme:new String[]{"light","dark","auto"}) {
            eval(web(activity), "document.documentElement.setAttribute('data-theme','"+theme+"');true"); screenshot("import-compact-"+theme+".png");
        }
        eval(web(activity), "document.getElementById('teachingImportList').scrollTop=999999;true");
        JSONObject scrolled = object("window.__suikeQA.importLayout()");
        require(scrolled.getDouble("scrollTop")>0 && Math.abs(scrolled.getDouble("confirmTop")-view.getDouble("confirmTop"))<0.5, "IMPORT_ACTIONS_MOVED");
        require(before.equals(stored()), "LARGE_PREVIEW_WROTE_DATA");
        eval(web(activity), "var choices=document.querySelectorAll('#teachingImportList input[type=checkbox]');choices[choices.length-1].click();true");
        JSONObject imported = object("window.__suikeQA.confirm()");
        require(imported.getInt("meetings")==299 && imported.getInt("labMeetings")==0, "LARGE_SELECTION_NOT_RESPECTED");
        record("preview300_bounded_actions_visible_selection_imports299", view);
        eval(web(activity), "['suike.timetable.v1','suike.history.v1','suike.semesters.v1','suike.workspace.transaction.v1'].forEach(function(k){window.__suikeQA.fixtureStorage(k,null);});true"); restart();
        require(object("window.__suikeQA.summary()").getInt("meetings")==181, "UI_FIXTURE_NOT_RESET");
    }
    private void runProductSuite() throws Exception {
        step = "product_tools";
        require(Boolean.TRUE.equals(eval(web(activity), "typeof SuikeFeatures==='object'&&!!document.getElementById('productFeatures')")), "PRODUCT_MISSING");
        eval(web(activity), "document.querySelector('[data-view=settings]').click();document.getElementById('productFeatures').scrollIntoView({block:'start'});true");
        screenshot("product-tools.png");
        step = "product_notice_preview";
        String beforeNotice = stored();
        eval(web(activity), "SuikeFeatures.openNoticeImport();document.getElementById('noticeCourseName').value='工程力学实验';document.getElementById('noticeText').value='第9、10、12周，周六下午第5-6节，地点：船海楼118。';document.getElementById('productConfirm').click();true");
        require(Boolean.TRUE.equals(eval(web(activity), "document.getElementById('productError').hidden&&!!document.getElementById('noticeConfirm2')")), "NOTICE_PREVIEW_FAILED");
        require(beforeNotice.equals(stored()), "NOTICE_PREVIEW_WROTE_DATA");
        screenshot("product-notice-preview.png");
        eval(web(activity), "[0,1,2].forEach(function(i){document.getElementById('noticeConfirm'+i).click();});document.getElementById('productConfirm').click();true");
        waitForJs(web(activity), "!document.getElementById('productDialog').open", 5000);
        require(object("window.__suikeQA.summary()").getInt("meetings") == 171, "NOTICE_COMMIT_COUNT");
        record("notice_preview_manual_confirm_adds_three", new JSONObject().put("previewDidNotWrite", true).put("added", 3));
        step = "product_notice_duplicate";
        eval(web(activity), "SuikeFeatures.openNoticeImport();document.getElementById('noticeCourseName').value='工程力学实验';document.getElementById('noticeText').value='第9、10、12周，周六下午第5-6节，地点：船海楼118。';document.getElementById('productConfirm').click();[0,1,2].forEach(function(i){document.getElementById('noticeConfirm'+i).click();});document.getElementById('productConfirm').click();true");
        waitForJs(web(activity), "!document.getElementById('productDialog').open", 5000);
        require(object("window.__suikeQA.summary()").getInt("meetings") == 171, "NOTICE_DUPLICATED");
        record("repeat_notice_idempotent", new JSONObject().put("meetings",171));
        step = "product_snapshot_restore";
        final String preEdit=stored();
        eval(web(activity), "(function(){var s=SuikeFeatures.getState();s.courses[0].name='测试_历史快照';return SuikeFeatures.commitState(s,'历史恢复测试');})()");
        require(Boolean.TRUE.equals(eval(web(activity), "SuikeFeatures.listHistory().length>0")), "HISTORY_MISSING");
        eval(web(activity), "SuikeFeatures.restoreHistory(SuikeFeatures.listHistory()[0].id);true");
        require(preEdit.equals(stored()), "HISTORY_NOT_RESTORED"); restart();
        require(preEdit.equals(stored()), "HISTORY_RESTART_LOST");
        record("snapshot_restore_survives_restart", new JSONObject().put("historyCount",object("({count:SuikeFeatures.listHistory().length})").getInt("count")));
        step = "product_scoped_edit";
        eval(web(activity), "(function(){var c=SuikeFeatures.getState().courses.find(function(c){return c.dates.length>3;});window.__scopeId=c.id;window.__scopeCount=c.dates.length;SuikeFeatures.openOccurrenceEdit(c.id,c.dates[0]);document.getElementById('occurrenceRoom').value='测试_单次教室';document.getElementById('occurrenceRoom').dispatchEvent(new Event('input'));document.getElementById('productConfirm').click();return true;})()");
        require(Boolean.TRUE.equals(eval(web(activity), "document.getElementById('productError').hidden&&document.getElementById('productConfirm').textContent==='确认保存'")), "SCOPE_PREVIEW_FAILED");
        screenshot("product-occurrence.png");
        eval(web(activity), "document.getElementById('productConfirm').click();true");
        waitForJs(web(activity), "!document.getElementById('productDialog').open", 5000);
        require(Boolean.TRUE.equals(eval(web(activity), "(function(){var s=SuikeFeatures.getState(),c=s.courses.find(function(c){return c.id===window.__scopeId;}),m=s.courses.filter(function(c){return c.room==='测试_单次教室';});return c.dates.length===window.__scopeCount-1&&m.length===1&&m[0].dates.length===1;})()")), "SCOPE_NOT_SINGLE");
        JSONObject protectedPreview=preview();require(protectedPreview.getInt("additions")==0&&protectedPreview.getInt("protectedRows")>=1,"SCOPED_IMPORT_PROTECTION");
        eval(web(activity), "window.__suikeQA.cancel()");
        record("single_occurrence_split_and_reimport_protected",new JSONObject().put("changedMeetings",1).put("additions",0));
        step = "product_semesters";
        String originalTerm=stored();
        eval(web(activity), "SuikeFeatures.createSemester({startMonday:'2027-03-01',termLabel:'测试新学期',totalWeeks:20});true");
        require(object("window.__suikeQA.summary()").getInt("meetings")==0,"NEW_TERM_NOT_EMPTY");
        require(Boolean.TRUE.equals(eval(web(activity), "SuikeFeatures.listSemesters().length===2")),"TERMS_NOT_SAVED");
        eval(web(activity), "SuikeFeatures.switchSemester(SuikeFeatures.listSemesters().find(function(t){return !t.active;}).id);true");
        require(originalTerm.equals(stored()),"TERM_SWITCH_LOST_DATA");restart();require(originalTerm.equals(stored()),"TERM_RESTART_LOST_DATA");
        record("semester_archive_switch_restart_preserves_state",new JSONObject().put("terms",2).put("meetings",171));
        step = "product_preferences_backup";
        eval(web(activity), "(function(){var s=SuikeFeatures.getState();s.productSettings=SuikeProductCore.defaults();s.productSettings.profile.major='机器人工程';s.productSettings.profile.classNumber=1;s.productSettings.profile.batchNumber=1;return SuikeFeatures.commitState(s,'班级档案测试');})()");
        String backup=(String)eval(web(activity),"window.__suikeQA.exportBackup()");
        JSONObject prefs=new JSONObject(backup).getJSONObject("productSettings");
        require("机器人工程".equals(prefs.getJSONObject("profile").getString("major"))&&!prefs.getJSONObject("reminders").getBoolean("enabled"),"PRODUCT_PREFS_INVALID");
        Method validate=activity.getClass().getDeclaredMethod("validateBackup",byte[].class);validate.setAccessible(true);validate.invoke(null,(Object)backup.getBytes(StandardCharsets.UTF_8));
        record("profile_and_opt_in_preferences_in_backup",new JSONObject().put("profileKept",true).put("remindersDefaultOff",true));
        step="product_native_bridge_sync";
        require(Boolean.TRUE.equals(eval(web(activity),"SuikeFeatures.syncNative()")),"NATIVE_SYNC_NOT_ACCEPTED");
        waitForJs(web(activity),"(function(){var s=JSON.parse(SuikeNative.featuresStatus());return s.ok&&s.occurrenceCount>0&&s.enabled===false;})()",5000);
        record("production_local_bridge_syncs_current_projection",new JSONObject().put("accepted",true).put("currentProjectionPresent",true));
    }
    private void runClearSuite() throws Exception {
        step = "clear_cancel";
        final String beforeClear = stored();
        final JSONObject beforeState = new JSONObject(beforeClear);
        preview(); // A whole clear must invalidate any pending school preview.
        eval(web(activity), "document.querySelector('[data-view=week]').click();document.getElementById('toast').hidden=true;document.getElementById('clearTimetable').scrollIntoView({block:'start'});true");
        screenshot("clear-week.png");
        eval(web(activity), "document.getElementById('clearTimetable').click();true");
        waitForJs(web(activity), "document.getElementById('clearTimetableDialog').open", 5000);
        require(Boolean.TRUE.equals(eval(web(activity), "document.getElementById('clearTimetableScope').textContent.indexOf('所有周次')>=0&&document.getElementById('clearTimetableScope').textContent.indexOf('实验')>=0")), "CLEAR_SCOPE_MISSING");
        screenshot("clear-confirm.png");
        eval(web(activity), "document.getElementById('cancelClearTimetable').click();true");
        waitForJs(web(activity), "!document.getElementById('clearTimetableDialog').open", 5000);
        require(beforeClear.equals(stored()), "CLEAR_CANCEL_CHANGED_STORAGE");
        record("whole_clear_scope_all_weeks_cancel_unchanged", new JSONObject().put("allWeeksExplicit", true).put("manualLabsExplicit", true));

        step = "clear_undo"; clearTimetable();
        JSONObject blank = object("window.__suikeQA.summary()");
        require(blank.getInt("meetings") == 0 && blank.getInt("labMeetings") == 0 && blank.getInt("ledgerEntries") == 0, "CLEAR_NOT_EMPTY");
        require(Boolean.TRUE.equals(eval(web(activity), "document.querySelector('.teaching-preview').hidden&&!document.getElementById('clearTimetableEmpty').hidden")), "CLEAR_PREVIEW_OR_EMPTY_UI");
        eval(web(activity), "document.querySelector('#toast button').click();true");
        require(beforeClear.equals(stored()), "CLEAR_UNDO_DID_NOT_RESTORE_EXACT_STATE");
        record("whole_clear_removes_labs_and_undo_restores_full_state", object("window.__suikeQA.summary()"));

        step = "clear_backup_restart"; clearTimetable();
        Object exported = eval(web(activity), "window.__suikeQA.exportBackup()");
        require(exported instanceof String, "BLANK_EXPORT_MISSING");
        JSONObject backup = new JSONObject((String) exported);
        require(backup.getJSONArray("courses").length() == 0 && backup.isNull("importLedger") && backup.getBoolean("skipLegacyImportBaseline"), "BLANK_BACKUP_INVALID");
        require(beforeState.getJSONObject("settings").toString().equals(backup.getJSONObject("settings").toString()) && beforeState.getJSONArray("periods").toString().equals(backup.getJSONArray("periods").toString()), "CLEAR_SETTINGS_CHANGED");
        Method validate = activity.getClass().getDeclaredMethod("validateBackup", byte[].class); validate.setAccessible(true);
        validate.invoke(null, (Object) ((String) exported).getBytes(StandardCharsets.UTF_8));
        restart(); JSONObject restarted = object("window.__suikeQA.summary()");
        require(restarted.getInt("meetings") == 0 && restarted.getInt("labMeetings") == 0, "CLEARED_SEED_RESURRECTED");
        eval(web(activity), "document.querySelector('[data-view=week]').click();document.getElementById('clearTimetableEmpty').scrollIntoView({block:'center'});true"); screenshot("clear-empty.png");
        eval(web(activity), "document.getElementById('importAfterClear').click();true");
        require(Boolean.TRUE.equals(eval(web(activity), "!document.getElementById('settingsView').hidden")), "EMPTY_IMPORT_SHORTCUT_FAILED");
        record("blank_backup_keeps_settings_restart_stays_empty", restarted);

        step = "clear_reimport"; JSONObject freshPreview = preview();
        require(freshPreview.getInt("additions") == 168 && freshPreview.getInt("deletedRows") == 0, "CLEAR_OLD_DELETION_PROTECTION_REMAINED");
        JSONObject imported = object("window.__suikeQA.confirm()");
        require(imported.getInt("meetings") == 168 && imported.getInt("labMeetings") == 0 && imported.getInt("ledgerEntries") == 168 && imported.getInt("tombstones") == 0, "FRESH_IMPORT_COUNTS");
        restart(); JSONObject repeated = preview();
        require(repeated.getInt("additions") == 0 && repeated.getInt("existing") == 168, "FRESH_REPEAT_DUPLICATED");
        eval(web(activity), "window.__suikeQA.cancel()");
        record("whole_clear_allows_fresh168_then_repeat_idempotent", imported);
    }
    private void clearTimetable() throws Exception {
        eval(web(activity), "document.querySelector('[data-view=week]').click();document.getElementById('clearTimetable').click();true");
        waitForJs(web(activity), "document.getElementById('clearTimetableDialog').open", 5000);
        eval(web(activity), "document.getElementById('confirmClearTimetable').click();true");
        waitForJs(web(activity), "!document.getElementById('clearTimetableDialog').open", 5000);
    }
    private void screenshot(String name) throws Exception {
        if (portal == null) {
            eval(web(activity), "window.__qaPaintReady=false;requestAnimationFrame(function(){requestAnimationFrame(function(){window.__qaPaintReady=true;});});true");
            waitForJs(web(activity), "window.__qaPaintReady===true", 5000);
        }
        // WebView's renderer and Android's compositor finish asynchronously;
        // a DOM assertion alone can capture the preceding screen.
        SystemClock.sleep(400); waitForIdleSync();
        Bitmap shot = getUiAutomation().takeScreenshot(); require(shot != null, "SCREENSHOT_FAILED");
        File folder = getTargetContext().getExternalFilesDir(null); require(folder != null, "SCREENSHOT_FOLDER_MISSING");
        try (FileOutputStream out = new FileOutputStream(new File(folder, name))) { require(shot.compress(Bitmap.CompressFormat.PNG, 100, out), "SCREENSHOT_ENCODE_FAILED"); }
        finally { shot.recycle(); }
    }
    private void tapSelector(String selector)throws Exception{
        eval(web(activity),"document.querySelector("+JSONObject.quote(selector)+").scrollIntoView({block:'center'});true");
        SystemClock.sleep(140);
        JSONObject point=object("(function(){var r=document.querySelector("+JSONObject.quote(selector)+").getBoundingClientRect();return {width:innerWidth,x:r.left+r.width/2,y:r.top+r.height/2};})()");
        require(point.getDouble("x")>0&&point.getDouble("y")>0,"PICKER_TRIGGER_NOT_VISIBLE");
        long down=SystemClock.uptimeMillis();touch(point,"x","y",android.view.MotionEvent.ACTION_DOWN,down);touch(point,"x","y",android.view.MotionEvent.ACTION_UP,down);
    }
    private void pickerClosed()throws Exception{waitForJs(web(activity),"!document.getElementById('suikePicker').open",5000);SystemClock.sleep(60);}
    private void runAiScopeSuite()throws Exception{
        step="ai_scope_startup";launch();
        eval(web(activity),"__suikeQA.fixtureStorage('"+STORAGE+"',JSON.stringify(TIMETABLE_SEED));true");restart();String original=stored();
        try{
            step="ai_scope_choices";
            eval(web(activity),"(function(){SuikeNative.saveDeepSeekConfig('sk-suike-fixture-not-real-123456','deepseek-flash');window.__scopeNative=SuikeNative;var fake=Object.create(SuikeNative);fake.getDeepSeekConfig=function(){return __scopeNative.getDeepSeekConfig();};fake.requestDeepSeek=function(id,action,raw){window.__scopeRequest={id:id,payload:JSON.parse(raw)};return true;};window.SuikeNative=fake;document.querySelector('[data-view=settings]').click();document.getElementById('deepSeekEntry').click();document.getElementById('deepSeekCourseText').value='范围测试实验 机械2401 第7-9周 周三 第3-4节 实验楼203';document.getElementById('deepSeekParse').click();window.__scopeFixture={protocol:2,status:'scope',mode:'classes',basis:'文件列出两个专业及两个班级',candidates:[{id:'c1',label:'机械2401 · 机械工程',className:'机械2401',major:'机械工程',groups:[{id:'g1',label:'第1批'},{id:'g2',label:'第2批'}]},{id:'c2',label:'电气2401 · 电气工程',className:'电气2401',major:'电气工程',groups:[]}]};SuikeDeepSeek.receive(__scopeRequest.id,{ok:true,result:__scopeFixture});return true;})()");
            require(original.equals(stored())&&Boolean.TRUE.equals(eval(web(activity),"__scopeRequest.payload.stage==='inspect'&&!document.getElementById('deepSeekQuestions').hidden&&document.getElementById('deepSeekPreview').hidden")),"SCOPE_SELECTION_MUTATED_TIMETABLE");
            tapSelector("[data-picker-for=deepSeekClassSelect]");waitForJs(web(activity),"document.getElementById('suikePicker').open",5000);tapSelector("#suikePicker [data-picker-value=c1]");pickerClosed();
            tapSelector("[data-picker-for=deepSeekGroupSelect]");waitForJs(web(activity),"document.getElementById('suikePicker').open",5000);tapSelector("#suikePicker [data-picker-value=g1]");pickerClosed();
            eval(web(activity),"document.getElementById('deepSeekQuestions').scrollIntoView({block:'center'});true");screenshot("deepseek-scope.png");tapSelector("#deepSeekAnswer");
            require(original.equals(stored())&&Boolean.TRUE.equals(eval(web(activity),"__scopeRequest.payload.stage==='extract'&&__scopeRequest.payload.target.classId==='c1'&&__scopeRequest.payload.target.groupId==='g1'")),"TARGET_NOT_SENT_TO_EXTRACTION");
            record("native_class_and_batch_choices_precede_extraction_without_writes",new JSONObject().put("passed",true));
            step="ai_scope_filter_calendar";
            eval(web(activity),"(function(){var mine={name:'范围测试实验',room:'实验楼203',teacher:'',audience:{kind:'listed',classIds:['c1'],groupIds:['g1'],evidence:'机械2401 第1批'},schedule:{weeks:'第7-9周',weekday:'周三',periods:'第3-4节',dates:[],clock:''},source:{location:'文字消息',quote:'范围测试实验 机械2401 第7-9周 周三 第3-4节 实验楼203'}};var other=JSON.parse(JSON.stringify(mine));other.audience.classIds=['c2'];other.audience.groupIds=[];other.schedule=null;var batch=JSON.parse(JSON.stringify(mine));batch.audience.groupIds=['g2'];batch.schedule=null;window.__scopeReady={protocol:2,status:'ready',courses:[mine,other,batch]};SuikeDeepSeek.receive(__scopeRequest.id,{ok:true,result:__scopeReady});return true;})()");
            require(original.equals(stored())&&Boolean.TRUE.equals(eval(web(activity),"!document.getElementById('deepSeekPreview').hidden&&document.querySelectorAll('#deepSeekPreviewList input').length===1&&document.getElementById('deepSeekPreviewList').textContent.indexOf('2026-10-14、2026-10-21、2026-10-28')>=0")),"SCOPE_FILTER_OR_WEEK_CONVERSION_FAILED");
            eval(web(activity),"document.getElementById('deepSeekPreview').scrollIntoView({block:'center'});true");screenshot("deepseek-scoped-preview.png");tapSelector("#deepSeekConfirm");
            require(Boolean.TRUE.equals(eval(web(activity),"SuikeFeatures.getState().productSettings.aiIdentity.className==='机械2401'&&SuikeFeatures.getState().courses.some(function(c){return c.name==='范围测试实验'&&c.dates.length===3&&c.start===3&&c.end===4;})")),"SCOPED_CONFIRM_FAILED");
            record("other_class_and_batch_excluded_weeks_computed_and_identity_saved",new JSONObject().put("passed",true));
            step="ai_scope_remember_undo";
            eval(web(activity),"document.getElementById('deepSeekEntry').click();document.getElementById('deepSeekCourseText').value='范围测试实验 机械2401 第7-9周 周三 第3-4节 实验楼203';document.getElementById('deepSeekParse').click();SuikeDeepSeek.receive(__scopeRequest.id,{ok:true,result:__scopeFixture});true");
            require(Boolean.TRUE.equals(eval(web(activity),"__scopeRequest.payload.stage==='extract'&&__scopeRequest.payload.target.classId==='c1'&&document.getElementById('deepSeekQuestions').hidden")),"CONFIRMED_CLASS_NOT_REUSED");
            eval(web(activity),"document.querySelector('#deepSeekDialog .ai-head .icon-button').click();document.querySelector('.toast-undo').click();true");
            require(original.equals(stored()),"SCOPED_IMPORT_UNDO_FAILED");
            record("confirmed_identity_reused_and_import_with_identity_undoes_atomically",new JSONObject().put("passed",true));
        }finally{
            eval(web(activity),"(function(){if(window.__scopeNative)window.SuikeNative=__scopeNative;SuikeNative.clearDeepSeekConfig();return true;})()");
        }
    }
    private void runWidgetSuite()throws Exception{
        step="widget_platform_host";
        JSONArray result=WidgetChecks.run(this,activity,this::screenshot,command->eval(web(activity),command));
        for(int i=0;i<result.length();i++)checks.put(result.getJSONObject(i));
        require(Boolean.TRUE.equals(eval(web(activity),"typeof SuikeNative.requestPinWidget==='function'")),"WIDGET_PIN_BRIDGE_MISSING");
        eval(web(activity),"SuikeFeatures.openReminders();true");
        require(Boolean.TRUE.equals(eval(web(activity),"!!document.getElementById('pinWidgetWide')&&!!document.getElementById('pinWidgetCompact')")),"WIDGET_SETTINGS_ENTRY_MISSING");
        eval(web(activity),"document.getElementById('widgetAppearanceSettings').click();true");
        require(Boolean.TRUE.equals(eval(web(activity),"!document.getElementById('productDialog').open&&document.getElementById('settingsSemesterDetails').open&&document.querySelectorAll('#glassEnabled').length===1")),"WIDGET_CONTROLS_DUPLICATED_OR_NOT_IN_APP");
        record("widget_entry_uses_existing_reminder_settings",new JSONObject().put("passed",true));
    }
    private void runPickerSuite()throws Exception{
        step="picker_startup";launch();eval(web(activity),"__suikeQA.fixtureStorage('"+STORAGE+"',JSON.stringify(TIMETABLE_SEED));true");restart();String original=stored();
        require(Boolean.TRUE.equals(eval(web(activity),"!!window.SuikePickers&&!document.querySelector('.preview-pixel-clock')")),"PICKERS_MISSING_OR_CLOCK_RETURNED");
        eval(web(activity),"document.querySelector('[data-view=settings]').click();document.getElementById('theme').closest('details').open=true;true");
        tapSelector("[data-picker-for=theme]");waitForJs(web(activity),"document.getElementById('suikePicker').open",5000);
        require(Boolean.TRUE.equals(eval(web(activity),"document.getElementById('suikePickerTitle').textContent==='外观'&&document.querySelectorAll('#suikePicker [role=option]').length===3&&getComputedStyle(document.getElementById('theme')).pointerEvents==='none'")),"NATIVE_SELECT_NOT_REPLACED");
        screenshot("picker-theme-light.png");tapSelector("#suikePicker [data-picker-value=dark]");pickerClosed();
        require(original.equals(stored())&&Boolean.TRUE.equals(eval(web(activity),"document.getElementById('theme').value==='dark'")),"PICKER_THEME_SAVED_TOO_EARLY");
        eval(web(activity),"document.getElementById('settingsForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));true");
        require(Boolean.TRUE.equals(eval(web(activity),"__suikeQA.state().settings.theme==='dark'")),"PICKER_THEME_NOT_SAVED");
        tapSelector("[data-picker-for=theme]");waitForJs(web(activity),"document.getElementById('suikePicker').open",5000);screenshot("picker-theme-dark.png");
        tapSelector("#suikePicker .picker-close");pickerClosed();
        eval(web(activity),"__suikeQA.fixtureStorage('"+STORAGE+"',"+JSONObject.quote(original)+");true");restart();
        record("theme_uses_custom_sheet_and_requires_existing_save_action",new JSONObject().put("passed",true));
        eval(web(activity),"document.querySelector('[data-view=settings]').click();SuikeAppearance.setEnabled(true);document.getElementById('theme').closest('details').open=true;true");
        tapSelector("[data-picker-for=theme]");waitForJs(web(activity),"document.getElementById('suikePicker').open",5000);screenshot("picker-theme-glass.png");
        require(Boolean.TRUE.equals(eval(web(activity),"parseFloat(getComputedStyle(document.getElementById('suikePicker')).borderRadius)>=20")),"PICKER_SHAPE_MISMATCH");
        tapSelector("#suikePicker .picker-close");pickerClosed();eval(web(activity),"SuikeAppearance.setEnabled(false);true");
        record("custom_sheet_follows_glass_and_monochrome_theme",new JSONObject().put("passed",true));
        step="picker_school_week";
        tapSelector("[data-picker-for=teachingSchool]");waitForJs(web(activity),"document.getElementById('suikePicker').open",5000);screenshot("picker-school.png");
        tapSelector("#suikePicker [data-picker-value=njust]");pickerClosed();
        require(Boolean.TRUE.equals(eval(web(activity),"document.getElementById('teachingSchool').value==='njust'&&document.querySelector('[data-picker-for=teachingSchool]').textContent.indexOf('南京理工')>=0")),"PICKER_SCHOOL_BINDING_FAILED");
        tapSelector("[data-picker-for=weekSelect]");waitForJs(web(activity),"document.getElementById('suikePicker').open",5000);screenshot("picker-week.png");
        tapSelector("#suikePicker [data-picker-value='2026-10-19']");pickerClosed();
        require(Boolean.TRUE.equals(eval(web(activity),"document.getElementById('weekSelect').value==='2026-10-19'"))&&original.equals(stored()),"PICKER_WEEK_CHANGED_COURSES");
        record("school_and_week_choices_preserve_original_behaviour",new JSONObject().put("passed",true));
        step="picker_calendar";
        eval(web(activity),"document.getElementById('startMonday').closest('details').open=true;true");
        tapSelector("[data-picker-for=startMonday]");waitForJs(web(activity),"document.getElementById('suikePicker').open",5000);screenshot("picker-calendar.png");
        tapSelector("#suikePicker .picker-month-label");screenshot("picker-year-month.png");tapSelector("#suikePicker .picker-month-label");
        tapSelector("#suikePicker [data-picker-date='2026-08-24']");
        require(Boolean.TRUE.equals(eval(web(activity),"document.getElementById('startMonday').value==='2026-08-31'")),"DATE_DRAFT_SAVED_EARLY");
        tapSelector("#suikePicker .picker-foot .button-primary");pickerClosed();
        require(Boolean.TRUE.equals(eval(web(activity),"document.getElementById('startMonday').value==='2026-08-24'"))&&original.equals(stored()),"DATE_VALUE_OR_SAVE_BOUNDARY_CHANGED");
        record("calendar_keeps_date_draft_until_confirm_without_saving_settings",new JSONObject().put("passed",true));
        step="picker_nested_back";
        eval(web(activity),"document.getElementById('deepSeekEntry').click();true");
        tapSelector("[data-picker-for=deepSeekMonday]");waitForJs(web(activity),"document.getElementById('suikePicker').open",5000);
        sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);pickerClosed();
        require(Boolean.TRUE.equals(eval(web(activity),"document.getElementById('deepSeekDialog').open")),"BACK_CLOSED_PARENT_DIALOG");
        eval(web(activity),"document.querySelector('#deepSeekDialog .ai-head .icon-button').click();true");waitForJs(web(activity),"!document.getElementById('deepSeekDialog').open",5000);
        record("android_back_closes_only_the_top_picker",new JSONObject().put("passed",true));
        step="picker_time";
        eval(web(activity),"document.querySelector('.period-edit-row').closest('details').open=true;true");tapSelector(".period-edit-row[data-period='1']");
        waitForJs(web(activity),"document.getElementById('productDialog').open",5000);tapSelector("[data-picker-for=periodStart]");waitForJs(web(activity),"document.getElementById('suikePicker').open",5000);screenshot("picker-time.png");
        tapSelector("#suikePicker [data-picker-time='hour-8']");tapSelector("#suikePicker [data-picker-time='minute-5']");
        require(Boolean.TRUE.equals(eval(web(activity),"document.getElementById('periodStart').value==='08:00'")),"TIME_DRAFT_SAVED_EARLY");
        tapSelector("#suikePicker .picker-foot .button-primary");pickerClosed();
        require(Boolean.TRUE.equals(eval(web(activity),"document.getElementById('productDialog').open&&document.getElementById('periodStart').value==='08:05'"))&&original.equals(stored()),"TIME_VALUE_OR_PARENT_CHANGED");
        tapSelector("#productConfirm");waitForJs(web(activity),"!document.getElementById('productDialog').open",5000);
        require(Boolean.TRUE.equals(eval(web(activity),"__suikeQA.state().periods[0].start==='08:05'")),"TIME_EDIT_NOT_PERSISTED");
        eval(web(activity),"document.querySelector('.toast-undo').click();true");require(original.equals(stored()),"TIME_UNDO_CHANGED_COURSES");
        record("time_picker_preserves_parent_save_validation_and_undo",new JSONObject().put("passed",true));
    }
    private void runEnhancementsSuite() throws Exception {
        step="enhancements_startup";launch();
        eval(web(activity),"window.__suikeQA.fixtureStorage('"+STORAGE+"',JSON.stringify(TIMETABLE_SEED));true");restart();
        String original=stored();
        for(String id:new String[]{"just","hhu","njust"}){
            step="guide_"+id;
            eval(web(activity),"(function(){document.querySelector('[data-view=settings]').click();var s=document.getElementById('teachingSchool');s.value='"+id+"';s.dispatchEvent(new Event('change'));return true;})()");
            ActivityMonitor monitor=addMonitor(TARGET+".PortalActivity",null,false);
            eval(web(activity),"window.__suikeQA.openPortal()");portal=waitForMonitorWithTimeout(monitor,15000);removeMonitor(monitor);
            require(portal!=null,"GUIDE_PORTAL_MISSING");
            Field windowsField=portal.getClass().getDeclaredField("windows");windowsField.setAccessible(true);
            @SuppressWarnings("unchecked") List<WebView> windows=(List<WebView>)windowsField.get(portal);
            final WebView external=windows.get(0);
            final Activity screen=portal;
            final android.view.View content=screen.findViewById(android.R.id.content);
            final android.widget.TextView guide=content.findViewWithTag("portalImportGuide");
            final android.widget.TextView notice=content.findViewWithTag("portalLoadingNotice");
            final android.widget.LinearLayout navigation=content.findViewWithTag("portalNavigation");
            require(guide!=null&&notice!=null&&navigation!=null,"GUIDE_HEADER_MISSING");
            require(notice.getText().toString().contains("校园系统")&&notice.getText().toString().contains("耐心等待"),"GUIDE_LOADING_NOTICE_MISSING");
            String expected="just".equals(id)?"https://ids.v.just.edu.cn/":"hhu".equals(id)?"https://my.hhu.edu.cn/portal-web/":"https://webvpn.njust.edu.cn/";
            if("just".equals(id)){
                require(navigation.getChildCount()==3,"JUST_ENTRY_COUNT");
                require("校园 VPN".contentEquals(((android.widget.Button)navigation.getChildAt(1)).getText())&&"直连（备用）".contentEquals(((android.widget.Button)navigation.getChildAt(2)).getText()),"JUST_VPN_PRIORITY");
                require(guide.getText().toString().contains("个人课表")&&guide.getText().toString().contains("核对"),"JUST_GUIDE_STEPS");
            }else require(navigation.getChildCount()==2,"OTHER_SCHOOL_ENTRY_CHANGED");
            final byte[] html="<html><body><p id=guideFixture>学校网页加载示例</p></body></html>".getBytes(StandardCharsets.UTF_8);
            runOnMainSync(()->{external.stopLoading();external.getSettings().setBlockNetworkLoads(true);external.setWebViewClient(new WebViewClient(){
                @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){return new WebResourceResponse("text/html","UTF-8",new ByteArrayInputStream(html));}
            });((android.widget.Button)navigation.getChildAt(1)).performClick();});
            waitForJs(external,"!!document.getElementById('guideFixture')",15000);
            require(Boolean.TRUE.equals(eval(external,"location.href==="+JSONObject.quote(expected))),"GUIDE_WRONG_DEFAULT_ENTRY");
            require(notice.getVisibility()==android.view.View.VISIBLE,"GUIDE_NOTICE_NOT_PERSISTENT");
            require(Boolean.TRUE.equals(eval(external,"typeof SuikeNative==='undefined'&&typeof SuikeDeepSeek==='undefined'")),"PORTAL_AI_BRIDGE_LEAK");
            screenshot("guide-"+id+".png");
            if("just".equals(id)){
                runOnMainSync(()->((android.widget.Button)navigation.getChildAt(2)).performClick());
                waitForJs(external,"location.href==='https://my.just.edu.cn/'",10000);
                record("just_defaults_to_campus_vpn_with_explicit_direct_fallback",new JSONObject().put("passed",true));
            }
            runOnMainSync(screen::finish);portal=null;waitForIdleSync();
            require(original.equals(stored()),"GUIDE_CHANGED_TIMETABLE");
        }
        record("all_school_pages_keep_loading_notice_and_isolate_native_bridge",new JSONObject().put("schools",3));
        step="deepseek_settings";
        require(Boolean.TRUE.equals(eval(web(activity),"typeof SuikeNative.saveDeepSeekConfig==='function'&&!!document.getElementById('deepSeekSettings')")),"AI_SETTINGS_MISSING");
        eval(web(activity),"SuikeAppearance.setEnabled(false);document.querySelector('[data-view=settings]').click();window.scrollTo(0,0);true");
        require(Boolean.TRUE.equals(eval(web(activity),"document.querySelectorAll('.lg-tab-icon').length===3&&Array.from(document.querySelectorAll('.lg-tab-icon')).every(function(i){return getComputedStyle(i).display!=='none';})&&document.getElementById('deepSeekDialog').open===false&&document.getElementById('deepSeekEntry').closest('#settingsView')!==null")),"CLAUDE_NAV_OR_MINIMAL_ENTRY_MISSING");
        SystemClock.sleep(300);screenshot("settings-entry-classic.png");
        eval(web(activity),"SuikeAppearance.setEnabled(true);true");SystemClock.sleep(400);screenshot("settings-entry-glass.png");
        record("claude_three_nav_icons_remain_in_both_modes_and_deepseek_is_one_corner_icon",new JSONObject().put("passed",true));
        eval(web(activity),"document.getElementById('deepSeekEntry').click();true");
        SystemClock.sleep(500);screenshot("deepseek-settings.png");
        eval(web(activity),"document.documentElement.dataset.theme='dark';true");
        SystemClock.sleep(400);screenshot("deepseek-settings-dark.png");
        eval(web(activity),"document.documentElement.dataset.theme='light';true");
        require(Boolean.TRUE.equals(eval(web(activity),"(function(){var key=document.getElementById('deepSeekApiKey');key.value='sk-suike-test-fixture-not-real-123456';document.getElementById('deepSeekSave').click();return key.value===''&&JSON.parse(SuikeNative.getDeepSeekConfig()).configured===true;})()")),"AI_KEY_NOT_SAVED");
        android.content.SharedPreferences prefs=getTargetContext().getSharedPreferences("suike_deepseek_private",0);
        require(prefs.contains("ciphertext")&&prefs.contains("iv")&&!prefs.getAll().toString().contains("sk-suike-test-fixture"),"AI_KEY_NOT_ENCRYPTED");
        require(!stored().contains("sk-suike-test-fixture")&&original.equals(stored()),"AI_KEY_IN_TIMETABLE");
        restart();
        require(Boolean.TRUE.equals(eval(web(activity),"JSON.parse(SuikeNative.getDeepSeekConfig()).configured===true&&document.getElementById('deepSeekApiKey').value===''")),"AI_KEY_NOT_PERSISTED");
        record("deepseek_key_encrypted_persists_without_exposing_value_or_changing_courses",new JSONObject().put("passed",true));
        step="deepseek_clarification";
        eval(web(activity),"(function(){window.__aiNative=SuikeNative;var fake=Object.create(__aiNative);fake.getDeepSeekConfig=function(){return __aiNative.getDeepSeekConfig();};fake.requestDeepSeek=function(id,action,raw){window.__aiRequest={id:id,action:action,payload:JSON.parse(raw)};return true;};window.SuikeNative=fake;document.querySelector('[data-view=settings]').click();document.getElementById('deepSeekEntry').click();document.getElementById('deepSeekCourseText').value='AI测试物理实验，日期和节次不明确';document.getElementById('deepSeekParse').click();SuikeDeepSeek.receive(__aiRequest.id,{ok:true,result:{status:'clarify',questions:[{id:'date',question:'具体哪天上课？',choices:[]},{id:'period',question:'第几节上课？',choices:[]}]}});return true;})()");
        require(original.equals(stored()),"AI_AMBIGUITY_CHANGED_STATE");
        require(Boolean.TRUE.equals(eval(web(activity),"!document.getElementById('deepSeekQuestions').hidden&&document.getElementById('deepSeekPreview').hidden")),"AI_QUESTIONS_MISSING");
        eval(web(activity),"document.getElementById('deepSeekQuestions').scrollIntoView({block:'center'});true");SystemClock.sleep(300);screenshot("deepseek-questions.png");
        eval(web(activity),"(function(){var inputs=document.querySelectorAll('#deepSeekQuestions input');inputs[0].value='2026-10-19';inputs[1].value='第3-4节';document.getElementById('deepSeekQuestions').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true;})()");
        require(Boolean.TRUE.equals(eval(web(activity),"__aiRequest.payload.answers.length===2&&!__aiRequest.payload.context.courses&&JSON.stringify(__aiRequest.payload).indexOf('sk-suike-test-fixture')<0")),"AI_REQUEST_SCOPE");
        eval(web(activity),"SuikeDeepSeek.receive(__aiRequest.id,{ok:true,result:{protocol:2,status:'scope',mode:'personal',basis:'老师消息',candidates:[]}});SuikeDeepSeek.receive(__aiRequest.id,{ok:true,result:{protocol:2,status:'ready',courses:[{name:'AI测试物理实验',room:'实验楼203',teacher:'',audience:{kind:'personal',classIds:[],groupIds:[],evidence:'老师消息'},schedule:{weeks:'',weekday:'',periods:'3-4',dates:['2026-10-19'],clock:''},source:{location:'文字消息',quote:'AI测试物理实验，日期和节次不明确'}}]}});document.getElementById('deepSeekPreview').scrollIntoView({block:'center'});true");
        require(original.equals(stored())&&Boolean.TRUE.equals(eval(web(activity),"!document.getElementById('deepSeekPreview').hidden")),"AI_PREVIEW_WROTE_COURSES");
        SystemClock.sleep(300);screenshot("deepseek-preview.png");
        record("deepseek_asks_questions_and_previews_without_saving_or_sending_existing_courses",new JSONObject().put("passed",true).put("providerCalled",false));
        step="deepseek_confirm";
        eval(web(activity),"document.getElementById('deepSeekConfirm').click();true");
        waitForJs(web(activity),"!document.getElementById('deepSeekDialog').open",5000);
        require(Boolean.TRUE.equals(eval(web(activity),"window.__suikeQA.state().courses.some(function(c){return c.name==='AI测试物理实验'&&c.dates[0]==='2026-10-19'&&c.start===3&&c.end===4;})")),"AI_CONFIRM_MISSING");
        eval(web(activity),"document.querySelector('.toast-undo').click();window.SuikeNative=window.__aiNative;SuikeNative.clearDeepSeekConfig();SuikeAppearance.setEnabled(false);true");
        require(original.equals(stored())&&Boolean.TRUE.equals(eval(web(activity),"JSON.parse(SuikeNative.getDeepSeekConfig()).configured===false")),"AI_UNDO_OR_KEY_REMOVE_FAILED");
        record("deepseek_confirm_undo_and_key_removal_work_in_android_webview",new JSONObject().put("passed",true));
        step="course_documents";
        Class<?> reader=Class.forName(TARGET+".CourseDocumentReader"),resultType=Class.forName(TARGET+".CourseDocumentReader$Result");
        Method read=reader.getMethod("read",android.content.Context.class,android.net.Uri.class,String.class,resultType);
        for(String filename:new String[]{"course.docx","course.xlsx","course.png","course.pdf"}){
            step="document_"+filename.substring(filename.lastIndexOf('.')+1);
            CountDownLatch ready=new CountDownLatch(1);AtomicReference<String> text=new AtomicReference<>(""),error=new AtomicReference<>(""),attachment=new AtomicReference<>("");
            Object callback=java.lang.reflect.Proxy.newProxyInstance(resultType.getClassLoader(),new Class<?>[]{resultType},(proxy,method,args)->{
                if("completed".equals(method.getName())){text.set((String)args[0]);error.set((String)args[1]);attachment.set((String)args[2]);ready.countDown();}return null;
            });
            require(Boolean.TRUE.equals(read.invoke(null,getTargetContext(),android.net.Uri.parse("content://cn.suike.timetable.tests.documents/"+filename),filename,callback)),"DOCUMENT_READ_NOT_STARTED");
            require(ready.await(90,TimeUnit.SECONDS),"DOCUMENT_READ_TIMEOUT");require("none".equals(error.get()),"DOCUMENT_READ_FAILED");
            require(text.get().isEmpty()&&!attachment.get().isEmpty(),"FILE_FLATTENED_INTO_EDITOR_TEXT");
            step="document_"+filename.substring(filename.lastIndexOf('.')+1)+"_parts";
            JSONArray parts=(JSONArray)reader.getMethod("content",String.class).invoke(null,attachment.get());
            require(parts.length()>0,"ATTACHMENT_CONTENT_MISSING");
            if(filename.endsWith(".docx")){
                JSONObject doc=new JSONObject(parts.getJSONObject(0).getString("text"));
                require("word".equals(doc.getString("kind"))&&doc.getJSONArray("blocks").toString().contains("物理实验")&&doc.toString().contains("2026年10月19日"),"WORD_STRUCTURE_OR_CONTENT_LOST");
                require(doc.toString().contains("columnSpan")&&doc.toString().contains("verticalMerge"),"WORD_MERGES_LOST");
            }
            if(filename.endsWith(".xlsx")){
                JSONObject doc=new JSONObject(parts.getJSONObject(0).getString("text"));
                require("excel".equals(doc.getString("kind"))&&doc.toString().contains("物理实验")&&doc.toString().contains("2026-10-19")&&doc.toString().contains("A1:A2")&&doc.toString().contains("address"),"EXCEL_DATE_OR_LAYOUT_LOST");
            }
            if(filename.endsWith(".png")||filename.endsWith(".pdf")){
                JSONArray images=(JSONArray)reader.getMethod("imageContent",String.class).invoke(null,attachment.get());
                require(images.length()>0,"VISION_CONTENT_MISSING");
                String dataUrl=images.getJSONObject(0).getJSONObject("image_url").getString("url");
                require(dataUrl.startsWith(filename.endsWith(".png")?"data:image/png;base64,":"data:image/jpeg;base64,"),"VISION_CONTENT_INVALID");
                if(filename.endsWith(".png")){
                    ByteArrayOutputStream fixtureImage=new ByteArrayOutputStream();
                    try(java.io.InputStream in=getTargetContext().getContentResolver().openInputStream(android.net.Uri.parse("content://cn.suike.timetable.tests.documents/"+filename))){byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1)fixtureImage.write(buffer,0,n);}
                    require(java.util.Arrays.equals(fixtureImage.toByteArray(),android.util.Base64.decode(dataUrl.substring(dataUrl.indexOf(',')+1),android.util.Base64.NO_WRAP)),"ORIGINAL_IMAGE_BYTES_CHANGED");
                }
            }
            step="document_"+filename.substring(filename.lastIndexOf('.')+1)+"_request";
            JSONObject input=new JSONObject().put("protocol",2).put("stage","inspect").put("text","").put("attachmentId",attachment.get()).put("context",new JSONObject(eval(web(activity),"JSON.stringify({startMonday:__suikeQA.state().settings.startMonday,totalWeeks:__suikeQA.state().settings.totalWeeks,periods:__suikeQA.state().periods})").toString())).put("answers",new JSONArray());
            JSONObject request=(JSONObject)Class.forName(TARGET+".DeepSeekClient").getMethod("courseRequest",String.class,JSONObject.class).invoke(null,"deepseek-chat",input);
            JSONArray sent=request.getJSONArray("messages").getJSONObject(1).getJSONArray("content");
            require(sent.length()==parts.length()+1,"ATTACHMENT_NOT_SENT_TO_MODEL");
            for(int i=0;i<parts.length();i++)require(parts.getJSONObject(i).toString().equals(sent.getJSONObject(i+1).toString()),"ATTACHMENT_REQUEST_CHANGED");
            if(filename.endsWith(".png")||filename.endsWith(".pdf"))require("deepseek-flash".equals(request.getString("model")),"VISION_MODEL_NOT_SELECTED");
            else require("deepseek-chat".equals(request.getString("model")),"TEXT_MODEL_CHANGED_UNNECESSARILY");
            if(filename.endsWith(".xlsx")){
                eval(web(activity),"(function(){window.__fileNative=SuikeNative;var fake=Object.create(__fileNative);fake.getDeepSeekConfig=function(){return __fileNative.getDeepSeekConfig();};fake.pickDeepSeekDocument=function(id){window.__fileRequest=id;return true;};window.SuikeNative=fake;document.querySelector('[data-view=settings]').click();document.getElementById('deepSeekEntry').click();document.getElementById('deepSeekCourseText').value='老师通知：请按附件确认实验课程。';document.getElementById('deepSeekFile').click();SuikeDeepSeek.receiveDocument(__fileRequest,{text:'',error:'none',name:'实验安排.xlsx',attachmentId:"+JSONObject.quote(attachment.get())+"});return true;})()");
                require(Boolean.TRUE.equals(eval(web(activity),"document.getElementById('deepSeekCourseText').value==='老师通知：请按附件确认实验课程。'&&document.querySelector('.ai-file-hint').textContent==='实验安排.xlsx'")),"ATTACHMENT_OVERWROTE_TEACHER_MESSAGE");
                eval(web(activity),"document.getElementById('deepSeekFile').scrollIntoView({block:'center'});true");screenshot("deepseek-file-attachment.png");
                eval(web(activity),"window.SuikeNative=window.__fileNative;true");
            }
            require(original.equals(stored()),"DOCUMENT_READ_CHANGED_COURSES");
            record("local_"+filename.substring(filename.lastIndexOf('.')+1)+"_read_preserves_content_without_importing",new JSONObject().put("passed",true).put("providerCalled",false));
        }
        eval(web(activity),"document.querySelector('#deepSeekDialog .ai-head .icon-button').click();true");
        waitForJs(web(activity),"!document.getElementById('deepSeekDialog').open",5000);
        reader.getMethod("clearAttachments").invoke(null);
    }
    private void runSchoolSuite() throws Exception {
        step="school_startup";launch();
        require(Boolean.TRUE.equals(eval(web(activity),"typeof SuikeNative.openTeachingPortalForSchool==='function'&&SuikeSchoolAdapters.list().length===3")),"SCHOOL_BRIDGE_MISSING");
        record("startup_and_three_bundled_profiles",new JSONObject().put("profiles",3));
        Class<?> registry=Class.forName(TARGET+".SchoolAdapterRegistry"),profileType=Class.forName(TARGET+".SchoolAdapterRegistry$Profile"),policy=Class.forName(TARGET+".PortalNavigationPolicy");
        Object just=registry.getMethod("find",String.class).invoke(null,"just"),hhu=registry.getMethod("find",String.class).invoke(null,"hhu"),njust=registry.getMethod("find",String.class).invoke(null,"njust");
        Method capturePolicy=policy.getMethod("isCapturePage",profileType,String.class),allowed=policy.getMethod("isAllowedHttps",profileType,String.class);
        require(Boolean.TRUE.equals(capturePolicy.invoke(null,just,"https://client.v.just.edu.cn/http/synthetic_map/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html")),"JUST_POLICY_REGRESSION");
        require(Boolean.TRUE.equals(capturePolicy.invoke(null,hhu,"https://jwxt.hhu.edu.cn/jsxsd/xskb/xskb_list.do")),"HHU_CAPTURE_POLICY");
        require(Boolean.TRUE.equals(capturePolicy.invoke(null,njust,"https://webvpn.njust.edu.cn/http/synthetic_map/njlgdx/xskb/xskb_list.do")),"NJUST_CAPTURE_POLICY");
        require(Boolean.FALSE.equals(allowed.invoke(null,hhu,"https://my.just.edu.cn/"))&&Boolean.FALSE.equals(allowed.invoke(null,njust,"http://202.119.81.112:9080/njlgdx/"))&&Boolean.FALSE.equals(allowed.invoke(null,njust,"https://webvpn.njust.edu.cn.evil.invalid/")),"SCHOOL_POLICY_OVERBROAD");
        record("selected_school_navigation_isolation_and_legacy_policy",new JSONObject().put("passed",true));
        Method parse=Class.forName(TARGET+".PortalCaptureContract").getMethod("parse",String.class);
        for(String id:new String[]{"hhu","njust"}){
            JSONObject valid=new JSONObject(asset(id+"-capture.json"));require(parse.invoke(null,valid.toString())!=null,"SCHOOL_NATIVE_CONTRACT_REJECTED");
            JSONObject privateField=new JSONObject(valid.toString());privateField.getJSONArray("rows").getJSONObject(0).put("studentId","PRIVATE_SENTINEL");boolean rejected=false;
            try{parse.invoke(null,privateField.toString());}catch(java.lang.reflect.InvocationTargetException expected){rejected=true;}
            require(rejected,"PRIVATE_FIELD_ACCEPTED");
        }
        record("both_native_protocol_contracts_reject_private_fields",new JSONObject().put("passed",true));
        for(String id:new String[]{"hhu","njust"}){
            step=id+"_blank_state";
            eval(web(activity),"(function(){var s=JSON.parse(JSON.stringify(TIMETABLE_SEED));s.courses=[{id:'manual-qa-lab',name:'手工测试实验',day:6,start:5,end:6,room:'测试实验室',teacher:'',color:'teal',dates:['2026-10-17'],sourceTime:''}];s.importLedger=null;s.skipLegacyImportBaseline=true;window.__suikeQA.fixtureStorage('"+STORAGE+"',JSON.stringify(s));return true;})()");restart();
            eval(web(activity),"(function(){document.querySelector('[data-view=\"settings\"]').click();var pick=document.getElementById('teachingSchool');pick.value='"+id+"';pick.dispatchEvent(new Event('change'));return true;})()");
            ActivityMonitor monitor=addMonitor(TARGET+".PortalActivity",null,false);
            eval(web(activity),"window.__suikeQA.openPortal()");portal=waitForMonitorWithTimeout(monitor,15000);removeMonitor(monitor);require(portal!=null,"SCHOOL_PORTAL_DID_NOT_OPEN");
            Field profileField=portal.getClass().getDeclaredField("school");profileField.setAccessible(true);Object selected=profileField.get(portal);require(id.equals(profileType.getField("id").get(selected)),"NATIVE_SELECTED_SCHOOL_MISMATCH");
            Field windowsField=portal.getClass().getDeclaredField("windows");windowsField.setAccessible(true);
            @SuppressWarnings("unchecked") List<WebView> windows=(List<WebView>)windowsField.get(portal);require(windows!=null&&!windows.isEmpty(),"SCHOOL_WEBVIEW_MISSING");
            WebView external=windows.get(0);final String page="hhu".equals(id)?"https://jwxt.hhu.edu.cn/jsxsd/xskb/xskb_list.do":"https://webvpn.njust.edu.cn/http/synthetic_map/njlgdx/xskb/xskb_list.do";
            final byte[] html=asset(id+"-fixture.html").getBytes(StandardCharsets.UTF_8);
            runOnMainSync(()->{external.stopLoading();external.getSettings().setBlockNetworkLoads(true);external.setWebViewClient(new WebViewClient(){@Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){return new WebResourceResponse("text/html","UTF-8",new ByteArrayInputStream(page.equals(request.getUrl().toString())?html:new byte[0]));}});external.loadUrl(page);});
            waitForJs(external,"!!document.querySelector('table')",15000);
            require(Boolean.TRUE.equals(eval(external,"typeof SuikeNative==='undefined'&&typeof SuikeImport==='undefined'")),"SCHOOL_PAGE_HAS_LOCAL_BRIDGE");
            String before=stored();Field read=portal.getClass().getDeclaredField("readButton");read.setAccessible(true);android.widget.Button readButton=(android.widget.Button)read.get(portal);
            step=id+"_native_read";runOnMainSync(readButton::performClick);
            waitForJs(web(activity),"!document.getElementById('teachingImportPreview').hidden&&!document.getElementById('confirmTeachingImport').hidden",15000);portal=null;
            require(before.equals(stored()),"READ_WROTE_BEFORE_CONFIRM");
            JSONObject preview=object("window.__suikeQA.inspectPreview()");require(preview.getInt("read")==27,"SCHOOL_MEETING_COUNT");
            record(id+"_native_button_collector_contract_and_uncommitted_preview",new JSONObject().put("meetings",27).put("bridgeAbsent",true));
            if("njust".equals(id)){
                eval(web(activity),"document.getElementById('confirmTeachingImport').click();true");require(before.equals(stored()),"NJUST_CLOCK_CONFIRMATION_BYPASSED");
                eval(web(activity),"(function(){var c=document.getElementById('schoolManualTimes');c.checked=true;c.dispatchEvent(new Event('change'));return true;})()");
            }
            step=id+"_confirm";eval(web(activity),"document.getElementById('confirmTeachingImport').click();true");
            JSONObject imported=object("window.__suikeQA.summary()");require(imported.getInt("meetings")==28,"SCHOOL_IMPORT_OR_MANUAL_LAB_LOST");
            require(Boolean.TRUE.equals(eval(web(activity),"window.__suikeQA.state().importLedger.source.system==='"+id+"-jsxsd'")),"SCHOOL_LEDGER_SOURCE");
            if("hhu".equals(id))require(Boolean.TRUE.equals(eval(web(activity),"window.__suikeQA.state().periods.length===12&&document.querySelectorAll('.period-edit-row').length===12&&window.__suikeQA.state().periods[5].start==='14:00'")),"HHU_TWELVE_SECTION_UI");
            if("njust".equals(id))require(Boolean.TRUE.equals(eval(web(activity),"window.__suikeQA.state().courses.filter(function(c){return c.timeMode==='pending';}).reduce(function(n,c){return n+c.dates.length;},0)===3")),"NJUST_UNKNOWN_CLOCK_GUESSED");
            String importedState=stored(),capture=asset(id+"-capture.json");
            eval(web(activity),"SuikeImport.receiveCapture("+capture+");true");
            if("njust".equals(id))eval(web(activity),"(function(){var c=document.getElementById('schoolManualTimes');c.checked=true;c.dispatchEvent(new Event('change'));return true;})()");
            eval(web(activity),"document.getElementById('confirmTeachingImport').click();true");require(importedState.equals(stored()),"SCHOOL_REPEAT_IMPORT_DUPLICATED");
            restart();require(importedState.equals(stored()),"SCHOOL_RESTART_LOST_DATA");
            record(id+"_confirmed_import_repeat_and_restart_preserve_manual_lab",new JSONObject().put("meetings",28).put("source",id+"-jsxsd"));
            step=id+"_custom_line";
            require(Boolean.TRUE.equals(eval(web(activity),"(function(){document.querySelector('[data-view=\"week\"]').click();var card=Array.from(document.querySelectorAll('.week-course')).find(function(c){return c.querySelector('.course-name').textContent==='合成高等数学';});if(!card)return false;window.__qaLineId=card.dataset.weekCourseId;window.__qaLineBefore={background:getComputedStyle(card).backgroundColor,color:getComputedStyle(card).color};card.click();document.getElementById('editCourse').click();var form=document.getElementById('courseForm'),color=form.elements.namedItem('color');color.value='#8065ad';color.dispatchEvent(new Event('input'));form.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));var after=Array.from(document.querySelectorAll('.week-course')).find(function(c){return c.dataset.weekCourseId===window.__qaLineId;});return getComputedStyle(after).borderLeftColor==='rgb(128, 101, 173)'&&getComputedStyle(after).backgroundColor===window.__qaLineBefore.background&&getComputedStyle(after).color===window.__qaLineBefore.color;})()")),"CUSTOM_LINE_DID_NOT_ONLY_CHANGE_BORDER");
            record(id+"_custom_color_changes_only_actual_webview_left_border",new JSONObject().put("passed",true));
        }
    }
    private void runPromotionSuite() throws Exception {
        step="promotion_startup";launch();
        eval(web(activity),"window.__suikeQA.fixtureStorage('"+STORAGE+"',null);localStorage.removeItem('suike.appearance.v1');true");restart();
        require(Boolean.TRUE.equals(eval(web(activity),"!SuikeAppearance.isEnabled()&&!document.getElementById('glassEnabled').checked&&document.documentElement.dataset.glass==='off'&&document.getElementById('suikeLiquidStyles').media==='not all'")),"CLASSIC_DEFAULT_MISSING");
        record("classic_ui_is_default_without_an_appearance_preference",new JSONObject().put("glassEnabled",false));
        String appearanceCourses=stored();
        eval(web(activity),"document.getElementById('glassEnabled').checked=true;document.getElementById('glassEnabled').dispatchEvent(new Event('change',{bubbles:true}));true");restart();
        require(Boolean.TRUE.equals(eval(web(activity),"SuikeAppearance.isEnabled()&&document.getElementById('glassEnabled').checked&&document.getElementById('suikeLiquidStyles').media==='all'")),"GLASS_OPT_IN_NOT_PERSISTED");
        eval(web(activity),"document.getElementById('glassEnabled').checked=false;document.getElementById('glassEnabled').dispatchEvent(new Event('change',{bubbles:true}));true");restart();
        require(Boolean.TRUE.equals(eval(web(activity),"!SuikeAppearance.isEnabled()&&!document.getElementById('glassEnabled').checked&&document.getElementById('suikeLiquidStyles').media==='not all'"))&&appearanceCourses.equals(stored()),"CLASSIC_OPT_OUT_NOT_PERSISTED");
        record("glass_switch_persists_both_choices_without_changing_courses",new JSONObject().put("passed",true));
        require(Boolean.TRUE.equals(eval(web(activity),"typeof SuikeNative.weekLongPressHaptic==='function'&&SuikeWeekInteractionsUI.holdMs===500&&!document.getElementById('pixelPreviewProgress')&&!window.__suikePixelPreview")),"PROMOTED_FEATURES_MISSING");
        record("shipping_features_present_without_demo_clock_or_controls",new JSONObject().put("holdMs",500).put("nativeHapticBridge",true));
        eval(web(activity),"__qaPromotion.clock('2026-10-12T02:23:00Z');__qaPromotion.theme('light');true");
        waitForJs(web(activity),"document.querySelectorAll('.preview-pixel-cell').length>32",5000);
        JSONObject light=object("__qaPromotion.dashboard()");require(light.getBoolean("graphInHeader")&&light.getBoolean("rightHeaderEmpty")&&!light.getBoolean("overflow")&&light.getJSONArray("blocks").toString().equals("[4,3,3,3,1,0,1]"),"PIXEL_HEADER_LAYOUT");
        require("rgb(0, 0, 0)".equals(light.getString("ink"))&&"rgb(34, 239, 104)".equals(light.getString("currentGreen"))&&light.getString("remaining").contains("本节剩 22 分钟"),"LIGHT_PIXEL_STATE");
        record("white_theme_pixel_header_status_and_now_countdown",light);eval(web(activity),"document.getElementById('toast').style.visibility='hidden';true");screenshot("beta2-today-light.png");eval(web(activity),"document.getElementById('toast').style.visibility='';true");
        eval(web(activity),"__qaPromotion.theme('dark');true");JSONObject dark=object("__qaPromotion.dashboard()");require("rgb(255, 255, 255)".equals(dark.getString("ink"))&&"3.8s".equals(dark.getString("breathe")),"DARK_PIXEL_STATE");
        record("black_theme_white_pixels_and_slow_green_breathing",dark);eval(web(activity),"document.getElementById('toast').style.visibility='hidden';true");screenshot("beta2-today-dark.png");eval(web(activity),"document.getElementById('toast').style.visibility='';true");
        step="promotion_quick_add";String beforeAdd=stored();eval(web(activity),"__qaPromotion.quickAdd();true");
        require(Boolean.TRUE.equals(eval(web(activity),"window.__suikeQA.state().courses.some(function(c){return c.name==='安卓快速新增测试'&&c.day===3&&c.start===3&&c.end===4&&c.room==='测试实验室'&&c.teacher==='测试教师'&&c.dates.length===1&&c.dates[0]==='2026-10-14';})")),"NATIVE_QUICK_ADD_FAILED");
        eval(web(activity),"document.querySelector('.toast-undo').click();true");require(beforeAdd.equals(stored()),"NATIVE_QUICK_ADD_UNDO");
        record("empty_slot_add_and_atomic_undo_in_shipping_webview",new JSONObject().put("passed",true));
        runOnMainSync(()->{android.view.inputmethod.InputMethodManager input=(android.view.inputmethod.InputMethodManager)activity.getSystemService(android.content.Context.INPUT_METHOD_SERVICE);if(input!=null)input.hideSoftInputFromWindow(activity.getWindow().getDecorView().getWindowToken(),0);});SystemClock.sleep(250);
        step="promotion_native_touch_drag";JSONObject points=object("__qaPromotion.points()");require(points.getDouble("ty")<points.getDouble("navTop"),"DRAG_TARGET_OBSCURED");
        String beforeDrag=stored();eval(web(activity),"__qaPromotion.wrapHaptic();true");
        long down=SystemClock.uptimeMillis();touch(points,"sx","sy",android.view.MotionEvent.ACTION_DOWN,down);SystemClock.sleep(700);
        waitForJs(web(activity),"SuikeWeekInteractionsUI.snapshot().phase==='dragging'",5000);
        require(Boolean.TRUE.equals(eval(web(activity),"window.__qaHapticCalls===1&&!!document.querySelector('.wk-drag-ghost')")),"NATIVE_HOLD_FEEDBACK_MISSING");
        touch(points,"tx","ty",android.view.MotionEvent.ACTION_MOVE,down);SystemClock.sleep(80);
        eval(web(activity),"window.__suikeQA.sampleFrames(500);true");touch(points,"tx","ty",android.view.MotionEvent.ACTION_UP,down);
        waitForJs(web(activity),"!document.querySelector('.wk-drag-ghost')&&SuikeWeekInteractionsUI.snapshot().phase==='idle'",5000);
        JSONObject exchange=object("__qaPromotion.exchange()");require(exchange.getBoolean("sourceMoved")&&exchange.getBoolean("targetMoved")&&exchange.getBoolean("futureSourceKept")&&exchange.getBoolean("futureTargetKept")&&exchange.getInt("meetings")==181&&!exchange.getBoolean("dialog")&&exchange.getInt("hapticCalls")==1,"NATIVE_SWAP_DATA_OR_CLICK");
        record("actual_android_touch_hold_haptic_swap_and_future_dates",exchange);
        waitForJs(web(activity),"window.__qaFrameSample.done===true",5000);
        JSONObject frames=object("(function(){var a=window.__qaFrameSample.intervals.filter(function(n){return n>0;}).sort(function(a,b){return a-b;});return {frames:a.length,medianMs:a[Math.floor(a.length/2)],p95Ms:a[Math.min(a.length-1,Math.floor(a.length*.95))]};})()");record("actual_drop_frame_sample_without_phone_framerate_claim",frames);screenshot("beta2-week-after-swap.png");
        eval(web(activity),"document.querySelector('.toast-undo').click();true");require(beforeDrag.equals(stored()),"NATIVE_SWAP_UNDO_NOT_ATOMIC");
        record("one_undo_restores_both_swapped_occurrences",new JSONObject().put("passed",true));
        eval(web(activity),"(function(){var c=document.querySelector('.week-course');c.click();return true;})()");require(Boolean.TRUE.equals(eval(web(activity),"document.getElementById('courseDialog').open&&!document.getElementById('courseDetail').textContent.includes('保存方式')")),"STORAGE_DESCRIPTION_NOT_REMOVED");
        record("shipping_course_details_remove_storage_explanation",new JSONObject().put("passed",true));
        eval(web(activity),"__qaPromotion.restore();true");
    }
    private void touch(JSONObject points,String x,String y,int action,long down) throws Exception {
        AtomicReference<Float> px=new AtomicReference<>(),py=new AtomicReference<>();
        runOnMainSync(()->{WebView view=webUnchecked(activity);int[] location=new int[2];view.getLocationOnScreen(location);float scale=view.getWidth()/(float)points.optDouble("width");px.set(location[0]+(float)points.optDouble(x)*scale);py.set(location[1]+(float)points.optDouble(y)*scale);});
        android.view.MotionEvent event=android.view.MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,px.get(),py.get(),0);event.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);
        try{sendPointerSync(event);}finally{event.recycle();}
    }
    private void launch() throws Exception {
        Intent intent = new Intent(Intent.ACTION_MAIN).setClassName(TARGET, TARGET + ".MainActivity");
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        activity = startActivitySync(intent); waitReady();
        eval(web(activity), driver); require(Boolean.TRUE.equals(eval(web(activity), "!!window.__suikeQA")), "QA_DRIVER_MISSING");
        if("promoted".equals(mode))eval(web(activity),asset("promotion-driver.js"));
    }
    private String fixtureHtml() throws Exception {
        JSONObject data = new JSONObject(fixture);
        JSONObject term = data.getJSONObject("term");
        String year = term.getString("year"), semester = term.getString("semester");
        StringBuilder html = new StringBuilder("<!doctype html><meta charset=utf-8><title>Internal QA</title>");
        html.append("<div id=ajaxForm><select id=xnm><option selected>").append(escape(year)).append("</option></select><select id=xqm><option selected>").append(escape(semester)).append("</option></select></div><table id=kbgrid_table_0><tr><td><h6>").append(escape(year)).append("学年第").append(escape(semester)).append("学期</h6></td></tr><tr>");
        for (String header : new String[]{"时间段", "节次", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"}) html.append("<td>").append(header).append("</td>");
        html.append("</tr>");
        JSONArray rows = data.getJSONArray("rows");
        for (int period = 1; period <= 11; period++) {
            html.append("<tr><td>").append(period);
            if(period<=10){JSONObject time=new JSONArray(SCHOOL_TIMES).getJSONObject(period-1);html.append(' ').append(time.getString("start")).append('-').append(time.getString("end"));}
            html.append("</td>");
            for (int day = 1; day <= 7; day++) {
                String cell = day + "-" + period; html.append("<td id=\"").append(cell).append("\">");
                for (int index = 0; index < rows.length(); index++) {
                    JSONObject row = rows.getJSONObject(index); if (!cell.equals(row.getString("cell"))) continue;
                    html.append("<div class=timetable_con><span class=title><font color=blue>").append(escape(row.getString("name"))).append("</font></span>");
                    JSONArray lines = row.getJSONArray("lines");
                    for (int line = 0; line < lines.length(); line++) html.append("<p><font color=blue>").append(escape(lines.getString(line))).append("</font></p>");
                    html.append("</div>");
                }
                html.append("</td>");
            }
            html.append("</tr>");
        }
        return html.append("<tr><td>实践课程：时间待确认</td></tr></table>").toString();
    }
    private static String escape(String value) { return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;"); }
    private void restart() throws Exception { if (activity != null && !activity.isDestroyed()) { runOnMainSync(() -> activity.finish()); waitForIdleSync(); } launch(); }
    private void waitReady() throws Exception {
        long until = SystemClock.elapsedRealtime() + 45000;
        while (SystemClock.elapsedRealtime() < until) {
            WebView view = web(activity);
            if (view != null && Boolean.TRUE.equals(eval(view, "!!(window.__suikeBoot&&window.__suikeBoot.ready&&document.documentElement.dataset.suikeReady==='true'&&window.SuikeImport)"))) return;
            SystemClock.sleep(200);
        }
        throw new IllegalStateException("READY_TIMEOUT");
    }
    private void waitForJs(WebView view, String expression, long timeout) throws Exception { long until = SystemClock.elapsedRealtime() + timeout; while (SystemClock.elapsedRealtime() < until) { if (Boolean.TRUE.equals(eval(view, expression))) return; SystemClock.sleep(100); } throw new IllegalStateException("JS_WAIT_TIMEOUT"); }
    private JSONObject preview() throws Exception { return object("window.__suikeQA.preview(" + fixture + ")"); }
    private String stored() throws Exception { Object value = eval(web(activity), "localStorage.getItem('" + STORAGE + "')"); return value == null || value == JSONObject.NULL ? "<absent>" : String.valueOf(value); }
    private JSONObject object(String expression) throws Exception { Object value = eval(web(activity), "JSON.stringify(" + expression + ")"); require(value instanceof String, "JS_OBJECT_MISSING"); return new JSONObject((String) value); }
    private Object eval(WebView view, String code) throws Exception {
        if (view == null) throw new IllegalStateException("WEBVIEW_MISSING");
        CountDownLatch done = new CountDownLatch(1); AtomicReference<String> result = new AtomicReference<>();
        runOnMainSync(() -> view.evaluateJavascript(code, value -> { result.set(value); done.countDown(); }));
        if (!done.await(12, TimeUnit.SECONDS)) throw new IllegalStateException("JS_CALLBACK_TIMEOUT");
        if (result.get() == null) throw new IllegalStateException("JS_CALLBACK_EMPTY");
        return new JSONTokener(result.get()).nextValue();
    }
    private WebView web(Activity owner) throws Exception { Field field = owner.getClass().getDeclaredField("webView"); field.setAccessible(true); return (WebView) field.get(owner); }
    private WebView webUnchecked(Activity owner) { try { return web(owner); } catch (Exception e) { throw new IllegalStateException(); } }
    private String asset(String name) throws Exception { try (InputStream in = getContext().getAssets().open(name); ByteArrayOutputStream out = new ByteArrayOutputStream()) { byte[] b = new byte[4096]; int n; while ((n = in.read(b)) != -1) { if (out.size() + n > 512 * 1024) throw new IllegalStateException("TEST_ASSET_TOO_LARGE"); out.write(b, 0, n); } return new String(out.toByteArray(), StandardCharsets.UTF_8); } }
    private void record(String name, JSONObject details) throws Exception { checks.put(new JSONObject().put("name", name).put("passed", true).put("details", details)); }
    private static void require(boolean condition, String code) { if (!condition) throw new IllegalStateException(code); }
    private static void put(JSONObject object, String key, Object value) { try { object.put(key, value); } catch (Exception ignored) { } }
}
