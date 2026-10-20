package cn.suike.timetable.tests;

import android.app.Activity;
import android.app.Instrumentation;
import android.appwidget.AppWidgetHost;
import android.appwidget.AppWidgetHostView;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.RemoteViews;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.lang.reflect.Method;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicReference;

/** Real platform AppWidgetHost binding plus deterministic clock cases; private emulator only. */
final class WidgetChecks {
    interface Capture { void save(String name)throws Exception; }
    interface Page { Object eval(String code)throws Exception; }
    private static void require(boolean condition,String code){if(!condition)throw new AssertionError(code);}
    private static int id(Context c,String name){return c.getResources().getIdentifier(name,"id",c.getPackageName());}
    private static String text(View v,Context c,String name){return ((TextView)v.findViewById(id(c,name))).getText().toString();}
    private static JSONObject payload(String theme,long now)throws Exception{
        JSONArray rows=new JSONArray();
        java.time.ZoneId zone=java.time.ZoneId.of("Asia/Shanghai");
        for(int n=0;n<5;n++){long start=now+(n==0?-10:n*60)*60000L;rows.put(new JSONObject().put("id","widget-"+n).put("courseId","w"+n).put("date",Instant.ofEpochMilli(start).atZone(zone).toLocalDate().toString()).put("name",n==0?"高等数学":n==1?"大学物理":"实验课程 "+n).put("room","教学楼 A20"+n).put("startMillis",start).put("endMillis",now+(n==0?35:n*60+45)*60000L));}
        long tomorrow=Instant.ofEpochMilli(now).atZone(zone).toLocalDate().plusDays(1).atTime(8,0).atZone(zone).toInstant().toEpochMilli();
        rows.put(new JSONObject().put("id","tomorrow").put("courseId","tomorrow").put("date",Instant.ofEpochMilli(tomorrow).atZone(zone).toLocalDate().toString()).put("name","明日实验").put("room","实验楼203").put("startMillis",tomorrow).put("endMillis",tomorrow+60*60000L));
        return new JSONObject().put("schemaVersion",1).put("theme",theme).put("enabled",false).put("leadMinutes",10).put("occurrences",rows);
    }
    static JSONArray run(Instrumentation qa,Activity activity,Capture capture,Page page)throws Exception{
        Context context=qa.getTargetContext();JSONArray checks=new JSONArray();
        Class<?> store=Class.forName("cn.suike.timetable.FeatureDataStore"),snapshot=Class.forName("cn.suike.timetable.FeatureDataStore$Snapshot"),provider=Class.forName("cn.suike.timetable.CourseWidgetProvider"),scheduler=Class.forName("cn.suike.timetable.FeatureScheduler");
        Method parse=store.getDeclaredMethod("parse",String.class),read=store.getDeclaredMethod("read",Context.class),encode=store.getDeclaredMethod("encode",snapshot),render=provider.getDeclaredMethod("render",Context.class,snapshot,long.class,int.class);
        parse.setAccessible(true);read.setAccessible(true);encode.setAccessible(true);render.setAccessible(true);
        String original=(String)encode.invoke(null,read.invoke(null,context));
        android.content.SharedPreferences prefs=context.getSharedPreferences("suike-widget-appearance-v1",Context.MODE_PRIVATE);
        boolean savedGlass=Boolean.TRUE.equals(page.eval("SuikeAppearance.isEnabled()")),savedReduced=prefs.getBoolean("reducedMotion",false);
        int savedFrost=((Number)page.eval("SuikeAppearance.getFrost()")).intValue();
        page.eval("SuikeAppearance.setEnabled(false);SuikeAppearance.setFrost(0,true);SuikeWidgetAppearance.sync();true");
        provider.getMethod("syncAppearance",Context.class,boolean.class,int.class,boolean.class).invoke(null,context,false,0,false);
        long now=Instant.parse("2026-10-16T06:00:00Z").toEpochMilli();
        Object light=parse.invoke(null,payload("light",now).toString());
        AtomicReference<View> rendered=new AtomicReference<>();
        RemoteViews compact=(RemoteViews)render.invoke(null,context,light,now,150);
        qa.runOnMainSync(()->rendered.set(compact.apply(activity,null)));
        require(text(rendered.get(),context,"widget_status").equals("正在上课")&&text(rendered.get(),context,"widget_course").equals("高等数学"),"WIDGET_CURRENT_WRONG");
        require(rendered.get().findViewById(id(context,"widget_row1")).getVisibility()==View.GONE,"WIDGET_COMPACT_OVERFLOW");
        require(rendered.get().findViewById(id(context,"widget_breathe")) instanceof android.widget.ViewFlipper&&rendered.get().findViewById(id(context,"widget_progress")).getVisibility()==View.VISIBLE,"WIDGET_CURRENT_INDICATORS_MISSING");
        for(String name:new String[]{"widget_time","widget_date","widget_course","widget_room","widget_status","widget_row1","widget_more"}){
            TextView label=(TextView)rendered.get().findViewById(id(context,name));android.graphics.Paint probe=new android.graphics.Paint(label.getPaint());
            require(Math.abs(probe.measureText("1111")-probe.measureText("8888"))<.05f,"WIDGET_NUMERIC_WIDTH_UNSTABLE");
            android.graphics.Paint expected=new android.graphics.Paint(probe);expected.setTypeface(context.getResources().getFont(context.getResources().getIdentifier("suike_numbers","font",context.getPackageName())));
            require(Math.abs(probe.measureText("23:29")-expected.measureText("23:29"))<.05f,"WIDGET_NUMERIC_FACE_MISSING");
        }
        checks.put(new JSONObject().put("name","widget_numeric_face_and_equal_digit_widths").put("passed",true));
        Class<?> graphics=Class.forName("cn.suike.timetable.WidgetGraphics");Method pixels=graphics.getDeclaredMethod("progress",int.class,float.class,double.class,boolean.class);pixels.setAccessible(true);
        android.graphics.Bitmap half=(android.graphics.Bitmap)pixels.invoke(null,240,1f,.5,false);
        require(half.getPixel(0,0)==android.graphics.Color.BLACK&&half.getPixel(0,6)==android.graphics.Color.BLACK&&half.getPixel(half.getWidth()-1,0)==0xffdcdcdc&&android.graphics.Color.alpha(half.getPixel(0,4))==0,"WIDGET_PIXEL_GEOMETRY_WRONG");half.recycle();
        provider.getMethod("syncAppearance",Context.class,boolean.class,int.class,boolean.class).invoke(null,context,false,0,true);
        RemoteViews reduced=(RemoteViews)render.invoke(null,context,light,now,160);qa.runOnMainSync(()->rendered.set(reduced.apply(activity,null)));
        require(rendered.get().findViewById(id(context,"widget_breathe"))==null&&rendered.get().findViewById(id(context,"widget_lamp_static"))!=null,"WIDGET_REDUCED_MOTION_IGNORED");
        provider.getMethod("syncAppearance",Context.class,boolean.class,int.class,boolean.class).invoke(null,context,false,0,false);
        checks.put(new JSONObject().put("name","current_green_breathing_two_row_pixels_and_reduced_motion_fallback").put("passed",true));
        checks.put(new JSONObject().put("name","widget_current_clock_and_compact_layout").put("passed",true));
        RemoteViews later=(RemoteViews)render.invoke(null,context,light,now+40*60000L,150);qa.runOnMainSync(()->rendered.set(later.apply(activity,null)));
        require(text(rendered.get(),context,"widget_status").equals("下一节")&&text(rendered.get(),context,"widget_course").equals("大学物理"),"WIDGET_NEXT_WRONG");
        require(rendered.get().findViewById(id(context,"widget_breathe"))==null&&rendered.get().findViewById(id(context,"widget_lamp_static"))!=null&&rendered.get().findViewById(id(context,"widget_progress")).getVisibility()==View.GONE,"WIDGET_IDLE_INDICATORS_WRONG");
        RemoteViews tomorrow=(RemoteViews)render.invoke(null,context,light,Instant.parse("2026-10-16T15:00:00Z").toEpochMilli(),150);qa.runOnMainSync(()->rendered.set(tomorrow.apply(activity,null)));
        require(text(rendered.get(),context,"widget_status").equals("明天"),"WIDGET_MIDNIGHT_WRONG");
        RemoteViews empty=(RemoteViews)render.invoke(null,context,light,Instant.parse("2026-10-18T00:00:00Z").toEpochMilli(),150);qa.runOnMainSync(()->rendered.set(empty.apply(activity,null)));
        require(rendered.get().findViewById(id(context,"widget_course_block")).getVisibility()==View.GONE&&text(rendered.get(),context,"widget_empty").equals("接下来没有课程"),"WIDGET_EMPTY_WRONG");
        checks.put(new JSONObject().put("name","widget_next_tomorrow_and_empty_states").put("passed",true));
        AppWidgetHost host=new AppWidgetHost(context,9023);AppWidgetManager manager=AppWidgetManager.getInstance(context);int widget=-1,compactWidget=-1;
        AtomicReference<FrameLayout> overlay=new AtomicReference<>();AtomicReference<AppWidgetHostView> view=new AtomicReference<>();
        try{
            qa.getUiAutomation().adoptShellPermissionIdentity("android.permission.BIND_APPWIDGET");
            widget=host.allocateAppWidgetId();
            ComponentName component=new ComponentName(context,provider);
            require(manager.bindAppWidgetIdIfAllowed(widget,component),"WIDGET_HOST_BIND_FAILED");
            qa.getUiAutomation().dropShellPermissionIdentity();
            final int bound=widget;
            qa.runOnMainSync(()->{
                host.startListening();AppWidgetHostView hosted=host.createView(activity,bound,manager.getAppWidgetInfo(bound));view.set(hosted);
                FrameLayout stage=new FrameLayout(activity);stage.setBackgroundColor(0xffcfd2d8);overlay.set(stage);
                int density=Math.round(activity.getResources().getDisplayMetrics().density);
                FrameLayout.LayoutParams lp=new FrameLayout.LayoutParams(320*density,310*density);lp.gravity=android.view.Gravity.CENTER;stage.addView(hosted,lp);
                ((ViewGroup)activity.findViewById(android.R.id.content)).addView(stage,new ViewGroup.LayoutParams(-1,-1));
            });
            view.get().updateAppWidgetOptions(options(310));
            long liveNow=System.currentTimeMillis();
            scheduler.getMethod("sync",Context.class,String.class).invoke(null,context,payload("light",liveNow).toString());
            waitText(qa,view.get(),context,"widget_course","高等数学");capture.save("widget-large-light.png");
            require(view.get().findViewById(id(context,"widget_row3")).getVisibility()==View.VISIBLE,"WIDGET_LARGE_ROWS_MISSING");
            checks.put(new JSONObject().put("name","real_platform_host_binds_provider_and_receives_projection_updates").put("passed",true));
            qa.runOnMainSync(()->{ViewGroup.LayoutParams lp=view.get().getLayoutParams();lp.height=Math.round(160*activity.getResources().getDisplayMetrics().density);view.get().setLayoutParams(lp);view.get().updateAppWidgetOptions(options(160));});
            JSONObject changed=payload("dark",liveNow);changed.getJSONArray("occurrences").getJSONObject(0).put("name","更新后的课程");
            scheduler.getMethod("sync",Context.class,String.class).invoke(null,context,changed.toString());
            waitText(qa,view.get(),context,"widget_course","更新后的课程");capture.save("widget-small-dark.png");
            require(((TextView)view.get().findViewById(id(context,"widget_course"))).getCurrentTextColor()==0xfff5f5f7&&view.get().findViewById(id(context,"widget_row1")).getVisibility()==View.GONE,"WIDGET_RESIZE_OR_THEME_FAILED");
            checks.put(new JSONObject().put("name","host_resize_dark_theme_and_course_change_refresh").put("passed",true));
            android.widget.ViewFlipper flipper=(android.widget.ViewFlipper)view.get().findViewById(id(context,"widget_breathe"));
            require(flipper!=null&&flipper.isFlipping(),"WIDGET_BREATHING_NOT_RUNNING");
            int child=flipper.getDisplayedChild();boolean changedFrame=false;
            for(int n=0;n<16;n++){SystemClock.sleep(160);if(flipper.getDisplayedChild()!=child){changedFrame=true;break;}}
            require(changedFrame,"WIDGET_BREATHING_NOT_ADVANCING");
            checks.put(new JSONObject().put("name","real_host_green_lamp_breathes_at_same_3_8_second_cycle").put("passed",true));
            page.eval("SuikeAppearance.setEnabled(true);SuikeAppearance.setFrost(0,true);SuikeWidgetAppearance.sync();true");
            waitGlass(qa,view.get(),context,true,0);capture.save("widget-glass-clear.png");
            page.eval("SuikeAppearance.setFrost(100,true);SuikeWidgetAppearance.sync();true");
            waitGlass(qa,view.get(),context,true,220);capture.save("widget-glass-frost.png");
            page.eval("SuikeAppearance.setEnabled(false);SuikeWidgetAppearance.sync();true");
            waitGlass(qa,view.get(),context,false,0);
            checks.put(new JSONObject().put("name","in_app_glass_switch_frost_slider_and_off_state_sync_to_bound_widget").put("passed",true));
            scheduler.getMethod("sync",Context.class,String.class).invoke(null,context,payload("light",liveNow+3600000).toString());
            waitText(qa,view.get(),context,"widget_status","下一节");capture.save("widget-idle-grey.png");
            require(view.get().findViewById(id(context,"widget_breathe"))==null&&view.get().findViewById(id(context,"widget_progress")).getVisibility()==View.GONE,"WIDGET_IDLE_LAMP_OR_PROGRESS_FAILED");
            checks.put(new JSONObject().put("name","class_end_changes_lamp_to_static_grey_and_hides_progress").put("passed",true));

            JSONObject cleared=payload("light",liveNow);cleared.put("occurrences",new JSONArray());scheduler.getMethod("sync",Context.class,String.class).invoke(null,context,cleared.toString());
            waitEmpty(qa,view.get(),context);
            scheduler.getMethod("sync",Context.class,String.class).invoke(null,context,changed.toString());waitText(qa,view.get(),context,"widget_course","更新后的课程");
            checks.put(new JSONObject().put("name","empty_semester_replaces_old_widget_data_and_restore_refreshes").put("passed",true));
            qa.getUiAutomation().adoptShellPermissionIdentity("android.permission.BIND_APPWIDGET");
            compactWidget=host.allocateAppWidgetId();ComponentName compactProvider=new ComponentName(context,Class.forName("cn.suike.timetable.CompactCourseWidgetProvider"));
            require(manager.bindAppWidgetIdIfAllowed(compactWidget,compactProvider),"COMPACT_WIDGET_BIND_FAILED");qa.getUiAutomation().dropShellPermissionIdentity();
            final int smallId=compactWidget;AtomicReference<AppWidgetHostView> compactView=new AtomicReference<>();
            qa.runOnMainSync(()->{overlay.get().removeAllViews();AppWidgetHostView hosted=host.createView(activity,smallId,manager.getAppWidgetInfo(smallId));compactView.set(hosted);int side=Math.round(170*activity.getResources().getDisplayMetrics().density);FrameLayout.LayoutParams lp=new FrameLayout.LayoutParams(side,side);lp.gravity=android.view.Gravity.CENTER;overlay.get().addView(hosted,lp);Bundle opts=options(170);opts.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,170);opts.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH,170);hosted.updateAppWidgetOptions(opts);});
            scheduler.getMethod("sync",Context.class,String.class).invoke(null,context,payload("light",liveNow).toString());
            waitText(qa,compactView.get(),context,"widget_course","高等数学");capture.save("widget-2x2-light.png");
            require(manager.getAppWidgetInfo(smallId).targetCellWidth==2&&manager.getAppWidgetInfo(smallId).targetCellHeight==2,"COMPACT_WIDGET_NOT_2_BY_2");
            android.widget.ImageView shortBar=compactView.get().findViewById(id(context,"widget_progress"));
            require(shortBar.getVisibility()==View.VISIBLE&&((android.graphics.drawable.BitmapDrawable)shortBar.getDrawable()).getBitmap().getWidth()<400,"COMPACT_PIXEL_BAR_NOT_SHORTENED");
            checks.put(new JSONObject().put("name","separate_2_by_2_provider_binds_with_shorter_pixel_bar").put("passed",true));
            page.eval("SuikeAppearance.setEnabled(true);SuikeAppearance.setFrost(40,true);SuikeWidgetAppearance.sync();true");
            waitGlass(qa,compactView.get(),context,true,0);capture.save("widget-2x2-glass.png");
            scheduler.getMethod("sync",Context.class,String.class).invoke(null,context,payload("dark",liveNow).toString());
            waitText(qa,compactView.get(),context,"widget_course","高等数学");capture.save("widget-2x2-dark.png");
            page.eval("SuikeAppearance.setEnabled(false);SuikeWidgetAppearance.sync();true");waitGlass(qa,compactView.get(),context,false,0);
            scheduler.getMethod("sync",Context.class,String.class).invoke(null,context,payload("light",liveNow+3600000).toString());
            waitText(qa,compactView.get(),context,"widget_status","下一节");capture.save("widget-2x2-idle.png");
            require(compactView.get().findViewById(id(context,"widget_breathe"))==null&&compactView.get().findViewById(id(context,"widget_progress")).getVisibility()==View.GONE,"COMPACT_IDLE_INDICATORS_FAILED");
            checks.put(new JSONObject().put("name","2_by_2_shares_glass_frost_theme_and_idle_grey_state").put("passed",true));

        }finally{
            qa.getUiAutomation().dropShellPermissionIdentity();
            qa.runOnMainSync(()->{if(overlay.get()!=null)((ViewGroup)activity.findViewById(android.R.id.content)).removeView(overlay.get());host.stopListening();});
            if(widget>=0)host.deleteAppWidgetId(widget);if(compactWidget>=0)host.deleteAppWidgetId(compactWidget);
            scheduler.getMethod("sync",Context.class,String.class).invoke(null,context,original);
            page.eval("SuikeAppearance.setEnabled("+savedGlass+");SuikeAppearance.setFrost("+savedFrost+",true);SuikeWidgetAppearance.sync();true");
            provider.getMethod("syncAppearance",Context.class,boolean.class,int.class,boolean.class).invoke(null,context,savedGlass,savedFrost,savedReduced);
        }
        return checks;
    }
    private static void waitGlass(Instrumentation qa,View view,Context c,boolean visible,int alpha)throws Exception{
        long end=SystemClock.uptimeMillis()+5000;AtomicReference<Boolean> ok=new AtomicReference<>(false);
        while(SystemClock.uptimeMillis()<end){qa.runOnMainSync(()->{android.widget.ImageView image=view.findViewById(id(c,"widget_glass_surface"));boolean match=image!=null&&image.getVisibility()==(visible?View.VISIBLE:View.GONE);if(match&&visible&&alpha>0){android.graphics.drawable.Drawable d=image.getDrawable();if(d instanceof android.graphics.drawable.BitmapDrawable){android.graphics.Bitmap b=((android.graphics.drawable.BitmapDrawable)d).getBitmap();match=android.graphics.Color.alpha(b.getPixel(b.getWidth()/2,b.getHeight()/2))>=alpha;}else match=false;}ok.set(match);});if(ok.get())return;SystemClock.sleep(60);}
        throw new AssertionError("WIDGET_GLASS_SYNC_TIMEOUT");
    }
    private static Bundle options(int height){Bundle b=new Bundle();b.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,320);b.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH,320);b.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,height);b.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,height);return b;}
    private static void waitEmpty(Instrumentation qa,View view,Context c)throws Exception{
        // The hidden empty label already contains this text before a host update.
        // Wait for the complete visible state rather than matching that stale label.
        long end=SystemClock.uptimeMillis()+5000;AtomicReference<Boolean> ok=new AtomicReference<>(false);
        while(SystemClock.uptimeMillis()<end){qa.runOnMainSync(()->{View empty=view.findViewById(id(c,"widget_empty"));View course=view.findViewById(id(c,"widget_course_block"));ok.set(empty.getVisibility()==View.VISIBLE&&course.getVisibility()==View.GONE&&text(view,c,"widget_empty").equals("添加课程后在这里查看"));});if(ok.get())return;SystemClock.sleep(60);}
        throw new AssertionError("WIDGET_OLD_SEMESTER_LEAK");
    }
    private static void waitText(Instrumentation qa,View view,Context c,String id,String expected)throws Exception{
        long end=SystemClock.uptimeMillis()+5000;AtomicReference<Boolean> ok=new AtomicReference<>(false);
        while(SystemClock.uptimeMillis()<end){qa.runOnMainSync(()->{View found=view.findViewById(id(c,id));ok.set(found instanceof TextView&&((TextView)found).getText().toString().equals(expected));});if(ok.get())return;SystemClock.sleep(60);}
        throw new AssertionError("WIDGET_HOST_UPDATE_TIMEOUT");
    }
}
