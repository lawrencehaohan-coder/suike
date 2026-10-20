# Native timetable features integration

These entries are registered in the current source manifest (based on 1.4.0/code 9) (the Java/resources do not require an R.java file):

```xml
<!-- At manifest scope. There is deliberately no exact-alarm permission. -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />

<!-- Inside application. -->
<receiver android:name=".FeatureAlarmReceiver" android:exported="false" />
<receiver android:name=".FeatureBootReceiver" android:exported="false">
    <intent-filter>
        <action android:name="android.intent.action.BOOT_COMPLETED" />
        <action android:name="android.intent.action.TIME_SET" />
        <action android:name="android.intent.action.TIMEZONE_CHANGED" />
        <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
    </intent-filter>
</receiver>

```

## MainActivity hooks

MainActivity bridge integration is implemented. See [NATIVE_FEATURES_README.md](NATIVE_FEATURES_README.md) for exact JavaScript method return values, callbacks, screenshot picker and notification permission request codes. The public scheduler API below remains useful for native lifecycle hooks.

Only the trusted `https://suike.local` bridge may call these methods. Do not expose this bridge to the school portal. Check the current trusted WebView origin before dispatching a bridge call; MainActivity owns this existing guard.

* `FeatureScheduler.sync(Context, String)` returns JSON. Validate/synchronize the projection after local app startup and every course, semester, timetable, or reminder-setting mutation. Send an empty occurrence array after clearing the timetable; synchronization replaces the entire native projection, cancels the previous alarm, and removes stale posted course notifications.
* `FeatureScheduler.status(Context)` returns JSON without reading page labels, course text, rooms, or credentials into the result.
* `FeatureScheduler.setEnabled(Context, boolean)` returns JSON and updates native global opt-in while preserving projection data. Normal web mutations should continue to call `sync` with the complete desired state so the web preference and native preference agree.
* `FeatureScheduler.refresh(Context)` returns void. Call on Activity resume and after the result of a notification permission request. It rebuilds the next inexact alarm.

On Android 13+, invoke `requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, requestCode)` only after the user taps the enable-reminders control. The scheduler never launches a permission prompt. The web UI should explain denied permission using `permissionGranted`/`notificationsAllowed`, and offer a user-initiated link to Android notification settings if appropriate. A permission denial must not interrupt local timetable viewing.

The bridge may run `sync` on its existing WebView bridge thread. Keep the call off the Activity UI thread when the full payload is large. No network or school capture is performed by this feature.

## Payload

```json
{
  "schemaVersion": 1,
  "enabled": false,
  "leadMinutes": 10,
  "mutedCourseIds": [],
  "courseOverrides": {
    "course-1": { "enabled": true, "leadMinutes": 15 }
  },
  "occurrences": [
    {
      "id": "course-1@2026-10-12@1",
      "courseId": "course-1",
      "date": "2026-10-12",
      "name": "高等数学",
      "room": "教学楼 A201",
      "startMillis": 1791763200000,
      "endMillis": 1791768600000
    }
  ]
}
```

Epoch milliseconds must match the supplied local date in **Asia/Shanghai**. Native code rejects times outside 2000–2100, non-finite or fractional values, invalid dates, end-before-start, spans beyond a single local day, duplicate occurrence IDs, text containing control/bidi-override characters, and oversized text. IDs are limited to 128 UTF-16 units, names to 120, and rooms to 160. Payload maximum: 1 MiB UTF-8 and 50,000 occurrences. Unknown fields are discarded instead of being persisted. The persisted file is private app storage and Android backup is already disabled by the existing application manifest.

`enabled` is required and must be a boolean. `leadMinutes` defaults to 10 and accepts an integer 0–120. Muted course IDs always suppress reminders, including when a corresponding override says enabled. Per-course `enabled:false` suppresses that course; per-course lead minutes replace the global lead. Global opt-in is always required.

`sync`/`setEnabled`/`status` successful result example:

```json
{"ok":true,"error":"none","schemaVersion":1,"enabled":false,"leadMinutes":10,"occurrenceCount":1,"permissionGranted":false,"notificationsAllowed":false,"channelEnabled":true,"scheduling":"inexact","windowMinutes":10,"nextAlarmMillis":0}
```

Failure results contain only `ok:false` and a generic `error` enum. Invalid synchronization leaves the previous valid projection intact. No exception text or course content is logged or returned in status/error diagnostics.

## Behavior and limits

The scheduler uses one replaceable `AlarmManager.setWindow` alarm with a ten-minute window. No exact-alarm special access, background service, wake lock, network service, or battery-optimization exemption is requested. Android Doze, vendor power management, force-stop, and disabled notifications can delay or prevent reminders. UI text must describe reminders as approximate; no guarantee of an exact alert time should be made. Force-stopped apps cannot reschedule until opened again.

Before-class reminders delayed beyond class start are dropped. A zero-minute reminder is a class-start notice and may arrive during its first ten minutes. Opening the app or rebooting before class start can catch up a reminder whose lead time has just passed. Duplicate deliveries are suppressed for a given occurrence ID and start time; reminder settings changes do not replay an already-delivered occurrence.

Desktop widgets have been removed by user request, including the provider, layouts, pin bridge and transition alarms. Boot, time changes and app replacement still refresh opt-in reminders from private storage.

Java feature sources: `FeatureRules`, `FeatureDataStore`, `FeatureScheduler`, `FeatureAlarmReceiver`, `FeatureBootReceiver`. The notification icon remains in `res/drawable`.
