# APK asset contract

Product additions (1.4.0): `product-addon.js` adds functional entry points using the existing monochrome styles. UI redesign remains a separate Kimi handoff. The generated local asset includes `workspace-storage.js`, `workspace-engine.js`, `notice-engine.js` and `product-core.js`; the original user-facing HTML stays unchanged. Existing school import and clear flows commit through the same snapshot-protected workspace store. Do not copy the older website layout over the supplied 1.3.0 UI.

Durable workspace: on Android, the four timetable/history/semester/journal keys are stored together through synchronous native AtomicFile checkpoints. Startup recovers a pending journal, validates the state/history/archives, confirms persistence, and only then adopts state and refreshes the localStorage compatibility mirror. Invalid data stops startup instead of silently replacing it with bundled courses. Failed or uncertain write acknowledgement freezes further adapter writes until the next launch re-reads the native checkpoint. Keep the journal and private checkpoint in the same durability path; lifecycle callbacks, cookie flushing and fixed delays do not establish timetable persistence. The native bridge contract is documented in `NATIVE_FEATURES_README.md`.

The Java shell navigates to `https://suike.local/` with `loadUrl`; its existing `shouldInterceptRequest` handler returns the bundled `assets/index.html` directly. It never fetches this hostname from a server. The 1.0.2 `loadDataWithBaseURL` path reproduced an internal Chromium error page on the API 36 emulator; this change preserves the storage origin while avoiding that navigation path. Do not alter the original website source or the separate user-facing offline HTML.

The current `app.js` does not define `downloadBlob`: its export handler directly creates a Blob and clicks an anchor. Before writing the APK asset, replace **exactly one** occurrence of this entire block. Fail the build if the occurrence count differs from 1, and do not use a broad regex or a global Blob/anchor override.

Original block:

```javascript
  $('exportData').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json;charset=utf-8' }), url = URL.createObjectURL(blob), link = node('a');
    link.href = url; link.download = '随课备份-' + chinaToday() + '.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); showToast('已导出备份，换设备时可导入');
  });
```

APK-only replacement:

```javascript
  // SUIKE_ANDROID_EXPORT_V1: APK asset only; native system document picker.
  $('exportData').addEventListener('click', () => {
    try {
      M.validateState(state);
      if (!window.SuikeNative || typeof window.SuikeNative.exportBackup !== 'function') {
        showToast('请在随课安卓应用中导出备份');
        return;
      }
      const accepted = window.SuikeNative.exportBackup('随课备份-' + chinaToday() + '.json', JSON.stringify(state, null, 2));
      if (accepted) showToast('请选择 JSON 备份保存位置');
    } catch (error) { showToast('无法开始导出：' + error.message); }
  });
```

`exportBackup` returns whether the request was accepted. A native toast reports success, cancellation or failure. Only one export request can be pending; repeated calls do not replace its payload. Native code limits UTF-8 data to 5 MB and verifies the JSON envelope; the web model still validates the complete course data. The payload comes directly from the live closure state, including edits that could not be saved to localStorage.

The native shell injects a restrictive CSP before existing scripts and hides the exact install card by locating `#installTitle.closest('section.settings-card')` and verifying that it contains `#installApp`. No other settings are hidden. It disables requests to service workers, frames and external resources. Only a hardcoded asset allowlist under the app origin is served. Starting with 1.1.0 the app has INTERNET permission for the separate school PortalActivity; the local timetable remains network-blocked, and external pages have no local native bridge. No broad storage permission is used.

Whole-timetable clearing (1.3.1): `clear-addon.js` and `clear-addon.css` add monochrome controls only to the APK week view. Confirmed clearing persists an empty validated state before changing memory, resets the import ledger and pending preview, and records `skipLegacyImportBaseline: true`. This boolean skips seed updates, first-Monday auto-calibration and trusted legacy deletion inference; later ordinary imports still use their new ledger. Keep the marker in backups, edits and undo. Cancellation and storage failure leave the timetable intact. Undo restores the exact prior state, including manual labs and ledger. Installing an update does not clear anything. Regenerate with `prepare-assets.py`, run the compiled integration/model checks, then build; tests belong in the separate test APK.

The existing `<input id="importFile" type="file">` stays unchanged. `onShowFileChooser` opens `ACTION_OPEN_DOCUMENT`; native code performs the size/envelope check, then returns the selected content URI. Existing JavaScript performs full validation and safe import. Export uses `ACTION_CREATE_DOCUMENT` and the returned URI, with no broad storage access.

Manifest contract: package `cn.suike.timetable`, activity `.MainActivity`, minSdk 26, targetSdk 35; `windowSoftInputMode="adjustResize"`; system light no-action-bar theme; no native action bar. If configuration changes are handled, include `keyboardHidden|orientation|screenSize` (the wrapper also stages export bytes privately for activity/process recreation). Keep the package id and signing key stable for upgrades so Android preserves the app's WebView storage.

Runtime acceptance: cold launch in airplane mode; edit/save/relaunch; export/cancel/repeated export taps; import valid and invalid JSON; ordinary and pending course details; back closes a dialog before exiting; portrait/landscape and keyboard with Android 15 system bars. Compilation alone cannot confirm these device behaviors.

Startup protocol (APK 1.0.3): the head bootstrap records only fixed phase/error enums and bounded code coordinates. Inline script slots are 0 bootstrap, 1 compatibility helpers, 2 exact original seed, 3 compiled model, 4 compiled app. `__suikeBootPhase` progresses through bootstrap/seed/model/app/state/render/ready. `__suikeBootFail` never records message, stack, source URL, course data or backup text. After the initial render, `__suikeBootReady` sets the legacy dataset marker and sends the no-argument native `pageReady` signal. Native polling runs for at most 15 seconds and independently requires the actual local origin, explicit ready phase and marker, rendered date/grid/agenda structure and visible main container. The handshake accelerates verification but is not a second point of failure. Chrome error pages are detected without touching their possibly null document element. Console output is consumed without copying it into the diagnostic.

References used: [local WebView content](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content), [WebView JavaScript bridge](https://developer.android.com/develop/ui/views/layout/webapps/webview), [system document picker](https://developer.android.com/training/data-storage/shared/documents-files), [edge-to-edge insets](https://developer.android.com/develop/ui/views/layout/edge-to-edge).
