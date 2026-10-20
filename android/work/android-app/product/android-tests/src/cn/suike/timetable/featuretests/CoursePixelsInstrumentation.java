package cn.suike.timetable.featuretests;

import android.app.Activity;
import android.media.*;
import android.opengl.*;
import android.view.Surface;
import java.nio.ByteBuffer;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.view.FrameMetrics;
import android.view.PixelCopy;
import android.view.Window;
import android.webkit.WebView;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Isolated synthetic-data AVD only. Measures the shipping WebView and window. */
public final class CoursePixelsInstrumentation extends Instrumentation {
 private Activity activity;private WebView web;private String variant;private File folder;private final JSONArray runs=new JSONArray();
 @Override public void onCreate(Bundle args){variant=args==null?"unknown":args.getString("variant","unknown");super.onCreate(args);start();}
 private void require(boolean ok,String code){if(!ok)throw new AssertionError(code);}
 private Object eval(String script)throws Exception{CountDownLatch done=new CountDownLatch(1);AtomicReference<Object> out=new AtomicReference<>();runOnMainSync(()->web.evaluateJavascript(script,s->{try{out.set(new JSONTokener(s).nextValue());}catch(Exception ignored){}done.countDown();}));require(done.await(25,TimeUnit.SECONDS),"JS_TIMEOUT");return out.get();}
 private void waitJs(String script)throws Exception{long end=SystemClock.elapsedRealtime()+45000;do{if(Boolean.TRUE.equals(eval(script)))return;SystemClock.sleep(100);}while(SystemClock.elapsedRealtime()<end);throw new AssertionError("JS_CONDITION_TIMEOUT");}
 private JSONObject stats(List<Double> values)throws Exception{ArrayList<Double> sorted; synchronized(values){sorted=new ArrayList<>(values);}Collections.sort(sorted);JSONObject out=new JSONObject();out.put("count",sorted.size());if(!sorted.isEmpty()){out.put("p50ms",sorted.get(sorted.size()/2));out.put("p95ms",sorted.get(Math.min(sorted.size()-1,(int)(sorted.size()*.95))));out.put("over33ms",sorted.stream().filter(x->x>33.34).count());out.put("over50ms",sorted.stream().filter(x->x>50).count());}return out;}
 private void save(JSONObject report)throws Exception{try(FileOutputStream out=new FileOutputStream(new File(folder,variant+"-report.json"))){out.write(report.toString(2).getBytes("UTF-8"));}}
 private void picture(String name)throws Exception{SystemClock.sleep(350);CountDownLatch done=new CountDownLatch(1);AtomicReference<android.graphics.Bitmap> bmp=new AtomicReference<>();AtomicReference<Integer> result=new AtomicReference<>();runOnMainSync(()->{android.view.View v=activity.getWindow().getDecorView();android.graphics.Bitmap b=android.graphics.Bitmap.createBitmap(v.getWidth(),v.getHeight(),android.graphics.Bitmap.Config.ARGB_8888);bmp.set(b);PixelCopy.request(activity.getWindow(),b,r->{result.set(r);done.countDown();},new Handler(android.os.Looper.getMainLooper()));});require(done.await(8,TimeUnit.SECONDS)&&result.get()!=null&&result.get()==PixelCopy.SUCCESS,"PIXEL_COPY_FAILED");try(FileOutputStream out=new FileOutputStream(new File(folder,variant+"-"+name+".png"))){bmp.get().compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}finally{if(bmp.get()!=null)bmp.get().recycle();}}



