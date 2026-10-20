package cn.suike.timetable.featuretests;

import android.app.Activity;
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
public final class MinuteWeekInstrumentation extends Instrumentation {
 private Activity activity;private WebView web;private String variant;private File folder;private final JSONArray runs=new JSONArray();
 @Override public void onCreate(Bundle args){variant=args==null?"unknown":args.getString("variant","unknown");super.onCreate(args);start();}
 private void require(boolean ok,String code){if(!ok)throw new AssertionError(code);}
 private Object eval(String script)throws Exception{CountDownLatch done=new CountDownLatch(1);AtomicReference<Object> out=new AtomicReference<>();runOnMainSync(()->web.evaluateJavascript(script,s->{try{out.set(new JSONTokener(s).nextValue());}catch(Exception ignored){}done.countDown();}));require(done.await(25,TimeUnit.SECONDS),"JS_TIMEOUT");return out.get();}
 private void waitJs(String script)throws Exception{long end=SystemClock.elapsedRealtime()+45000;do{if(Boolean.TRUE.equals(eval(script)))return;SystemClock.sleep(100);}while(SystemClock.elapsedRealtime()<end);throw new AssertionError("JS_CONDITION_TIMEOUT");}
 private JSONObject stats(List<Double> values)throws Exception{ArrayList<Double> sorted; synchronized(values){sorted=new ArrayList<>(values);}Collections.sort(sorted);JSONObject out=new JSONObject();out.put("count",sorted.size());if(!sorted.isEmpty()){out.put("p50ms",sorted.get(sorted.size()/2));out.put("p95ms",sorted.get(Math.min(sorted.size()-1,(int)(sorted.size()*.95))));out.put("over33ms",sorted.stream().filter(x->x>33.34).count());out.put("over50ms",sorted.stream().filter(x->x>50).count());}return out;}
 private void save(JSONObject report)throws Exception{try(FileOutputStream out=new FileOutputStream(new File(folder,variant+"-report.json"))){out.write(report.toString(2).getBytes("UTF-8"));}}
 private void picture(String name)throws Exception{SystemClock.sleep(350);CountDownLatch done=new CountDownLatch(1);AtomicReference<android.graphics.Bitmap> bmp=new AtomicReference<>();AtomicReference<Integer> result=new AtomicReference<>();runOnMainSync(()->{android.view.View v=activity.getWindow().getDecorView();android.graphics.Bitmap b=android.graphics.Bitmap.createBitmap(v.getWidth(),v.getHeight(),android.graphics.Bitmap.Config.ARGB_8888);bmp.set(b);PixelCopy.request(activity.getWindow(),b,r->{result.set(r);done.countDown();},new Handler(android.os.Looper.getMainLooper()));});require(done.await(8,TimeUnit.SECONDS)&&result.get()!=null&&result.get()==PixelCopy.SUCCESS,"PIXEL_COPY_FAILED");try(FileOutputStream out=new FileOutputStream(new File(folder,variant+"-"+name+".png"))){bmp.get().compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}finally{if(bmp.get()!=null)bmp.get().recycle();}}

