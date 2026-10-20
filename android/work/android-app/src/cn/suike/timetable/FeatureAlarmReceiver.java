package cn.suike.timetable;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Explicit, non-exported alarm target. Work is bounded and performs no network access. */
public final class FeatureAlarmReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (intent != null && FeatureScheduler.ALARM_ACTION.equals(intent.getAction()))
            FeatureScheduler.onAlarm(context);
    }
}
