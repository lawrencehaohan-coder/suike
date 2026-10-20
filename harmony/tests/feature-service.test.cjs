/*
 * Behavior tests for the real FeatureService and FormExtensionAbility source.
 * Platform APIs are mocked. TypeScript transpilation is only a way to execute
 * the non-UI source under Node; this does not verify ArkTS or a HAP build.
 *
 * Run from project: node tests/feature-service.test.cjs [path/to/typescript.js]
 * Alternatively set SUIKE_TYPESCRIPT to an installed TypeScript module path.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

function findTypeScript() {
  const candidates = [
    process.argv[2], process.env.SUIKE_TYPESCRIPT,
    path.resolve(__dirname, '../node_modules/typescript'),
    path.resolve(__dirname, '../../../harmony-tools/hvigor-6.0.6/node_modules/@ohos/hvigor/node_modules/typescript'),
    path.resolve(__dirname, '../../../harmony-tools/hvigor-6.0.6/node_modules/@ohos/hvigor-ohos-plugin/node_modules/typescript'),
    'typescript'
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate); } catch (_) {}
  }
  throw new Error('TypeScript is required for this mock harness. Pass its module path as the first argument or set SUIKE_TYPESCRIPT.');
}

const ts = findTypeScript();
const sourceRoot = path.resolve(__dirname, '../entry/src/main/ets');
function loadSource(name, modules, extra = {}) {
  const source = fs.readFileSync(path.join(sourceRoot, name), 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
    reportDiagnostics: true
  });
  const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('\n'));
  const exports = {};
  vm.runInNewContext(result.outputText, {
    exports,
    require(name) {
      assert.ok(Object.prototype.hasOwnProperty.call(modules, name), 'Unexpected runtime import: ' + name);
      return modules[name];
    },
    console, Date, JSON, Set, Math, Promise, Number, String, Array, Object, Error,
    ...extra
  }, { filename: name });
  return exports;
}

const rules = loadSource('domain/Rules.ts', {});
let setupId = 0;
const services = [];
const disks = new Map();
class MemoryAtomicStore {
  constructor(dir) {
    this.dir = dir;
    this.fail = false;
    if (!disks.has(dir)) disks.set(dir, new Map());
    this.data = disks.get(dir);
  }
  read(name) { return this.data.get(name) ?? null; }
  write(name, value) {
    if (this.fail) return false;
    this.data.set(name, value);
    return this.read(name) === value;
  }
}

function setup(initial = {}) {
  const dir = 'test-' + (++setupId);
  const store = new MemoryAtomicStore(dir);
  for (const [key, value] of Object.entries(initial)) store.write(key, value);
  const state = {
    allowed: true, valid: [], cancelCalls: 0, publishCalls: 0,
    failCancel: false, failPublishAt: -1, failPermissionQuery: false, failVerification: false,
    mismatch: false, publishGate: null, permissionGate: null, throwPermissionRequest: false,
    updates: [], nextRefreshRequests: [], failFormIds: new Set(), timers: new Map(), logs: []
  };
  const reminderAgentManager = {
    ReminderType: { REMINDER_TYPE_CALENDAR: 1 },
    ActionButtonType: { ACTION_BUTTON_TYPE_CLOSE: 0 },
    async cancelAllReminders() {
      state.cancelCalls++;
      if (state.failCancel) throw { code: 1700004 };
      state.valid = [];
    },
    async publishReminder(request) {
      const index = state.publishCalls++;
      if (state.publishGate) {
        const gate = state.publishGate;
        state.publishGate = null;
        await gate;
      }
      if (index === state.failPublishAt) throw { code: 1700002 };
      state.valid.push(request);
      return index + 1;
    },
    async getValidReminders() {
      if (state.failVerification) throw { code: 1700004 };
      return state.mismatch ? [] : state.valid;
    }
  };
  const notificationManager = {
    SlotType: { CONTENT_INFORMATION: 0 },
    async isNotificationEnabled() {
      if (state.failPermissionQuery) throw { code: 1600003 };
      return state.allowed;
    },
    requestEnableNotification() {
      if (state.throwPermissionRequest) throw { code: 1600013 };
      return state.permissionGate || Promise.resolve();
    }
  };
  const formProvider = {
    async updateForm(id, data) {
      if (state.failFormIds.has(id)) throw { code: 16501001 };
      state.updates.push({ id, data });
    },
    async setFormNextRefreshTime(id, minutes) { state.nextRefreshRequests.push({ id, minutes }); }
  };
  class MockFormExtensionAbility {}
  const formKit = {
    FormExtensionAbility: MockFormExtensionAbility,
    formBindingData: { createFormBindingData: data => data },
    formProvider,
    formInfo: {
      FormParam: {
        IDENTITY_KEY: 'ohos.extra.param.key.form_identity',
        NAME_KEY: 'ohos.extra.param.key.form_name',
        DIMENSION_KEY: 'ohos.extra.param.key.form_dimension'
      },
      FormDimension: { Dimension_2_4: 4 }
    }
  };
  const modules = {
    '@kit.AbilityKit': {},
    '@kit.BackgroundTasksKit': { reminderAgentManager },
    '@kit.NotificationKit': { notificationManager },
    '@kit.FormKit': formKit,
    '@kit.BasicServicesKit': {},
    './AtomicStore': { AtomicStore: MemoryAtomicStore },
    '../domain/Rules': rules
  };
  const api = loadSource('services/FeatureService.ets', modules, {
    setInterval(callback, milliseconds) { state.timers.set(1, { callback, milliseconds }); return 1; },
    clearInterval(id) { state.timers.delete(id); }
  });
  const context = {
    filesDir: dir, abilityInfo: { bundleName: 'cn.suike.timetable' },
    resourceManager: { getConfigurationSync: () => ({ colorMode: 0 }) }
  };
  const service = new api.FeatureService(context, store);
  services.push(service);
  const formModules = {
    '@kit.AbilityKit': {}, '@kit.FormKit': formKit, '@kit.BasicServicesKit': {},
    '@kit.PerformanceAnalysisKit': { hilog: {
      error: (...args) => state.logs.push(args), warn: (...args) => state.logs.push(args)
    } },
    '../services/AtomicStore': { AtomicStore: MemoryAtomicStore },
    '../services/FeatureService': api
  };
  const FormAbility = loadSource('entryformability/CourseFormAbility.ets', formModules).default;
  const form = new FormAbility();
  form.context = context;
  return { state, store, api, service, form, status: () => JSON.parse(service.status()) };
}

function payload(count = 5, enabled = true) {
  const now = Date.now();
  return {
    schemaVersion: 1, theme: 'auto', enabled, leadMinutes: 10,
    mutedCourseIds: [], courseOverrides: {},
    occurrences: Array.from({ length: count }, (_, index) => ({
      id: 'o' + index, courseId: 'c' + index,
      date: rules.shanghaiDay(now + (index + 2) * 3600000),
      name: '课程' + index, room: '教室' + index,
      startMillis: now + (index + 2) * 3600000,
      endMillis: now + (index + 3) * 3600000
    }))
  };
}
function sync(t, value = payload()) { assert.equal(t.service.sync(JSON.stringify(value)), true); }
async function settle() { for (let index = 0; index < 20; index++) await Promise.resolve(); }
const tests = [];
function test(name, run) { tests.push({ name, run }); }

test('sync reports persistence without promising or scheduling reminders', async () => {
  const t = setup();
  sync(t);
  assert.equal(t.state.cancelCalls, 0);
  assert.equal(t.state.publishCalls, 0);
  assert.equal(t.status().configurationPending, true);
  assert.equal(t.status().deliveryVerified, false);
  assert.equal(t.status().pinSupported, false);
});

test('32 future reminders produce a verified 30-reminder window and an explicit refresh deadline', async () => {
  const t = setup(), value = payload(32);
  sync(t, value);
  await t.service.refresh();
  assert.equal(t.status().reminderState, 'limited');
  assert.equal(t.status().scheduled, 30);
  assert.equal(t.status().pending, 2);
  assert.equal(t.status().capacity, 30);
  assert.equal(t.status().refreshNeededBefore, value.occurrences[30].startMillis - 600000);
  assert.equal(t.status().configurationPending, true);
  assert.equal(new Set(t.state.valid.map(r => r.notificationId)).size, 30);
  assert.equal(t.state.valid[0].wantAgent.pkgName, 'cn.suike.timetable');
});

test('turning reminders off cancels the previous app reminders', async () => {
  const t = setup();
  sync(t); await t.service.refresh();
  const published = t.state.publishCalls;
  sync(t, payload(5, false)); await t.service.refresh();
  assert.equal(t.state.publishCalls, published);
  assert.equal(t.state.valid.length, 0);
  assert.equal(t.status().reminderState, 'disabled');
  assert.equal(t.status().configurationPending, false);
});

test('notification denial saves settings but publishes nothing', async () => {
  const t = setup(); t.state.allowed = false;
  sync(t); await t.service.refresh();
  assert.equal(t.state.publishCalls, 0);
  assert.equal(t.status().notificationsAllowed, false);
  assert.equal(t.status().notificationPermission, false);
  assert.equal(t.status().reminderState, 'permission-denied');
  assert.equal(t.status().configurationPending, true);
});

test('cancel failure after a successful round leaves the new round pending and does not duplicate reminders', async () => {
  const t = setup(); sync(t); await t.service.refresh();
  assert.equal(t.status().configurationPending, false);
  const published = t.state.publishCalls;
  t.state.failCancel = true; await t.service.refresh();
  assert.equal(t.state.publishCalls, published);
  assert.equal(t.status().reminderState, 'cancel-error');
  assert.equal(t.status().scheduleVerifiedAt, 0);
  assert.equal(t.status().configurationPending, true);
});

test('permission query failure after a successful round remains pending', async () => {
  const t = setup(); sync(t); await t.service.refresh();
  t.state.failPermissionQuery = true; await t.service.refresh();
  assert.equal(t.status().reminderState, 'permission-query-error');
  assert.equal(t.status().notificationsAllowed, null);
  assert.equal(t.status().scheduled, 0);
  assert.equal(t.status().configurationPending, true);
});

test('notification permission revoked after a successful round remains pending', async () => {
  const t = setup(); sync(t); await t.service.refresh();
  t.state.allowed = false; await t.service.refresh();
  assert.equal(t.status().reminderState, 'permission-denied');
  assert.equal(t.status().scheduled, 0);
  assert.equal(t.status().configurationPending, true);
});

test('verification failure after successful publication never reports a fully applied configuration', async () => {
  const t = setup(); sync(t); await t.service.refresh();
  assert.equal(t.status().configurationPending, false);
  t.state.failVerification = true; await t.service.refresh();
  assert.equal(t.status().reminderState, 'verification-error');
  assert.equal(t.status().scheduleVerifiedAt, 0);
  assert.equal(t.status().configurationPending, true);
  assert.equal(t.status().deliveryVerified, false);
  assert.equal(t.status().ok, false);
});

test('a mismatching system list counts unconfirmed future reminders as pending', async () => {
  const t = setup(); const value = payload(); sync(t, value);
  t.state.mismatch = true; await t.service.refresh();
  assert.equal(t.status().scheduled, 0);
  assert.equal(t.status().pending, 5);
  assert.equal(t.status().reminderError, 'SYSTEM_SCHEDULE_MISMATCH');
  assert.equal(t.status().refreshNeededBefore, value.occurrences[0].startMillis - 600000);
  assert.equal(t.status().configurationPending, true);
});

test('the actual system capacity error preserves partial success and all remaining work', async () => {
  const t = setup(); t.state.failPublishAt = 2;
  sync(t); await t.service.refresh();
  assert.equal(t.status().scheduled, 2);
  assert.equal(t.status().pending, 3);
  assert.equal(t.status().reminderState, 'system-limit');
  assert.equal(t.status().reminderError, '1700002');
  assert.equal(t.status().configurationPending, true);
});

test('failed persistence leaves the previous saved configuration and system reminders alone', async () => {
  const t = setup(); sync(t); await t.service.refresh();
  const previous = t.store.read('features.json'), cancelled = t.state.cancelCalls;
  t.store.fail = true;
  assert.equal(t.service.sync(JSON.stringify(payload(1))), false);
  await t.service.refresh();
  assert.equal(t.store.read('features.json'), previous);
  assert.equal(t.state.cancelCalls, cancelled);
  assert.equal(t.status().reminderState, 'configuration-error');
});

test('invalid feature JSON and invalid appearance values are rejected without replacing saved files', async () => {
  const t = setup();
  const before = t.store.read('features.json');
  assert.equal(t.service.sync('{bad'), false);
  assert.equal(t.store.read('features.json'), before);
  const appearance = t.store.read('appearance.json');
  assert.equal(t.service.appearance(true, 101, false), false);
  assert.equal(t.store.read('appearance.json'), appearance);
  assert.equal(t.status().appearancePersisted, false);
});

test('a corrupt persisted payload is reported without inventing a usable reminder configuration', async () => {
  const t = setup({ 'features.json': 'bad' });
  await t.service.refresh();
  assert.equal(t.status().configPersisted, false);
  assert.equal(t.status().reminderState, 'configuration-error');
  assert.equal(t.state.cancelCalls, 0);
  assert.equal(t.api.createCourseCardData(t.store, false, false).state, '请打开随课');
});

test('per-course mute and explicit lead overrides reach the system request', async () => {
  const t = setup(), value = payload(3);
  value.mutedCourseIds = ['c0'];
  value.courseOverrides.c1 = { enabled: false };
  value.courseOverrides.c2 = { enabled: true, leadMinutes: 30 };
  sync(t, value); await t.service.refresh();
  assert.equal(t.state.valid.length, 1);
  assert.equal(t.state.valid[0].title, '课程2');
  const actual = t.state.valid[0].dateTime;
  const expected = new Date(value.occurrences[2].startMillis - 1800000);
  assert.equal(actual.hour, expected.getHours());
  assert.equal(actual.minute, expected.getMinutes());
});

test('a changed payload during asynchronous publication supersedes the old schedule serially', async () => {
  const t = setup(); let release;
  t.state.publishGate = new Promise(resolve => { release = resolve; });
  sync(t); const first = t.service.refresh();
  while (t.state.publishCalls === 0) await Promise.resolve();
  const changed = payload(1); changed.occurrences[0].name = '新课程';
  sync(t, changed); const second = t.service.refresh();
  release(); await Promise.all([first, second]);
  assert.equal(t.state.cancelCalls, 2);
  assert.equal(t.state.valid.length, 1);
  assert.equal(t.state.valid[0].title, '新课程');
  assert.equal(t.status().scheduled, 1);
  assert.equal(t.status().configurationPending, false);
});

test('refresh waits for a pending notification permission request', async () => {
  const t = setup(); let release;
  t.state.permissionGate = new Promise(resolve => { release = resolve; });
  sync(t, payload(1)); t.service.requestPermission();
  const refresh = t.service.refresh(); await settle();
  assert.equal(t.state.cancelCalls, 0);
  release(); await refresh; await t.service.refresh();
  assert.equal(t.status().notificationsAllowed, true);
  assert.equal(t.status().scheduled, 1);
});

test('a synchronous permission API error is visible and permits a later retry', async () => {
  const t = setup(); t.state.throwPermissionRequest = true;
  t.service.requestPermission();
  assert.equal(t.status().reminderState, 'permission-error');
  assert.equal(t.status().reminderError, '1600013');
  t.state.throwPermissionRequest = false;
  sync(t, payload(1)); t.service.requestPermission(); await t.service.refresh();
  assert.equal(t.status().notificationsAllowed, true);
});

test('both card sizes, saved appearance and explicit/automatic color modes reach binding data', async () => {
  const t = setup();
  t.store.write('course-forms.json', JSON.stringify({ version: 1, forms: [
    { id: '18446744073709551614', wide: true }, { id: '11', wide: false }
  ] }));
  sync(t); assert.equal(t.service.appearance(true, 80, true), true);
  await t.service.refresh();
  assert.equal(t.state.updates.length, 2);
  assert.equal(t.state.updates[0].id, '18446744073709551614');
  assert.equal(t.state.updates[0].data.wide, true);
  assert.equal(t.state.updates[1].data.wide, false);
  assert.equal(t.state.updates[0].data.dark, true);
  assert.equal(t.state.updates[0].data.frost, 80);
  assert.equal(t.state.updates[0].data.reducedMotion, true);
  const value = payload(); value.theme = 'light'; sync(t, value);
  assert.equal(t.api.createCourseCardData(t.store, true, false).dark, false);
  value.theme = 'dark'; sync(t, value);
  assert.equal(t.api.createCourseCardData(t.store, false, false).dark, true);
});

test('one failed form update is reported as partial rather than claiming all cards updated', async () => {
  const t = setup();
  t.store.write('course-forms.json', JSON.stringify({ version: 1, forms: [
    { id: '10', wide: true }, { id: '11', wide: false }
  ] }));
  t.state.failFormIds.add('11'); sync(t); await t.service.refresh();
  assert.equal(t.status().cardCount, 2);
  assert.equal(t.status().cardUpdatedCount, 1);
  assert.equal(t.status().cardState, 'partial-error');
  assert.equal(t.status().cardError, '16501001');
  assert.equal(t.status().ok, false);
});

test('the page timer refreshes snapshots without republishing reminders, and dispose removes the timer', async () => {
  const t = setup();
  t.store.write('course-forms.json', JSON.stringify({ version: 1, forms: [{ id: '10', wide: false }] }));
  sync(t); await t.service.refresh();
  const published = t.state.publishCalls, updated = t.state.updates.length;
  const timer = t.state.timers.get(1); assert.equal(timer.milliseconds, 60000);
  timer.callback(); await settle();
  assert.equal(t.state.publishCalls, published);
  assert.equal(t.state.updates.length, updated + 1);
  t.service.dispose();
  assert.equal(t.state.timers.size, 0);
  assert.equal(t.service.sync(JSON.stringify(payload())), false);
});

test('form lifecycle preserves 64-bit string IDs and requests only permitted refresh intervals', async () => {
  const t = setup(); sync(t);
  const id = '18446744073709551614';
  const binding = t.form.onAddForm({ parameters: {
    'ohos.extra.param.key.form_identity': id,
    'ohos.extra.param.key.form_name': 'CourseWide',
    'ohos.extra.param.key.form_dimension': 4
  } });
  assert.equal(binding.wide, true);
  assert.equal(t.api.readCourseForms(t.store).forms[0].id, id);
  t.form.onUpdateForm(id); await settle();
  assert.ok(t.state.updates.some(update => update.id === id));
  assert.ok(t.state.nextRefreshRequests.length > 0);
  assert.ok(t.state.nextRefreshRequests.every(request => request.minutes >= 5 && request.minutes <= 30));
  t.form.onRemoveForm(id);
  assert.equal(t.api.readCourseForms(t.store).forms.length, 0);
});

test('manually re-adding a card recovers an invalid form registry', async () => {
  const t = setup(); t.store.write('course-forms.json', '{bad');
  t.form.onAddForm({ parameters: {
    'ohos.extra.param.key.form_identity': '12',
    'ohos.extra.param.key.form_name': 'CourseCompact'
  } });
  assert.equal(t.api.readCourseForms(t.store).forms.length, 1);
  assert.equal(t.api.readCourseForms(t.store).forms[0].wide, false);
});

(async () => {
  let passed = 0;
  try {
    for (const entry of tests) {
      await entry.run();
      passed++;
      console.log('PASS ' + entry.name);
    }
    console.log('\n' + passed + '/' + tests.length + ' behavior scenarios passed. Platform APIs were mocked; no ArkTS/HAP build is claimed.');
  } finally {
    services.forEach(service => service.dispose());
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