 @Override public void onStart(){JSONObject report=new JSONObject();boolean passed=false;try{
require(Build.VERSION.SDK_INT==36&&"ranchu".equals(Build.HARDWARE),"EMULATOR_ONLY");folder=new File(getTargetContext().getExternalFilesDir(null),"minute-week-profile");require(folder.isDirectory()||folder.mkdirs(),"REPORT_FOLDER_FAILED");
Intent intent=new Intent().setClassName("cn.suike.timetable","cn.suike.timetable.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);activity=startActivitySync(intent);Field f=activity.getClass().getDeclaredField("webView");f.setAccessible(true);web=(WebView)f.get(activity);waitJs("!!(window.__suikeBoot&&__suikeBoot.ready&&window.SuikeFeatures)");
eval("(function(){var s=SuikeFeatures.getState(),today=new Date(Date.now()+28800000).toISOString().slice(0,10),mon=TimetableModel.mondayOf(today);window.__qaMon=mon;function date(d){return TimetableModel.addDays(mon,d-1);}function c(id,name,d,a,b){return {id,name,day:d,start:a,end:b,dates:[date(d)],room:'教学楼 A101',teacher:'示例教师',sourceTime:'',color:'teal'};}window.__qaEvent=function(id,name,a,b,d){d=d||1;return {id,name,day:d,start:null,end:null,timeMode:'clock',sourceTime:a+'-'+b,dates:[date(d)],room:'F104',teacher:'',color:'teal'};};s.courses=[c('a','大学物理',1,1,2),c('b','思想道德与法治',1,3,4),c('c','机械设计基础',1,5,6),c('d','形势与政策',1,9,10),c('e','大学英语',2,1,2),c('f','工程力学',2,5,6),c('g','程序设计',3,3,4),c('h','体育',4,5,6),c('i','大学英语',5,1,2),__qaEvent('minute-one','团日活动','18:40','18:50')];s.settings.theme='light';s.importLedger=null;s.skipLegacyImportBaseline=true;s.productSettings=SuikeFeatures.settings();s.productSettings.setupCompleted=true;s.productSettings.reminders.enabled=false;SuikeFeatures.commitState(s,'synthetic minute-affair fixture');window.__qaPeriods=JSON.stringify(s.periods);document.querySelector('[data-view=week]').click();SuikeAppearance.setEnabled(true);document.getElementById('toast').hidden=true;})()");
SystemClock.sleep(1800);waitJs("!window.SuikeOpticsWorker||SuikeOpticsWorker.status.pending===0");
require(Boolean.TRUE.equals(eval("(function(){var g=document.getElementById('weekGrid'),e=g.querySelector('.minute-gap-entry'),m=g.querySelector('.minute-time-mark'),c=g.querySelector('.week-course');return e.textContent.includes('团日活动')&&e.textContent.includes('18:40')&&Number(m.dataset.minuteHeight)===8&&document.getElementById('weekAffairsPanel').textContent.includes('18:40–18:50')&&c.getBoundingClientRect().width>g.querySelector('.grid-slot').getBoundingClientRect().width*.9&&JSON.stringify(SuikeFeatures.getState().periods)===__qaPeriods;})()")),"SINGLE_AFFAIR_LAYOUT_FAILED");
eval("var p=document.querySelectorAll('#weekGrid .grid-time')[6];window.scrollTo(0,p.getBoundingClientRect().top+scrollY-8)");
picture("light-single");
eval("document.querySelector('.minute-gap-entry').click()");
require(Boolean.TRUE.equals(eval("document.getElementById('courseDetail').textContent.includes('团日活动')&&document.getElementById('courseDetail').textContent.includes('18:40–18:50')")),"DETAIL_FAILED");
picture("event-detail");
eval("document.getElementById('courseDialog').close()");
eval("var s=SuikeFeatures.getState();s.courses.push(__qaEvent('inside','课内会议','08:10','08:20'),__qaEvent('break','课间碰面','08:45','08:55'),__qaEvent('m1','会议甲','18:00','18:10'),__qaEvent('m2','会议乙','18:05','18:15'),__qaEvent('early','早间签到','06:40','06:50'),__qaEvent('late','晚间总结','22:40','22:50'),__qaEvent('cross','跨节工作','10:40','11:10'),__qaEvent('tue','周二事务','18:40','18:50',2));SuikeFeatures.commitState(s,'dense affair fixture');document.getElementById('toast').hidden=true;document.querySelector('.minute-day-list').click()");
require(Boolean.TRUE.equals(eval("(function(){var s=SuikeFeatures.getState(),g=document.getElementById('weekGrid'),rows=document.querySelectorAll('#minuteListDialog .minute-event-row'),count=s.courses.filter(c=>c.day===1&&c.timeMode==='clock').length,breakEvent=s.courses.find(c=>c.id==='break'),inside=s.courses.find(c=>c.id==='inside');return rows.length===count&&g.textContent.includes('3 项事务')&&TimetableModel.conflictsFor(s.courses,breakEvent,s.periods).length===0&&TimetableModel.conflictsFor(s.courses,inside,s.periods).length>0&&JSON.stringify(s.periods)===__qaPeriods;})()")),"DENSE_AFFAIR_LAYOUT_FAILED");
picture("dense-list");
eval("document.getElementById('minuteListDialog').close();var s=SuikeFeatures.getState();s.settings.theme='dark';SuikeFeatures.commitState(s,'dark fixture');document.getElementById('toast').hidden=true;window.scrollTo(0,document.getElementById('weekGrid').getBoundingClientRect().top+scrollY)");
SystemClock.sleep(700);picture("dark-dense");
eval("var c=document.createElement('canvas');c.width=720;c.height=1280;var x=c.getContext('2d'),g=x.createLinearGradient(0,0,720,1280);g.addColorStop(0,'#1b4056');g.addColorStop(.6,'#648b9a');g.addColorStop(1,'#263d31');x.fillStyle=g;x.fillRect(0,0,720,1280);for(var j=0;j<1280;j+=60){x.strokeStyle='#a4b9b7';x.lineWidth=3;x.beginPath();x.moveTo(0,j);x.bezierCurveTo(180,j-80,450,j+80,720,j);x.stroke();}c.toBlob(function(b){var d=new DataTransfer();d.items.add(new File([b],'minute-qa-wallpaper.png',{type:'image/png'}));var input=document.getElementById('wallpaperImage');input.files=d.files;input.dispatchEvent(new Event('change',{bubbles:true}));},'image/png')");
waitJs("document.documentElement.dataset.wallpaper==='on'&&SuikeGlassScene.status.active");
eval("SuikeAppearance.setFrost(0,true);document.getElementById('toast').hidden=true;var p=document.querySelectorAll('#weekGrid .grid-time')[6];window.scrollTo(0,p.getBoundingClientRect().top+scrollY-8)");
SystemClock.sleep(1000);picture("wallpaper-dense");
eval("document.querySelector('.minute-day-list').click()");
picture("wallpaper-list");
eval("document.getElementById('minuteListDialog').close();document.getElementById('toast').hidden=true;window.__qaScroll={done:false,samples:[]};setTimeout(function(){var q=__qaScroll,start=performance.now(),last=start,max=Math.max(0,document.scrollingElement.scrollHeight-innerHeight);q.buildsBefore=SuikeGlassScene.status.backgroundBuilds;function tick(t){q.samples.push(t-last);last=t;window.scrollTo(0,max*(1-Math.cos((t-start)/1600*Math.PI))*.5);if(t-start<3200)requestAnimationFrame(tick);else{q.done=true;q.buildsAfter=SuikeGlassScene.status.backgroundBuilds;}}requestAnimationFrame(tick);},300)");
waitJs("__qaScroll.done");
require(Boolean.TRUE.equals(eval("SuikeGlassScene.status.active&&SuikeGlassScene.status.failures===0&&__qaScroll.buildsBefore===__qaScroll.buildsAfter&&JSON.stringify(SuikeFeatures.getState().periods)===__qaPeriods")),"GLASS_OR_SETTINGS_REGRESSION");
report.put("scroll",new JSONObject((String)eval("JSON.stringify(__qaScroll)")));report.put("checks",new JSONObject("{\"singleReadableEntry\":true,\"compactGap\":true,\"exactDurationRail\":true,\"courseWidthPreserved\":true,\"touchingBreakNotConflict\":true,\"denseListComplete\":true,\"detailWorks\":true,\"lightDarkWallpaper\":true,\"settingsUnchanged\":true,\"cachedGlassStableDuringScroll\":true}"));passed=true;
}catch(Throwable failure){try{report.put("failure",failure.getClass().getSimpleName()+":"+failure.getMessage());}catch(Exception ignored){}}finally{try{report.put("passed",passed);report.put("variant",variant);if(folder!=null)save(report);}catch(Exception ignored){}if(activity!=null)runOnMainSync(()->activity.finish());Bundle out=new Bundle();out.putString("minuteWeekReport",report.toString());finish(passed?Activity.RESULT_OK:Activity.RESULT_CANCELED,out);}}}