# Suike product modules — current Kimi handoff (widgets removed)

This directory adds functional capabilities to the Android-only asset. It does
not contain a finished visual redesign. The existing timetable's monochrome
layout remains in use; `product-addon.js` supplies minimal controls and dialogs
for a later Kimi interface pass.

Detailed Chinese handoff: [功能接口说明](../../../outputs/随课_Kimi前端功能接口.md).
Native contract: [NATIVE_FEATURES_README](../NATIVE_FEATURES_README.md) and
[payload/scheduler contract](../manifest-snippet.md).

## Module responsibilities

| Module | Responsibility |
| --- | --- |
| `outputs/随课_离线课表.html` | **Current UI source**: complete user 1.3.0 HTML; read by prepare-assets.py |
| `product-core.js` | Preference validation, blank first-install state, Shanghai-time native projection |
| `workspace-storage.js` | Authoritative native checkpoint cache, legacy browser-store migration, best-effort mirror and write freeze after uncertain failures |
| `workspace-engine.js` | Bounded snapshots, semester transaction/recovery, occurrence edits/removals and actual-time conflict checks |
| `notice-engine.js` | Conservative text parsing, editable drafts, duplicate/conflict plans and explicitly confirmed merge |
| `product-addon.js` | Integration into the existing app closure; `window.SuikeFeatures`; minimal forms and native callbacks |
| `product-addon.css` | Functional layout only; inherits the existing visual language |
| `vendor/` | Pinned offline OCR inputs, original licenses, fetch/verify tools; see its README |
| `work/timetable/dist/` | Legacy model/regression inputs; its old index.html is not the current UI source |

The pure engines expose browser UMD globals and CommonJS exports and compile for
Chrome 58. `product-addon.js` depends on the original app's closure variables; it
is not a standalone module. `prepare-assets.py` injects it after import/clear
addons, and patches the application model to retain validated `importLedger`,
`skipLegacyImportBaseline` and `productSettings`. Rebuild assets after changes;
do not hand-edit generated `assets/index.html`. For interface work, start from
`outputs/随课_离线课表.html` and the actual added controls in product-addon.js.
Never overwrite the current UI with `work/timetable/dist/index.html`.

## Rebuilding the source handoff

Keep the archive's `work/` and `outputs/` layout. It contains current Java,
resources, HTML source, feature modules, npm lock files and license text, but
includes the pinned OCR binaries and licenses, and excludes SDK/JDK tools, node_modules, signing material, browser
profiles and diagnostic directories. Obtain Python 3.9+, Node.js 18+ and JDK 17.
The Windows build script expects the JDK under `work/android-tools/*/bin/`,
`work/android-tools/android-35/android.jar`, and build tools under
`work/android-tools/android-15/` (Build Tools 35.0.0: aapt2, zipalign, core-lambda-stubs.jar,
lib/d8.jar and lib/apksigner.jar). These environment dependencies are not supplied
or automatically downloaded by build.py.

From the extracted archive root, restore npm/OCR dependencies before preparing:

```powershell
npm ci --prefix work/android-app/tools
python work/android-app/product/vendor/fetch_vendor.py
python work/android-app/prepare-assets.py
python work/android-app/build.py --unsigned-only
```

The fetch step uses the pinned hashes and original license files. Once all
dependencies exist, the APK build itself is offline. Existing `res/` files are
build inputs; the historical `make_resources.py` targets 1.0.0 assertions and is
excluded from the source archive. The historical release finalizer is excluded; it depends on private release-environment artifacts. The complete package root README explains frontend preview without Android tools.

Use compile-only/unsigned-only stages for interface work. Default signed builds
create a new local key if the official private key is absent; that signature
cannot update the installed official app. Use an isolated emulator or a separate
development package identity instead of asking a user to uninstall and lose
their local data. The official key/password are deliberately absent.

## Persistence and write contract

Current state: `suike.timetable.v1`. Separate logical stores:
`suike.history.v1`, `suike.semesters.v1`,
`suike.workspace.transaction.v1`.

On Android, create the injected storage with
`SuikeWorkspaceStorage.createStorage(localStorage, SuikeNative)`. The private
`workspace-checkpoint-v1.json` is authoritative; localStorage is a best-effort
compatibility mirror. The Android bridge returns JSON text: its only absence
response is the string `'null'` (the JSON null literal), permitting migration of
the four old browser values. The adapter also accepts actual JS null from tests
or other direct implementations; undefined, invalid data and read errors must
fail closed. Without both checkpoint bridge methods, browser
tests fall back to their injected storage; they do not acquire Android durability.

Every changed key persists a complete `{version:1,values:{...}}` envelope, with
exactly the four logical keys and string/null values. Native persistence returns
true only after the write, explicit `FD.sync()`, `AtomicFile` commit and readback
verification. Then the adapter updates its authoritative cache and attempts the
mirror write. Mirror failure does not undo confirmed native persistence. The
whole UTF-8 envelope is limited to 16 MiB, including escaped journal old values;
it can reject before individual history/archive limits are reached. Saving must
not depend on WebView's asynchronous localStorage flush or lifecycle timing.

Use `SuikeWorkspaceEngine.createWorkspaceStore({storage, validateState,
validateLedger})`; call `recover()` before loading the main state. Boot also
validates history/archive, persists the selected state, then hydrates the mirror
and adopts state. Replace in-memory state only after a successful shared commit.
Its snapshot must persist before a destructive main-state write. No-op commits
do not grow history, while first migration still establishes a native checkpoint.

