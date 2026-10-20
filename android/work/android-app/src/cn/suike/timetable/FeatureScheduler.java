package cn.suike.timetable;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.service.notification.StatusBarNotification;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.HashSet;
import java.util.Set;

/** Local-only inexact reminder coordinator. All bridge results are fixed-field JSON. */
public final class FeatureScheduler {
    public static final String CHANNEL_ID = "suike_courses_v1";
    static final String ALARM_ACTION = "cn.suike.timetable.FEATURE_ALARM";
    private static final Object LOCK = new Object();
    private static final String PREFS = "native-feature-state-v1";
    private static final long WINDOW_MILLIS = 10 * 60000L;
    private static final DateTimeFormatter CLOCK = DateTimeFormatter.ofPattern("HH:mm");

    private FeatureScheduler() { }

    /** Replace the complete projection, including on semester switches or timetable deletion. */
    public static String sync(Context context, String payload) {
        Context app = context.getApplicationContext();
        synchronized (LOCK) {
            try {
                FeatureDataStore.Snapshot snapshot = FeatureDataStore.parse(payload);
                FeatureDataStore.write(app, snapshot);
                pruneDelivered(app, snapshot, System.currentTimeMillis());
                cancelStaleNotifications(app, snapshot);
                updateAndSchedule(app, snapshot);
                return result(app, snapshot, "none");
            } catch (FeatureDataStore.Invalid error) { return errorResult(error.code); }
            catch (IOException error) { return errorResult("storage_failed"); }
            catch (RuntimeException error) { return errorResult("feature_unavailable"); }
        }
    }

    /** Change global opt-in without changing the local projection. Does not request permissions. */
    public static String setEnabled(Context context, boolean enabled) {
        Context app = context.getApplicationContext();
        synchronized (LOCK) {
            try {
                FeatureDataStore.Snapshot snapshot = FeatureDataStore.read(app).withEnabled(enabled);
                FeatureDataStore.write(app, snapshot);
                cancelStaleNotifications(app, snapshot);
                updateAndSchedule(app, snapshot);
                return result(app, snapshot, "none");
            } catch (IOException | FeatureDataStore.Invalid error) { return errorResult("storage_failed"); }
            catch (RuntimeException error) { return errorResult("feature_unavailable"); }
        }
    }

    /** Call on app resume and after the result of a user-initiated notification permission request. */
    public static void refresh(Context context) {
        Context app = context.getApplicationContext();
        synchronized (LOCK) {
            try { updateAndSchedule(app, FeatureDataStore.read(app)); }
            catch (IOException | FeatureDataStore.Invalid | RuntimeException error) {
                cancelAlarm(app);
            }
        }
    }

    /** No labels, room names, identifiers, exception messages or credentials are returned. */
    public static String status(Context context) {
        Context app = context.getApplicationContext();
        synchronized (LOCK) {
            try { return result(app, FeatureDataStore.read(app), "none"); }
            catch (IOException | FeatureDataStore.Invalid error) { return errorResult("storage_failed"); }
            catch (RuntimeException error) { return errorResult("feature_unavailable"); }
        }
    }

    static void onAlarm(Context context) {
        Context app = context.getApplicationContext();
        synchronized (LOCK) {
            try {
                FeatureDataStore.Snapshot snapshot = FeatureDataStore.read(app);
                ensureChannel(app);
                if (allowed(app)) deliverDue(app, snapshot, System.currentTimeMillis());
                updateAndSchedule(app, snapshot);
            } catch (IOException | FeatureDataStore.Invalid | RuntimeException error) { cancelAlarm(app); }
        }
    }

