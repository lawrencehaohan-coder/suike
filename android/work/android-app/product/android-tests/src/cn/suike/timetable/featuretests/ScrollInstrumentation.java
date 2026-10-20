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
public final class ScrollInstrumentation extends Instrumentation {
 private Activity activity;private WebView web;private String variant;private File folder;private final JSONArray runs=new JSONArray();
 @Override public void onCreate(Bundle args){variant=args==null?"unknown":args.getString("variant","unknown");super.onCreate(args);start();}
 private void require(boolean ok,String code){if(!ok)throw new AssertionError(code);}
 private Object eval(String script)throws Exception{CountDownLatch done=new CountDownLatch(1);AtomicReference<Object> out=new AtomicReference<>();runOnMainSync(()->web.evaluateJavascript(script,s->{try{out.set(new JSONTokener(s).nextValue());}catch(Exception ignored){}done.countDown();}));require(done.await(25,TimeUnit.SECONDS),"JS_TIMEOUT");return out.get();}
 private void waitJs(String script)throws Exception{long end=SystemClock.elapsedRealtime()+45000;do{if(Boolean.TRUE.equals(eval(script)))return;SystemClock.sleep(100);}while(SystemClock.elapsedRealtime()<end);throw new AssertionError("JS_CONDITION_TIMEOUT");}
 private JSONObject stats(List<Double> values)throws Exception{ArrayList<Double> sorted; synchronized(values){sorted=new ArrayList<>(values);}Collections.sort(sorted);JSONObject out=new JSONObject();out.put("count",sorted.size());if(!sorted.isEmpty()){out.put("p50ms",sorted.get(sorted.size()/2));out.put("p95ms",sorted.get(Math.min(sorted.size()-1,(int)(sorted.size()*.95))));out.put("over33ms",sorted.stream().filter(x->x>33.34).count());out.put("over50ms",sorted.stream().filter(x->x>50).count());}return out;}
 private void save(JSONObject report)throws Exception{try(FileOutputStream out=new FileOutputStream(new File(folder,variant+"-report.json"))){out.write(report.toString(2).getBytes("UTF-8"));}}
 private void picture(String name)throws Exception{SystemClock.sleep(350);CountDownLatch done=new CountDownLatch(1);AtomicReference<android.graphics.Bitmap> bmp=new AtomicReference<>();AtomicReference<Integer> result=new AtomicReference<>();runOnMainSync(()->{android.view.View v=activity.getWindow().getDecorView();android.graphics.Bitmap b=android.graphics.Bitmap.createBitmap(v.getWidth(),v.getHeight(),android.graphics.Bitmap.Config.ARGB_8888);bmp.set(b);PixelCopy.request(activity.getWindow(),b,r->{result.set(r);done.countDown();},new Handler(android.os.Looper.getMainLooper()));});require(done.await(8,TimeUnit.SECONDS)&&result.get()!=null&&result.get()==PixelCopy.SUCCESS,"PIXEL_COPY_FAILED");try(FileOutputStream out=new FileOutputStream(new File(folder,variant+"-"+name+".png"))){bmp.get().compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}finally{if(bmp.get()!=null)bmp.get().recycle();}}
 @Override public void onStart(){JSONObject report=new JSONObject();boolean passed=false;HandlerThread meter=null;
  try{
   require(Build.VERSION.SDK_INT==36&&"ranchu".equals(Build.HARDWARE),"EMULATOR_ONLY");require(variant.matches("[a-z0-9-]{1,40}"),"BAD_VARIANT");
   folder=new File(getTargetContext().getExternalFilesDir(null),"scroll-profile");require(folder.isDirectory()||folder.mkdirs(),"REPORT_FOLDER_FAILED");
   Intent intent=new Intent().setClassName("cn.suike.timetable","cn.suike.timetable.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);activity=startActivitySync(intent);
   Field field=activity.getClass().getDeclaredField("webView");field.setAccessible(true);web=(WebView)field.get(activity);waitJs("!!(window.__suikeBoot&&__suikeBoot.ready&&window.SuikeFeatures)");
   eval("(function(){var s=SuikeFeatures.getState();function t(n){return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}s.periods=Array.from({length:12},(_,i)=>({start:t(360+i*40),end:t(390+i*40)}));s.courses=[];var today=new Date(Date.now()+28800000).toISOString().slice(0,10),day=TimetableModel.dayOf(today),base=new Date(today+'T00:00:00Z');for(var d=1;d<=7;d++){var date=new Date(+base+(d-day)*86400000).toISOString().slice(0,10);for(var p=1;p<=11;p+=2)s.courses.push({id:'qa-scroll-'+d+'-'+p,name:'课程示例 '+d+'-'+p,day:d,start:p,end:p+1,dates:[date],sourceTime:'',room:'教学楼 A101',teacher:'示例教师',color:'teal'});}s.importLedger=null;s.skipLegacyImportBaseline=true;s.productSettings=SuikeFeatures.settings();s.productSettings.setupCompleted=true;s.productSettings.reminders.enabled=false;SuikeFeatures.commitState(s,'synthetic scroll fixture');document.querySelector('[data-view=settings]').click();var c=document.createElement('canvas');c.width=720;c.height=1280;var x=c.getContext('2d'),g=x.createLinearGradient(0,0,720,1280);g.addColorStop(0,'#193b68');g.addColorStop(.5,'#87b3cb');g.addColorStop(1,'#233c24');x.fillStyle=g;x.fillRect(0,0,720,1280);for(var j=0;j<1280;j+=35){x.strokeStyle=j%70?'#c2af89':'#3e5d73';x.lineWidth=5;x.beginPath();x.moveTo(0,j);x.bezierCurveTo(180,j-120,400,j+120,720,j-10);x.stroke();}c.toBlob(function(blob){var data=new DataTransfer();data.items.add(new File([blob],'synthetic-wallpaper.png',{type:'image/png'}));var input=document.getElementById('wallpaperImage');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));},'image/png');})()");
   waitJs("document.documentElement.dataset.wallpaper==='on'&&SuikeAppearance.isEnabled()");SystemClock.sleep(3000);
   waitJs("!window.SuikeOpticsWorker||SuikeOpticsWorker.status.pending===0");
   meter=new HandlerThread("suike-frame-metrics");meter.start();final Handler handler=new Handler(meter.getLooper());
   for(String view:new String[]{"settings","week","today"})for(int frost:new int[]{0,70}){
    eval("document.querySelector('[data-view="+view+"]').click();SuikeAppearance.setFrost("+frost+",true);document.querySelectorAll('#settingsView details').forEach(d=>d.open=true);document.getElementById('toast').hidden=true;window.scrollTo(0,0)");SystemClock.sleep(1800);
    if(variant.contains("shared"))waitJs("!!window.SuikeGlassScene&&SuikeGlassScene.status.active&&SuikeGlassScene.status.failures===0");
    final List<Double> total=Collections.synchronizedList(new ArrayList<>()),gpu=Collections.synchronizedList(new ArrayList<>());
    Window.OnFrameMetricsAvailableListener listener=(window,metrics,dropped)->{long n=metrics.getMetric(FrameMetrics.TOTAL_DURATION);if(n>0)total.add(n/1000000.0);long g=metrics.getMetric(FrameMetrics.GPU_DURATION);if(g>0)gpu.add(g/1000000.0);};
    runOnMainSync(()->activity.getWindow().addOnFrameMetricsAvailableListener(listener,handler));
    eval("window.__qaScroll={done:false,samples:[]};(function(){var q=__qaScroll,start=performance.now(),last=start,max=Math.max(0,document.scrollingElement.scrollHeight-innerHeight);q.maxScroll=max;function tick(now){q.samples.push(now-last);last=now;var elapsed=now-start;window.scrollTo(0,max*(1-Math.cos(elapsed/1600*Math.PI))*.5);if(elapsed<6400)requestAnimationFrame(tick);else{q.done=true;q.elapsed=elapsed;}}requestAnimationFrame(tick);})()");
    waitJs("!!window.__qaScroll&&__qaScroll.done");runOnMainSync(()->activity.getWindow().removeOnFrameMetricsAvailableListener(listener));
    String data=(String)eval("JSON.stringify({raf:__qaScroll,scene:window.SuikeGlassScene?SuikeGlassScene.status:null,optics:window.SuikeLiquidUI?SuikeLiquidUI.optics:null,liveBackdropCount:Array.from(document.querySelectorAll('*')).filter(el=>{var r=el.getBoundingClientRect();return r.width&&r.height&&r.bottom>0&&r.top<innerHeight&&getComputedStyle(el).backdropFilter!=='none';}).length})");
    JSONObject run=new JSONObject(data);run.put("view",view);run.put("frost",frost);run.put("windowFrames",stats(total));run.put("gpuFrames",stats(gpu));runs.put(run);report.put("runs",runs);save(report);
    if(frost==0){eval("window.scrollTo(0,(document.scrollingElement.scrollHeight-innerHeight)*.38)");picture(view);}
   }
   eval("document.querySelector('[data-view=today]').click();window.scrollTo(0,0);document.querySelector('.agenda-card').click()");picture("course-dialog");
   if(variant.contains("shared")){
    eval("document.getElementById('courseDialog').close();document.querySelector('[data-view=settings]').click();var s=SuikeFeatures.getState();s.courses.filter(c=>c.start===9).forEach(c=>c.sourceTime='18:30-20:05');s.courses.push({id:'qa-minute',name:'团组织会议',day:s.courses[0].day,dates:s.courses[0].dates,start:null,end:null,timeMode:'clock',sourceTime:'06:40-06:50',room:'',teacher:'',color:'teal'});SuikeFeatures.commitState(s,'time authority fixture');document.querySelectorAll('.period-list button')[8].click();document.getElementById('periodStart').value='11:25';document.getElementById('periodEnd').value='11:55';document.getElementById('productConfirm').click()");
    waitJs("SuikeFeatures.getState().periods[8].start==='11:25'");
    require(Boolean.TRUE.equals(eval("(function(){var s=SuikeFeatures.getState(),c=s.courses.find(c=>c.start===9),event=s.courses.find(c=>c.id==='qa-minute');return TimetableModel.timeRange(c,s.periods).start==='11:25'&&SuikeWorkspaceEngine.actualTime(c,s.periods).start==='11:25'&&document.getElementById('weekGrid').textContent.includes('11:25')&&document.getElementById('agenda').textContent.includes('11:25')&&event.sourceTime==='06:40-06:50';})()")),"SETTINGS_TIME_SYNC_FAILED");
    eval("document.querySelector('[data-view=today]').click();window.scrollTo(0,0)");picture("time-sync");report.put("settingsTimeAuthorityVerified",true);
   }
   report.put("fixturePeriods",12);report.put("hardwareAccelerated",web.isHardwareAccelerated());report.put("webView",WebView.getCurrentWebViewPackage().versionName);report.put("emulatorRenderer","host GPU; emulator comparison, not phone FPS");passed=true;
  }catch(Throwable failure){try{report.put("failure",failure.getClass().getSimpleName()+":"+failure.getMessage());if(web!=null)report.put("runtime",new JSONObject((String)eval("JSON.stringify({boot:window.__suikeBoot,scene:window.SuikeGlassScene?SuikeGlassScene.status:null,appearance:document.documentElement.dataset.appearance,wallpaper:document.documentElement.dataset.wallpaper})")));}catch(Exception ignored){}}
  finally{if(meter!=null)meter.quitSafely();try{report.put("passed",passed);report.put("variant",variant);report.put("runs",runs);if(folder!=null)save(report);}catch(Exception ignored){}if(activity!=null)runOnMainSync(()->activity.finish());Bundle out=new Bundle();out.putString("qaScrollReport",report.toString());finish(passed?Activity.RESULT_OK:Activity.RESULT_CANCELED,out);}
 }
}
