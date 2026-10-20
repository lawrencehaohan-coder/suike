package cn.suike.timetable;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;

/** Independent 2x2 launcher entry; shares the same data, clock and in-app appearance controls. */
public final class CompactCourseWidgetProvider extends AppWidgetProvider {
    @Override public void onUpdate(Context c,AppWidgetManager m,int[] ids){CourseWidgetProvider.refresh(c);}
    @Override public void onEnabled(Context c){CourseWidgetProvider.refresh(c);}
    @Override public void onDisabled(Context c){CourseWidgetProvider.refresh(c);}
    @Override public void onAppWidgetOptionsChanged(Context c,AppWidgetManager m,int id,Bundle options){CourseWidgetProvider.refresh(c);}
}
