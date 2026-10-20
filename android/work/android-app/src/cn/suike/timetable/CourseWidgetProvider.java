package cn.suike.timetable;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.widget.RemoteViews;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Offline widget reads the same validated projection as local reminders. No network or key access. */
public final class CourseWidgetProvider extends AppWidgetProvider {
    static final String REFRESH = "cn.suike.timetable.WIDGET_REFRESH";
    private static final DateTimeFormatter CLOCK = DateTimeFormatter.ofPattern("HH:mm");
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("M月d日");
    private static final String[] DAYS = {"一","二","三","四","五","六","日"};
    private static int res(Context c,String type,String name){return c.getResources().getIdentifier(name,type,c.getPackageName());}
    private static int id(Context c,String name){return res(c,"id",name);}
    private static SharedPreferences appearance(Context c){return c.getSharedPreferences("suike-widget-appearance-v1",Context.MODE_PRIVATE);}
    public static boolean syncAppearance(Context c,boolean glass,int frost,boolean reduced){
        if(frost<0||frost>100)return false;
        boolean saved=appearance(c).edit().putBoolean("glass",glass).putInt("frost",frost).putBoolean("reducedMotion",reduced).commit();
        if(saved)refresh(c);return saved;
    }

    @Override public void onUpdate(Context c,AppWidgetManager m,int[] ids){refresh(c);}
    @Override public void onEnabled(Context c){refresh(c);}
    @Override public void onAppWidgetOptionsChanged(Context c,AppWidgetManager m,int widgetId,Bundle options){refresh(c);}
    @Override public void onDisabled(Context c){refresh(c);}
    @Override public void onReceive(Context c,Intent intent){
        super.onReceive(c,intent);
        if(intent!=null&&(REFRESH.equals(intent.getAction())||Intent.ACTION_CONFIGURATION_CHANGED.equals(intent.getAction())))refresh(c);
    }
    public static void refresh(Context c){
        FeatureScheduler.refresh(c);
    }
    static void updateAll(Context c,FeatureDataStore.Snapshot snapshot){
        AppWidgetManager manager=AppWidgetManager.getInstance(c);
        List<Integer> ids=new ArrayList<>();
        for(Class<?> provider:new Class<?>[]{CourseWidgetProvider.class,CompactCourseWidgetProvider.class})for(int value:manager.getAppWidgetIds(new ComponentName(c,provider)))ids.add(value);
        if(ids.isEmpty()){cancel(c);return;}
        long now=System.currentTimeMillis();
        for(int widget:ids){
            Bundle options=manager.getAppWidgetOptions(widget);
            int height=options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,160),width=options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,320);
            boolean compact=manager.getAppWidgetInfo(widget)!=null&&manager.getAppWidgetInfo(widget).provider.getClassName().endsWith("CompactCourseWidgetProvider");
            manager.updateAppWidget(widget,render(c,snapshot,now,height,width,compact));
        }
        schedule(c,snapshot,now);
    }
    // Separate clock parameter makes current/next/empty/overnight states reproducible in QA.
    static RemoteViews render(Context c,FeatureDataStore.Snapshot snapshot,long now,int height){
        return render(c,snapshot,now,height,320);
    }
    static RemoteViews render(Context c,FeatureDataStore.Snapshot snapshot,long now,int height,int width){
        return render(c,snapshot,now,height,width,width<210);
    }
    private static RemoteViews render(Context c,FeatureDataStore.Snapshot snapshot,long now,int height,int width,boolean compact){
        boolean large=height>=190;
        RemoteViews view=new RemoteViews(c.getPackageName(),res(c,"layout",compact?"course_widget_compact":"course_widget"));
        boolean systemDark=(c.getResources().getConfiguration().uiMode&Configuration.UI_MODE_NIGHT_MASK)==Configuration.UI_MODE_NIGHT_YES;
        boolean dark="dark".equals(snapshot.theme)||"auto".equals(snapshot.theme)&&systemDark;
        int ink=dark?0xfff5f5f7:0xff18181a,muted=dark?0xffbdbdc4:0xff54545a;
        SharedPreferences prefs=appearance(c);boolean glass=prefs.getBoolean("glass",false);int frost=prefs.getInt("frost",0);
        boolean samsung=Build.VERSION.SDK_INT>=31&&"samsung".equals(Build.MANUFACTURER.toLowerCase(Locale.ROOT));
        view.setInt(android.R.id.background,"setBackgroundResource",res(c,"drawable",glass?"widget_clear":dark?"widget_dark":"widget_light"));
        view.setViewVisibility(id(c,"widget_glass_surface"),glass?View.VISIBLE:View.GONE);
        if(glass){
            if(samsung){int alpha=Math.round(255*(.55f+.37f*frost/100f));view.setInt(android.R.id.background,"setBackgroundColor",android.graphics.Color.argb(alpha,dark?30:255,dark?30:255,dark?30:255));}
            view.setImageViewBitmap(id(c,"widget_glass_surface"),WidgetGraphics.glass(width,height,c.getResources().getDisplayMetrics().density,dark,frost,samsung));
        }
        for(String name:new String[]{"widget_title","widget_course","widget_room","widget_time","widget_status","widget_date","widget_more","widget_row1","widget_row2","widget_row3"})
            view.setTextColor(id(c,name),name.equals("widget_course")||name.startsWith("widget_row")?ink:muted);
        LocalDate today=Instant.ofEpochMilli(now).atZone(FeatureRules.ZONE).toLocalDate();
        view.setTextViewText(id(c,"widget_date"),DATE.format(today)+" · 周"+DAYS[today.getDayOfWeek().getValue()-1]);
        List<FeatureDataStore.Occurrence> upcoming=new ArrayList<>();
        for(FeatureDataStore.Occurrence item:snapshot.occurrences)if(item.endMillis>now)upcoming.add(item);
        FeatureDataStore.Occurrence next=upcoming.isEmpty()?null:upcoming.get(0);
        boolean active=next!=null&&next.startMillis<=now;
        boolean reduced=prefs.getBoolean("reducedMotion",false)||Settings.Global.getFloat(c.getContentResolver(),Settings.Global.ANIMATOR_DURATION_SCALE,1f)==0;
        view.removeAllViews(id(c,"widget_lamp"));
        RemoteViews lamp=new RemoteViews(c.getPackageName(),res(c,"layout",active&&!reduced?"widget_lamp_active":"widget_lamp_static"));
        if(active&&reduced)lamp.setImageViewResource(id(c,"widget_lamp_static"),res(c,"drawable","widget_lamp_green"));
        view.addView(id(c,"widget_lamp"),lamp);
        view.setViewVisibility(id(c,"widget_progress"),active?View.VISIBLE:View.GONE);
        if(active){double ratio=(now-next.startMillis)/(double)(next.endMillis-next.startMillis);
            view.setImageViewBitmap(id(c,"widget_progress"),WidgetGraphics.progress(Math.max(60,width-(compact?24:28)),c.getResources().getDisplayMetrics().density,ratio,dark));
            view.setContentDescription(id(c,"widget_progress"),"本节课程已进行 "+Math.round(ratio*100)+"%");}
        view.setViewVisibility(id(c,"widget_course_block"),next==null?View.GONE:View.VISIBLE);
        view.setViewVisibility(id(c,"widget_empty"),next==null?View.VISIBLE:View.GONE);
        view.setTextColor(id(c,"widget_empty"),ink);
        if(next==null){
            view.setTextViewText(id(c,"widget_status"),"TODAY");
            view.setTextViewText(id(c,"widget_empty"),snapshot.occurrences.isEmpty()?"添加课程后在这里查看":"接下来没有课程");
        }else{
            LocalDate date=Instant.ofEpochMilli(next.startMillis).atZone(FeatureRules.ZONE).toLocalDate();
            String prefix=next.startMillis<=now?"正在上课":date.equals(today)?"下一节":date.equals(today.plusDays(1))?"明天":DATE.format(date)+" · 周"+DAYS[date.getDayOfWeek().getValue()-1];
            if(compact&&!active&&!date.equals(today)&&!date.equals(today.plusDays(1)))prefix=date.getMonthValue()+"/"+date.getDayOfMonth();
            view.setTextViewText(id(c,"widget_status"),prefix);
            view.setTextViewText(id(c,"widget_course"),next.name);
            view.setTextViewText(id(c,"widget_time"),clock(next.startMillis)+(compact?"–":" — ")+clock(next.endMillis));
            view.setTextViewText(id(c,"widget_room"),next.room.isEmpty()?"教室未填写":next.room);
        }
        float scale=Math.max(1f,c.getResources().getConfiguration().fontScale);
        int capacity=compact?0:Math.max(0,Math.min(3,(height-16-Math.round((active?148:130)*scale)-Math.round(24*scale))/Math.round(38*scale)));
        if(compact)view.setInt(id(c,"widget_course"),"setMaxLines",height<160*scale?1:2);
        int remaining=Math.max(0,upcoming.size()-1),shown=Math.min(capacity,remaining);
        for(int i=1;i<=3;i++){
            int row=id(c,"widget_row"+i);view.setViewVisibility(row,i<=shown?View.VISIBLE:View.GONE);
            if(i<=shown){FeatureDataStore.Occurrence item=upcoming.get(i);LocalDate date=Instant.ofEpochMilli(item.startMillis).atZone(FeatureRules.ZONE).toLocalDate();String day=date.equals(today)?"":date.equals(today.plusDays(1))?"明天 ":DATE.format(date)+" ";view.setTextViewText(row,day+clock(item.startMillis)+"  "+item.name+(item.room.isEmpty()?"":" · "+item.room));}
        }
        view.setViewVisibility(id(c,"widget_more"),!compact&&large&&remaining>shown?View.VISIBLE:View.GONE);
        view.setTextViewText(id(c,"widget_more"),"还有 "+Math.max(0,remaining-shown)+" 次课程");
        Intent open=new Intent(c,MainActivity.class).putExtra("suike.widget.today",true).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent launch=PendingIntent.getActivity(c,4301,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        view.setOnClickPendingIntent(android.R.id.background,launch);
        view.setContentDescription(android.R.id.background,next==null?"随课，接下来没有课程，点击打开":next.name+"，"+clock(next.startMillis)+"，"+next.room+"，点击打开随课");
        return view;
    }
    private static String clock(long millis){return CLOCK.format(Instant.ofEpochMilli(millis).atZone(FeatureRules.ZONE));}
    private static PendingIntent alarm(Context c){return PendingIntent.getBroadcast(c,4302,new Intent(c,CourseWidgetProvider.class).setAction(REFRESH),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    private static void cancel(Context c){AlarmManager manager=(AlarmManager)c.getSystemService(Context.ALARM_SERVICE);if(manager!=null)manager.cancel(alarm(c));}
    private static void schedule(Context c,FeatureDataStore.Snapshot snapshot,long now){
        cancel(c);
        long boundary=Instant.ofEpochMilli(now).atZone(FeatureRules.ZONE).toLocalDate().plusDays(1).atStartOfDay(FeatureRules.ZONE).toInstant().toEpochMilli();
        for(FeatureDataStore.Occurrence item:snapshot.occurrences){if(item.startMillis>now)boundary=Math.min(boundary,item.startMillis);if(item.endMillis>now)boundary=Math.min(boundary,item.endMillis);if(item.startMillis<=now&&item.endMillis>now)boundary=Math.min(boundary,(now/60000+1)*60000);}
        AlarmManager manager=(AlarmManager)c.getSystemService(Context.ALARM_SERVICE);
        // Inexact and non-wakeup: progress updates do not wake a sleeping phone.
        if(manager!=null)manager.set(AlarmManager.RTC,boundary+250,alarm(c));
    }
}