A native false/throw leaves the persistence result uncertain: the adapter keeps
its last confirmed cache and freezes further writes for that runtime, including
immediate rollback. Retain editor input and ask the user to reopen and inspect;
do not claim the on-disk data certainly stayed unchanged. A new instance reads
the actual checkpoint and replays any journal by restoring its old state/archive
values. Successful semester transactions remove the journal last. A rollback
failure reports `rollbackFailed`; invalid state, checkpoint or recovery data must
stop boot rather than silently display and overwrite a seed timetable.

Snapshot retention is at most 10 entries / 4 MiB of conservative UTF-16
serialized size. The semester store allows at most 12 states / 4 MiB and does not
silently evict old semesters. New semesters clear courses, source ledger and
course-specific reminder exceptions, while copying the profile, theme, global
reminder choice and supplied period settings.

Occurrence edit/removal helpers are pure and do not commit automatically. They
return a new state for the shared commit path. `one/future/all` applies to dates
in the selected course record; future includes the selected occurrence. Moves
shift selected dates by one common delta and retain the unchanged subset. Source
ledger associations follow split IDs/date changes; deletions become tombstones.
Split series inherit the original mute/override rule; the 500-entry exception
limit fails before mutation. The source baseline is never rewritten to pretend
a local edit came from school.

The current JSON backup exports only the current state, including current ledger
and preferences. It excludes history and the other semester archive entries.
Export each semester separately before uninstalling/clearing app data. Local
snapshots do not replace external backups.

## UI integration rules

`window.SuikeFeatures` is the supported UI façade. Read `getState()`/`settings()`;
use `parseNotice` → `previewNotice` → `commitNotice` for notices. Every selected
draft must have `confirmed:true`; editing a draft withdraws its confirmation.
`editOccurrences`/`removeOccurrences` return previews; call `commitState` only
after the user reviews scope and conflicts. `restoreHistory`, `createSemester`
and `switchSemester` persist immediately, can throw, and return the adopted state
copy. The Chinese handoff inventories existing DOM IDs and method return types.
After adopting a semester/history state, the UI selects its `startMonday` and
first week, falling back to today only if no start Monday exists. The creation
API accepts custom `config.periods`; the minimal dialog reuses current periods.
The existing settings page displays periods but has no period-editing UI.

Daytime actual clocks come from user periods. Night periods require a full
source clock range; pending/missing night times are unconfirmed, not conflict
free. “下午”, “下课后”, ambiguous batch/lab-room mappings and changes/cancellations
must be reviewed rather than guessed. OCR only fills editable text.

The bridge is local-only (`https://suike.local`), never exposed to the school
portal. `getWorkspaceCheckpoint()` synchronously returns JSON text containing the
four-key envelope or the genuine-absence JSON null literal (`'null'` as a JS
string). The adapter supports direct null responses too, but rejects undefined.
`persistWorkspaceCheckpoint(json)` synchronously returns
confirmed persistence success. These are separate from `syncFeatures`: feature
synchronization replaces the entire projection, including an empty list after
clear, and its true means accepted with asynchronous completion status. Native
IDs use a deterministic 64-bit double-hash mapping,
independently of persisted course IDs, with matching mute/override mapping.
Native labels have unsupported control characters removed from the projection
without changing stored text. Native projection includes at most the first 1500
confirmed occurrences within 366 days and is further reduced until serialized
JSON is at most 300,000 UTF-16 units (a conservative UTF-8 bound below 900 KB).
`nativePayload` has a non-enumerable `projectionInfo` property containing
`eligible/included/truncated`; it is UI metadata and is not sent in JSON. The
product summary persistently displays a warning when projection is truncated.
Reminders are opt-in and inexact, use a
ten-minute window, and may be delayed/suppressed by Android. Desktop widgets, their native provider, pin bridge, resources and transition alarms have been removed.

After validating the bundled HTML, MainActivity authorizes its newly created
WebView immediately before the single fixed `https://suike.local/` loadUrl. This
authorizes the current local document before its synchronous checkpoint calls.
Load failure, destruction and subsequent nonlocal navigation revoke trust;
asset/network/frame restrictions and the separate bridge-free school portal
remain in force. Workspace recovery failure reports the fixed boot failure phase
`init` and stops startup. The 15-second production watchdog and the local trust/startup persistence fixes remain unchanged.

Known UI follow-ups: a route to a nonempty week if the first week has no courses;
period editing controls; current/archive semester-name consistency; clear
distinction between current-term JSON and multi-term local archives. Preserve
the implemented first-week selection and projection-truncation warning in any
redesign. These are design work, not completed redesign claims.

## Verification

```powershell
python work/android-app/prepare-assets.py
node --test work/android-app/product/product-core.test.cjs work/android-app/product/notice-engine.test.cjs work/android-app/product/workspace-engine.test.cjs work/android-app/product/workspace-storage.test.cjs work/android-app/product/test-product-integration.cjs
python work/android-app/build.py --compile-only
python work/android-app/build.py --unsigned-only
python work/android-app/product/vendor/verify_vendor.py --apk outputs/随课_安卓离线版.apk --json work/android-app/build/ocr-verification.json
```

Run asset preparation before packaged integration tests when a source module has
changed. The latest CPU logs record 126 passing cases, plus 20 model checks and
one boot-guard check. These tests cover pure rules and actual generated event
handlers through a simulated DOM. Vendor checks cover pinned
hashes, 4 ABI × 4 libraries, stored/aligned ZIP entries, 64-bit ELF 16 KiB load
alignment, the model, license copies and OCR DEX inclusion. Packaging reports
are public metadata; signing passwords/keys must never be copied into reports or
handoff artifacts.

This source-only handoff was checked after widget removal: 126 product/import CPU cases passed and an unsigned Android build passed Java/DEX/resource/locked OCR packaging checks. No new release APK or Android runtime acceptance was produced. Previous 1.4.0 runtime reports apply only to that immutable APK. Frontend changes require fresh asset generation, regression checks and Android acceptance before publication.