    private static void updateAndSchedule(Context context, FeatureDataStore.Snapshot snapshot) {
        try { CourseWidgetProvider.updateAll(context,snapshot); } catch (RuntimeException ignored) { }
        ensureChannel(context);
        cancelAlarm(context);
        long now = System.currentTimeMillis();
        long next = Long.MAX_VALUE;
        Set<String> delivered = delivered(context);
        if (snapshot.enabled && allowed(context)) {
            for (FeatureDataStore.Occurrence item : snapshot.occurrences) {
                int lead = snapshot.leadFor(item);
                if (!snapshot.shouldRemind(item) || deliveryDeadline(item, lead) <= now || delivered.contains(item.deliveryKey())) continue;
                long reminder = FeatureRules.reminderTime(item.startMillis, lead);
                // Catch up a pending reminder after reboot/app resume within its delivery deadline.
                next = Math.min(next, Math.max(now + 1000L, reminder));
            }
        }
        if (next != Long.MAX_VALUE) {
            AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarms != null) {
                // Android may defer this window further in Doze/battery saving. No exact-alarm permission is used.
                alarms.setWindow(AlarmManager.RTC_WAKEUP, next, WINDOW_MILLIS, alarmIntent(context));
                state(context).edit().putLong("nextAlarmMillis", next).apply();
            }
        }
    }

    private static void deliverDue(Context context, FeatureDataStore.Snapshot snapshot, long now) {
        Set<String> delivered = delivered(context);
        boolean changed = false;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        int sent = 0;
        for (FeatureDataStore.Occurrence item : snapshot.occurrences) {
            int lead = snapshot.leadFor(item);
            if (!snapshot.shouldRemind(item) || deliveryDeadline(item, lead) <= now || delivered.contains(item.deliveryKey())
                    || FeatureRules.reminderTime(item.startMillis, lead) > now) continue;
            String time = CLOCK.format(Instant.ofEpochMilli(item.startMillis).atZone(FeatureRules.ZONE));
            String details = time + " 开始" + (item.room.isEmpty() ? "" : " · " + item.room);
            int icon = context.getResources().getIdentifier("ic_course_notification", "drawable", context.getPackageName());
            if (icon == 0) icon = android.R.drawable.ic_dialog_info;
            Notification publicVersion = new Notification.Builder(context, CHANNEL_ID)
                    .setSmallIcon(icon).setContentTitle("随课课程提醒").setContentText("解锁查看课程信息").build();
            Notification notification = new Notification.Builder(context, CHANNEL_ID)
                    .setSmallIcon(icon).setContentTitle(item.name).setContentText(details)
                    .setStyle(new Notification.BigTextStyle().bigText(details))
                    .setContentIntent(openTimetable(context)).setAutoCancel(true)
                    .setCategory(Notification.CATEGORY_EVENT).setVisibility(Notification.VISIBILITY_PRIVATE)
                    .setPublicVersion(publicVersion).setShowWhen(false).setOnlyAlertOnce(true).build();
            manager.notify(item.deliveryKey(), 4101, notification);
            delivered.add(item.deliveryKey());
            changed = true;
            if (++sent >= 32) break; // Bound receiver work for malformed-but-valid dense schedules.
        }
        if (changed) state(context).edit().putStringSet("delivered", delivered).apply();
    }

    private static void pruneDelivered(Context context, FeatureDataStore.Snapshot snapshot, long now) {
        Set<String> valid = new HashSet<>();
        for (FeatureDataStore.Occurrence item : snapshot.occurrences) {
            if (item.endMillis >= now - 2 * 86400000L) valid.add(item.deliveryKey());
        }
        Set<String> kept = delivered(context);
        kept.retainAll(valid);
        state(context).edit().putStringSet("delivered", kept).apply();
    }

    private static void cancelStaleNotifications(Context context, FeatureDataStore.Snapshot snapshot) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        Set<String> current = new HashSet<>();
        for (FeatureDataStore.Occurrence item : snapshot.occurrences) {
            if (snapshot.shouldRemind(item)) current.add(item.deliveryKey());
        }
        for (StatusBarNotification active : manager.getActiveNotifications()) {
            if (CHANNEL_ID.equals(active.getNotification().getChannelId()) && !current.contains(active.getTag()))
                manager.cancel(active.getTag(), active.getId());
        }
    }

    private static String result(Context context, FeatureDataStore.Snapshot snapshot, String error) {
        try {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel channel = manager == null ? null : manager.getNotificationChannel(CHANNEL_ID);
            return new JSONObject().put("ok", true).put("error", error).put("schemaVersion", 1)
                    .put("enabled", snapshot.enabled).put("leadMinutes", snapshot.leadMinutes)
                    .put("occurrenceCount", snapshot.occurrences.size())
                    .put("permissionGranted", permissionGranted(context)).put("notificationsAllowed", allowed(context))
                    .put("channelEnabled", channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE)
                    .put("scheduling", "inexact").put("windowMinutes", 10)
                    .put("nextAlarmMillis", state(context).getLong("nextAlarmMillis", 0)).toString();
        } catch (JSONException error1) { return errorResult("feature_unavailable"); }
    }

    private static String errorResult(String code) {
        try { return new JSONObject().put("ok", false).put("error", code).toString(); }
        catch (JSONException error) { return "{\"ok\":false,\"error\":\"feature_unavailable\"}"; }
    }

    private static boolean permissionGranted(Context context) {
        return Build.VERSION.SDK_INT < 33
                || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private static boolean allowed(Context context) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (!permissionGranted(context) || manager == null || !manager.areNotificationsEnabled()) return false;
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL_ID);
        return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    private static void ensureChannel(Context context) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "课程提醒", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("按照本机课表发送的上课提醒；系统省电设置可能导致延迟");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        manager.createNotificationChannel(channel);
    }

    static PendingIntent openTimetable(Context context) {
        Intent intent = new Intent(context, MainActivity.class).setAction("cn.suike.timetable.OPEN_TIMETABLE")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, 4102, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent alarmIntent(Context context) {
        Intent intent = new Intent(context, FeatureAlarmReceiver.class).setAction(ALARM_ACTION);
        return PendingIntent.getBroadcast(context, 4103, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void cancelAlarm(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.cancel(alarmIntent(context));
        state(context).edit().putLong("nextAlarmMillis", 0).apply();
    }

    private static SharedPreferences state(Context context) { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    private static long deliveryDeadline(FeatureDataStore.Occurrence item, int lead) {
        // A zero-minute reminder is a start-of-class notice, with at most ten minutes of inexact-alarm grace.
        return lead == 0 ? Math.min(item.endMillis, item.startMillis + WINDOW_MILLIS) : item.startMillis;
    }
    private static Set<String> delivered(Context context) {
        return new HashSet<>(state(context).getStringSet("delivered", new HashSet<String>()));
    }
}
