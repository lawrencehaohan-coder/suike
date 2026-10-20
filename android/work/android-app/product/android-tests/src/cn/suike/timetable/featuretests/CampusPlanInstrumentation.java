package cn.suike.timetable.featuretests;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.view.PixelCopy;
import android.webkit.WebView;
import android.webkit.WebChromeClient;
import android.webkit.ConsoleMessage;
import java.io.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.json.*;

/** Dedicated emulator only: standalone map preview, not beta27 app integration. */
public final class CampusPlanInstrumentation extends Instrumentation {
 private Activity activity;private WebView web;private File folder;
 private final JSONObject checks=new JSONObject();private final JSONArray errors=new JSONArray();
 @Override public void onCreate(Bundle args){super.onCreate(args);start();}
 private void require(boolean ok,String reason){if(!ok)throw new AssertionError(reason);}
 private Object eval(String js)throws Exception{CountDownLatch done=new CountDownLatch(1);AtomicReference<Object> out=new AtomicReference<>();runOnMainSync(()->web.evaluateJavascript(js,s->{try{out.set(new JSONTokener(s).nextValue());}catch(Exception ignored){}done.countDown();}));require(done.await(25,TimeUnit.SECONDS),"JS_TIMEOUT");return out.get();}
 private void waitJs(String js)throws Exception{long end=SystemClock.elapsedRealtime()+45000;do{if(Boolean.TRUE.equals(eval(js)))return;SystemClock.sleep(100);}while(SystemClock.elapsedRealtime()<end);throw new AssertionError("JS_CONDITION_TIMEOUT:"+js);}
 private void check(String js,String name)throws Exception{require(Boolean.TRUE.equals(eval(js)),name);checks.put(name,true);}
 private void save(String name,byte[] bytes)throws Exception{try(FileOutputStream out=new FileOutputStream(new File(folder,name))){out.write(bytes);}}
 private void picture(String name)throws Exception{SystemClock.sleep(250);CountDownLatch done=new CountDownLatch(1);AtomicReference<Bitmap> bmp=new AtomicReference<>();AtomicReference<Integer> result=new AtomicReference<>();runOnMainSync(()->{android.view.View v=activity.getWindow().getDecorView();Bitmap b=Bitmap.createBitmap(v.getWidth(),v.getHeight(),Bitmap.Config.ARGB_8888);bmp.set(b);PixelCopy.request(activity.getWindow(),b,r->{result.set(r);done.countDown();},new Handler(Looper.getMainLooper()));});require(done.await(8,TimeUnit.SECONDS)&&Integer.valueOf(PixelCopy.SUCCESS).equals(result.get()),"PIXEL_COPY_FAILED");try(FileOutputStream out=new FileOutputStream(new File(folder,name+".png"))){bmp.get().compress(Bitmap.CompressFormat.PNG,100,out);}finally{if(bmp.get()!=null)bmp.get().recycle();}}
 private void exported(String name)throws Exception{String data=(String)eval("CampusPreview.renderer.exportPng(1920,1080).split(',')[1]");save(name+".png",Base64.decode(data,Base64.DEFAULT));}
 private void canvas(String name)throws Exception{String data=(String)eval("document.getElementById('scene').toDataURL('image/png').split(',')[1]");save(name+".png",Base64.decode(data,Base64.DEFAULT));}
 @Override public void onStart(){JSONObject report=new JSONObject();boolean passed=false;try{
  require(Build.VERSION.SDK_INT==36&&"ranchu".equals(Build.HARDWARE),"DEDICATED_EMULATOR_ONLY");folder=new File(getTargetContext().getExternalFilesDir(null),"campus-layout-profile");require(folder.isDirectory()||folder.mkdirs(),"REPORT_FOLDER");
  ByteArrayOutputStream html=new ByteArrayOutputStream();try(InputStream in=getContext().getAssets().open("campus-preview.html")){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)html.write(b,0,n);}String source=html.toString("UTF-8");
  activity=startActivitySync(new Intent().setClassName("cn.suike.timetable","cn.suike.timetable.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  runOnMainSync(()->{web=new WebView(activity);web.getSettings().setJavaScriptEnabled(true);web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);web.setWebChromeClient(new WebChromeClient(){@Override public boolean onConsoleMessage(ConsoleMessage m){if(m.messageLevel()==ConsoleMessage.MessageLevel.ERROR)synchronized(errors){errors.put(m.message());}return true;}});activity.setContentView(web);web.loadDataWithBaseURL("https://campus-preview.local/",source,"text/html","UTF-8",null);});
  waitJs("!!window.CampusPreview&&CampusPreview.renderer.stats.draws>0");
  check("CampusPreview.scene.buildings.length===46&&Math.abs(CampusPreview.scene.overview.elev-35.264389682754654)<1e-6&&CampusPreview.scene.overview.yaw===45","isometric_overview_46_buildings");
  check("CampusPreview.scene.buildings.find(b=>b.id==='library').shape.type==='ellipse'","regular_ellipse_loaded");
  check("CampusPreview.renderer.stats.visibleParts['roof-rack']>0","roof_racks_not_culled");picture("overview-window");canvas("overview-map");
  eval("CampusPreview.select('library');CampusPreview.renderer.focus({building:CampusPreview.scene.buildings.find(b=>b.id==='library')},true)");waitJs("!CampusPreview.renderer.stats.running&&CampusPreview.renderer.stats.camera.zoom>1");
  check("CampusPreview.renderer.stats.camera.elev===90","top_down_camera_stays_90_degrees");
  check("(function(){var s=document.getElementById('stage').getBoundingClientRect(),p=document.getElementById('lamp');return Math.abs(parseFloat(p.style.left)-s.width/2)<2&&Math.abs(parseFloat(p.style.top)-s.height/2)<2;})()","library_focus_centered");
  picture("library-window");canvas("library-map");
  eval("document.getElementById('status').value='current';document.getElementById('status').dispatchEvent(new Event('change'))");
  check("getComputedStyle(document.getElementById('lamp')).animationName==='breathe'","current_green_breathing");
  eval("document.getElementById('status').value='done';document.getElementById('status').dispatchEvent(new Event('change'))");
  check("getComputedStyle(document.getElementById('lamp')).animationName==='none'&&getComputedStyle(document.getElementById('lamp')).backgroundColor==='rgb(156, 156, 151)'","completed_gray_not_breathing");
  eval("document.getElementById('status').value='upcoming';document.getElementById('status').dispatchEvent(new Event('change'))");
  check("getComputedStyle(document.getElementById('lamp')).animationName==='none'&&getComputedStyle(document.getElementById('lamp')).backgroundColor==='rgb(29, 158, 117)'","future_steady_green");
  eval("window.__settledDraws=CampusPreview.renderer.stats.draws");SystemClock.sleep(400);
  check("CampusPreview.renderer.stats.draws===__settledDraws","no_continuous_canvas_render_after_settle");
  eval("CampusPreview.mode(true)");check("document.querySelectorAll('#flatPlan .plan-building').length===46&&getComputedStyle(document.getElementById('flatPlan')).display!=='none'&&document.getElementById('flatPlan').getBoundingClientRect().width>100&&!CampusPreview.renderer.stats.active","labeled_plan_46_buildings_canvas_paused");picture("labeled-plan-window");
  eval("CampusPreview.mode(false);CampusPreview.select('plan-teaching-H',false)");picture("teaching-H-window");canvas("teaching-H-map");
  eval("CampusPreview.select('osm-260623895',false);CampusPreview.renderer.overview(false)");picture("gym-isometric-window");canvas("gym-isometric-map");
  check("CampusPreview.scene.buildings.find(b=>b.id==='osm-260623895').details.type==='wrapped-shell-gym'&&CampusPreview.scene.buildings.find(b=>b.id==='osm-260623023').details.type==='open-roof-frame'&&CampusPreview.renderer.stats.faceCount>1000","key_building_forms_present");
  eval("CampusPreview.select('library',false)");picture("library-isometric-window");canvas("library-isometric-map");
  eval("CampusPreview.select('osm-260623895',false)");picture("gym-closeup-window");canvas("gym-closeup-map");eval("CampusPreview.renderer.entrance({building:CampusPreview.scene.buildings.find(b=>b.id==='osm-260623895')},false)");picture("gym-front-window");canvas("gym-front-map");eval("CampusPreview.palette('dark')");picture("gym-dark-window");canvas("gym-dark-map");eval("CampusPreview.palette('light')");
  eval("CampusPreview.select('osm-260623023',false)");picture("administration-closeup-window");canvas("administration-closeup-map");
  eval("CampusPreview.palette('dark');CampusPreview.select('',false)");
  check("document.documentElement.dataset.theme==='dark'&&getComputedStyle(document.body).backgroundColor==='rgb(19, 19, 18)'&&getComputedStyle(document.body).color==='rgb(237, 237, 232)'&&!CampusPreview.renderer.stats.running","dark_theme_matches_app_and_no_continuous_render");picture("overview-dark-window");canvas("overview-dark-map");exported("overview-dark-1920x1080");
  eval("CampusPreview.select('library',false)");picture("library-dark-window");canvas("library-dark-map");
  eval("CampusPreview.palette('light');CampusPreview.select('',false)");
  check("getComputedStyle(document.body).backgroundColor==='rgb(245, 245, 244)'&&getComputedStyle(document.body).color==='rgb(27, 27, 26)'","light_theme_matches_app");exported("overview-light-1920x1080");
  require(errors.length()==0,"JS_CONSOLE_ERRORS");checks.put("no_javascript_errors",true);
  report.put("renderer",new JSONObject((String)eval("JSON.stringify(CampusPreview.renderer.stats)")));report.put("webView",WebView.getCurrentWebViewPackage().versionName);report.put("method","Standalone HTML in isolated Android WebView on dedicated API36 emulator, using beta26 only as host; beta27 timetable integration not built");passed=true;
 }catch(Throwable e){try{report.put("failure",e.getClass().getSimpleName()+":"+e.getMessage());if(web!=null)picture("failure");}catch(Exception ignored){}}
 finally{try{report.put("passed",passed);report.put("checks",checks);report.put("consoleErrors",errors);if(folder!=null)save("campus-layout-review-report.json",report.toString(2).getBytes("UTF-8"));}catch(Exception ignored){}if(activity!=null)runOnMainSync(()->activity.finish());Bundle result=new Bundle();result.putString("campusLayoutReport",report.toString());finish(passed?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);}}
}