 private final JSONObject checks=new JSONObject();
 private void check(String expression,String name)throws Exception{require(Boolean.TRUE.equals(eval(expression)),name);checks.put(name,true);}
 @Override public void onStart(){JSONObject report=new JSONObject();boolean passed=false;try{
  require(Build.VERSION.SDK_INT==36&&"ranchu".equals(Build.HARDWARE),"EMULATOR_ONLY");folder=new File(getTargetContext().getExternalFilesDir(null),"course-pixels-profile");require(folder.isDirectory()||folder.mkdirs(),"REPORT_FOLDER_FAILED");
  Intent intent=new Intent().setClassName("cn.suike.timetable","cn.suike.timetable.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);activity=startActivitySync(intent);Field field=activity.getClass().getDeclaredField("webView");field.setAccessible(true);web=(WebView)field.get(activity);waitJs("!!(window.__suikeBoot&&__suikeBoot.ready&&window.SuikePixelAmbient)");
  eval("window.__qaRealDate=Date;window.__qaNow=Date.parse('2026-10-19T08:20:00+08:00');window.Date=class extends __qaRealDate{constructor(...args){super(...(args.length?args:[__qaNow]));}static now(){return __qaNow;}};(function(){var s=SuikeFeatures.getState();s.settings.startMonday='2026-08-31';s.settings.totalWeeks=20;s.settings.theme='light';s.periods=[{start:'08:00',end:'08:45'},{start:'08:55',end:'09:40'}];s.courses=[{id:'math',name:'机械设计基础',teacher:'示例教师',room:'教学楼 E101',day:1,start:1,end:2,dates:['2026-10-12','2026-10-19','2026-10-26'],color:'teal',sourceTime:''},{id:'wed',name:'机械设计基础',teacher:'示例教师',room:'教学楼 E101',day:3,start:1,end:2,dates:['2026-10-21'],color:'teal',sourceTime:''},{id:'math-edit-qa',name:'机械设计基础补课',teacher:'示例教师',room:'教学楼 E101',day:2,start:1,end:2,dates:['2026-10-20'],color:'teal',sourceTime:''}];s.importLedger=null;s.skipLegacyImportBaseline=true;s.productSettings=SuikeFeatures.settings();s.productSettings.setupCompleted=true;s.productSettings.reminders.enabled=false;SuikeFeatures.commitState(s,'synthetic course pixel fixture');document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelector('[data-view=today]').click();document.querySelector('.agenda-card').click();})()");
  waitJs("!!document.getElementById('courseTermProgress')");
  check("document.querySelector('.course-term-count').textContent==='8 节'&&document.querySelectorAll('.course-term-dot.is-done').length===2&&document.querySelectorAll('.course-term-dot.is-current').length===1","period_counts_and_lineage");
  check("getComputedStyle(document.querySelector('.course-term-dot.is-current')).animationName==='preview-class-breathe'","current_green_breathing");check("getComputedStyle(document.querySelector(\".course-term-dot.is-upcoming\")).backgroundColor===\"rgb(34, 239, 104)\"&&getComputedStyle(document.querySelector(\".term-key-upcoming\"),\"::before\").backgroundColor===\"rgb(34, 239, 104)\"","future_green_matches_legend");picture("progress-current-light");
  eval("__qaNow=Date.parse('2026-10-19T08:50:00+08:00')");waitJs("document.querySelector('.course-term-count').textContent==='7 节'&&document.querySelectorAll('.course-term-dot.is-current').length===0");checks.put("break_is_not_current",true);
  eval("__qaNow=Date.parse('2026-10-19T09:40:00+08:00')");waitJs("document.querySelector('.course-term-count').textContent==='6 节'");checks.put("end_boundary_updates_live",true);
  eval("document.getElementById('courseDialog').close();var s=SuikeFeatures.getState();s.periods=[{start:'10:00',end:'10:45'},{start:'10:55',end:'11:40'}];SuikeFeatures.commitState(s,'synthetic Settings time change');document.querySelector('.agenda-card').click()");
  check("document.querySelector('.course-term-count').textContent==='8 节'&&document.querySelectorAll('.course-term-dot.is-current').length===0","settings_times_are_authority");picture("progress-settings-time");
  eval("document.getElementById('courseDialog').close();var result=SuikeFeatures.removeOccurrences({courseId:'math',date:'2026-10-26',scope:'one'});SuikeFeatures.commitState(result.state,'synthetic single occurrence deletion');document.querySelector('.agenda-card').click()");check("document.querySelector('.course-term-count').textContent==='6 节'","deleted_occurrence_not_counted");eval("document.getElementById('courseDialog').close()");
  JSONArray scenes=new JSONArray();for(String theme:new String[]{"light","dark"})for(int hour:new int[]{8,12,16,21})for(String view:new String[]{"today","week","settings"}){
   eval("__qaNow=Date.parse('2026-10-19T"+String.format(java.util.Locale.ROOT,"%02d",hour)+":20:00+08:00');var s=SuikeFeatures.getState();s.settings.theme='"+theme+"';SuikeFeatures.commitState(s,'synthetic appearance sample');document.querySelector('[data-view="+view+"]').click();document.querySelector('.pixel-day-scene[data-pixel-view="+view+"]').scrollIntoView({block:'center'});SuikePixelAmbient.refresh()");
   waitJs("SuikePixelAmbient.status.running&&SuikePixelAmbient.status.view==='"+view+"'&&SuikePixelAmbient.status.decoderCount===1");SystemClock.sleep(240);JSONObject scene=new JSONObject((String)eval("JSON.stringify(SuikePixelAmbient.status)"));require(scene.getInt("framePixels")<=80000,"SCENE_MEMORY_BOUND");scene.put("theme",theme);scene.put("hour",hour);scenes.put(scene);picture(view+"-"+hour+"-"+theme);
  }report.put("scenes",scenes);checks.put("four_dayparts_three_views_both_themes",true);
  eval("window.scrollTo(0,0)");waitJs("!SuikePixelAmbient.status.running&&SuikePixelAmbient.status.decoderCount===0");long before=((Number)eval("SuikePixelAmbient.status.draws")).longValue();SystemClock.sleep(600);require(((Number)eval("SuikePixelAmbient.status.draws")).longValue()==before,"OFFSCREEN_ANIMATION_WORK");checks.put("offscreen_stops_and_releases_decoder",true);
  eval("(function(){var c=document.createElement('canvas');c.width=40;c.height=40;var x=c.getContext('2d');x.fillStyle='#466982';x.fillRect(0,0,40,40);c.toBlob(function(b){var d=new DataTransfer();d.items.add(new File([b],'synthetic-wallpaper.png',{type:'image/png'}));var f=document.getElementById('wallpaperImage');f.files=d.files;f.dispatchEvent(new Event('change',{bubbles:true}));},'image/png');})()");
  waitJs("document.documentElement.dataset.appearance==='custom'");check("Array.from(document.querySelectorAll('.pixel-day-scene')).every(el=>el.hidden&&getComputedStyle(el).display==='none')&&!SuikePixelAmbient.status.running&&SuikePixelAmbient.status.decoderCount===0","custom_wallpaper_has_no_ambient_scene");picture("custom-no-scene");
  report.put("checks",checks);report.put("webView",WebView.getCurrentWebViewPackage().versionName);report.put("hardwareAccelerated",web.isHardwareAccelerated());report.put("method","Final shipping APK on dedicated API36 host-GPU emulator; synthetic timetable and wallpaper only");passed=true;
 }catch(Throwable failure){try{report.put("failure",failure.getClass().getSimpleName()+":"+failure.getMessage());if(web!=null){report.put("runtime",new JSONObject((String)eval("JSON.stringify({boot:window.__suikeBoot,ambient:window.SuikePixelAmbient&&SuikePixelAmbient.status,progress:document.querySelector('.course-term-count')?.textContent})")));picture("failure");}}catch(Exception ignored){}
 }finally{try{report.put("passed",passed);report.put("checks",checks);report.put("variant",variant);if(folder!=null)save(report);}catch(Exception ignored){}if(activity!=null)runOnMainSync(()->activity.finish());Bundle result=new Bundle();result.putString("coursePixelReport",report.toString());finish(passed?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);}}
}
