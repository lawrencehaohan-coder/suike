const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const E = require('./workspace-engine.js');
const M = require('../../timetable/dist/model.js');
const S = require('../../portal-import/safe-merge.js');
const esbuild = require(process.env.SUIKE_ESBUILD_MODULE || '../tools/node_modules/esbuild');

function course(id = 'math', dates = ['2026-09-07', '2026-09-14', '2026-09-21']) {
  return { id, name: '数学', day: 1, start: 1, end: 2, room: 'A101', teacher: '王老师', color: 'teal', dates, sourceTime: '' };
}
function state() {
  return { schemaVersion: 1, settings: { startMonday: '2026-09-07', totalWeeks: 20, termLabel: '2026 秋', coverageStart: '2026-09-07', coverageEnd: '2027-01-22', theme: 'dark' },
    periods: M.DEFAULT_PERIODS.map(p => ({ ...p })), courses: [course()], appliedUpdateIds: ['notice-preserved'], skipLegacyImportBaseline: true,
    productSettings: { profile: { className: '机器人 1 班', batch: '本科' }, reminders: { enabled: true, leadMinutes: 15, mutedCourseIds: ['math'], courseOverrides: { math: { leadMinutes: 30 } } } } };
}
function validator(input) { const output = M.validateState(input); if (input.productSettings) output.productSettings = JSON.parse(JSON.stringify(input.productSettings)); return output; }
let time = 0;
function options(extra = {}) { return { validateState: validator, validateLedger: S.validateLedger, now: () => new Date(Date.UTC(2026, 9, 12, 8, 0, time++)).toISOString(), ...extra }; }
function withLedger(input = state()) {
  input.importLedger = { version: 1, source: { system: 'test', term: '秋' }, entries: input.courses[0].dates.map((date, i) => ({ sourceOccurrenceId: 'remote-' + i, sourceKey: 'math-key', week: i + 1,
    baseline: { date, name: '数学', day: 1, start: 1, end: 2, room: 'A101', teacher: '王老师', sourceTime: '', timeMode: 'periods', timeNote: '' }, association: { courseId: 'math', date }, tombstone: false })) };
  return input;
}
function storage(seed = {}) {
  const data = new Map(Object.entries(seed)), writes = [];
  return { data, writes, fail: null, getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { writes.push(key); if (this.fail && this.fail(key, value)) throw new Error('quota'); data.set(key, value); },
    removeItem(key) { data.delete(key); } };
}
function incoming(input) {
  return { source: input.importLedger.source, scope: { from: '2026-09-07', to: '2026-09-21', complete: true }, occurrences: input.importLedger.entries.map(e => ({ sourceOccurrenceId: e.sourceOccurrenceId, sourceKey: e.sourceKey, week: e.week, ...e.baseline })) };
}

test('UMD runs without DOM and source compiles to Chrome 58', () => {
  const source = fs.readFileSync(require.resolve('./workspace-engine.js'), 'utf8');
  const output = esbuild.transformSync(source, { target: 'chrome58', charset: 'utf8' }).code;
  const context = vm.createContext({}); vm.runInContext(output, context);
  assert.equal(typeof context.SuikeWorkspaceEngine.editOccurrences, 'function');
  assert.equal(typeof context.SuikeWorkspaceEngine.createWorkspaceStore, 'function');
});

test('normalization preserves ledger, legacy marker, complete settings and validator additions', () => {
  const input = withLedger(); const normalized = E.normalizeState(input, validator, S.validateLedger);
  assert.deepEqual(normalized.importLedger, input.importLedger);
  assert.deepEqual(normalized.productSettings, input.productSettings);
  assert.deepEqual(normalized.settings, input.settings);
  assert.equal(normalized.skipLegacyImportBaseline, true);
  normalized.courses[0].name = '另一个'; assert.equal(input.courses[0].name, '数学');
  assert.throws(() => E.normalizeState({ ...input, skipLegacyImportBaseline: 'yes' }, validator, S.validateLedger), { code: 'LEGACY_MARKER_INVALID' });
});

test('snapshots persist before state writes, contain full state and dedupe no-ops', () => {
  const storeStorage = storage(), opts = options({ storage: storeStorage }), store = E.createWorkspaceStore(opts), before = withLedger();
  const next = structuredClone(before); next.courses[0].room = 'A202';
  const result = store.commit(before, next, '修改教室');
  assert.equal(result.changed, true);
  assert.deepEqual(storeStorage.writes, ['suike.history.v1', 'suike.timetable.v1']);
  const history = store.listHistory(); assert.equal(history.length, 1); assert.equal(history[0].reason, '修改教室'); assert.equal('state' in history[0], false);
  const restored = store.restoreHistory(result.state, history[0].id);
  assert.deepEqual(restored.state, E.normalizeState(before, validator, S.validateLedger));
  const writes = storeStorage.writes.length; assert.equal(store.commit(restored.state, restored.state, '无变化').changed, false); assert.equal(storeStorage.writes.length, writes);
});

test('snapshot retention enforces both count and serialized byte limits', () => {
  const mem = storage(), opts = options({ storage: mem, maxSnapshots: 3, maxBytes: 13000 }), h = E.createHistory(opts);
  for (let i = 0; i < 12; i++) { const a = state(), b = state(); a.courses[0].name = '课程 ' + i; b.courses[0].name = '修改后 ' + i; h.captureBefore(a, b, '编辑'); }
  assert.equal(h.list().length, 3); assert.ok(mem.getItem(E.DEFAULT_KEYS.history).length * 2 <= 13000);
  const byteMem = storage(), byteLimited = E.createHistory(options({ storage: byteMem, maxSnapshots: 10, maxBytes: 5000 }));
  for (let i = 0; i < 12; i++) { const a = state(), b = state(); a.courses[0].name = '课程 ' + i; b.courses[0].room = 'B'; byteLimited.captureBefore(a, b, '编辑'); }
  assert.ok(byteLimited.list().length < 10); assert.ok(byteMem.getItem(E.DEFAULT_KEYS.history).length * 2 <= 5000);
  const small = E.createHistory(options({ storage: storage(), maxBytes: 1024 }));
  const before = state(), after = state(); after.courses[0].room = 'B';
  assert.throws(() => small.captureBefore(before, after, '编辑'), { code: 'HISTORY_STATE_TOO_LARGE' });
});

test('history write failure prevents any destructive timetable commit', () => {
  const before = withLedger(), mem = storage({ [E.DEFAULT_KEYS.state]: JSON.stringify(before) }); mem.fail = key => key === E.DEFAULT_KEYS.history;
  const store = E.createWorkspaceStore(options({ storage: mem })), next = state(); next.courses = [];
  assert.throws(() => store.commit(before, next, '清空'), { code: 'STORAGE_WRITE_FAILED' });
  assert.equal(mem.getItem(E.DEFAULT_KEYS.state), JSON.stringify(before)); assert.equal(mem.writes.includes(E.DEFAULT_KEYS.state), false);
});

test('invalid history and tampered snapshot fail closed', () => {
  const mem = storage({ [E.DEFAULT_KEYS.history]: 'not json' }), store = E.createWorkspaceStore(options({ storage: mem }));
  const before = state(), next = state(); next.courses = [];
  assert.throws(() => store.commit(before, next, '清空'), { code: 'HISTORY_INVALID' }); assert.equal(mem.getItem(E.DEFAULT_KEYS.state), null);
  mem.data.delete(E.DEFAULT_KEYS.history); store.commit(before, next, '清空');
  const history = JSON.parse(mem.getItem(E.DEFAULT_KEYS.history)); history.snapshots[0].state.courses[0].room = '篡改'; mem.data.set(E.DEFAULT_KEYS.history, JSON.stringify(history));
  assert.throws(() => store.listHistory(), { code: 'HISTORY_INVALID' });
});

test('creating and switching semesters preserves manual edits/ledger and cleans new term', () => {
  const before = withLedger(), mem = storage({ [E.DEFAULT_KEYS.state]: JSON.stringify(before) }), store = E.createWorkspaceStore(options({ storage: mem }));
  const created = store.createSemester(before, { startMonday: '2027-03-01', termLabel: '2027 春', periods: before.periods });
  assert.deepEqual(created.state.courses, []); assert.deepEqual(created.state.appliedUpdateIds, []); assert.equal(created.state.importLedger, null); assert.equal(created.state.skipLegacyImportBaseline, true);
  assert.equal(created.state.settings.coverageStart, null); assert.equal(created.state.settings.theme, 'dark');
  assert.deepEqual(created.state.productSettings.reminders.mutedCourseIds, []); assert.deepEqual(created.state.productSettings.reminders.courseOverrides, {});
  assert.deepEqual(created.state.productSettings.profile, before.productSettings.profile); assert.equal(created.state.productSettings.reminders.leadMinutes, 15);
  const original = store.listSemesters().find(item => !item.active), editedNew = structuredClone(created.state); editedNew.settings.termLabel = '春季手工改名';
  const switched = store.switchSemester(editedNew, original.id);
  assert.deepEqual(switched.state, E.normalizeState(before, validator, S.validateLedger));
  const returned = store.switchSemester(switched.state, created.activeId); assert.equal(returned.state.settings.termLabel, '春季手工改名');
});

test('failed semester destination write rolls back main and archive and retains recovery snapshot', () => {
  const before = withLedger(), raw = JSON.stringify(before), mem = storage({ [E.DEFAULT_KEYS.state]: raw }); let failed = false;
  mem.fail = key => key === E.DEFAULT_KEYS.state && !failed && (failed = true);
  const store = E.createWorkspaceStore(options({ storage: mem }));
  assert.throws(() => store.createSemester(before, { startMonday: '2027-03-01', termLabel: '春', periods: before.periods }), e => e.code === 'STORAGE_WRITE_FAILED' && e.rollbackFailed === false);
  assert.equal(mem.getItem(E.DEFAULT_KEYS.state), raw); assert.equal(mem.getItem(E.DEFAULT_KEYS.semesters), null); assert.equal(mem.getItem(E.DEFAULT_KEYS.journal), null);
  assert.equal(store.listHistory().length, 1);
});

test('durable journal recovers a process interruption before archive or current reads', () => {
  const before = withLedger(), raw = JSON.stringify(before), mem = storage({ [E.DEFAULT_KEYS.state]: '{"partial":true}', [E.DEFAULT_KEYS.semesters]: '{"partial":true}',
    [E.DEFAULT_KEYS.journal]: JSON.stringify({ version: 1, writes: [{ key: E.DEFAULT_KEYS.semesters, previous: null }, { key: E.DEFAULT_KEYS.state, previous: raw }] }) });
  const store = E.createWorkspaceStore(options({ storage: mem })); assert.equal(store.recover(), true);
  assert.equal(mem.getItem(E.DEFAULT_KEYS.state), raw); assert.equal(mem.getItem(E.DEFAULT_KEYS.semesters), null); assert.equal(mem.getItem(E.DEFAULT_KEYS.journal), null);
});

test('history restore across semesters retains the new term and aligns active archive', () => {
  const before = withLedger(), mem = storage(), store = E.createWorkspaceStore(options({ storage: mem }));
  const created = store.createSemester(before, { startMonday: '2027-03-01', termLabel: '春', periods: before.periods });
  const oldSnapshot = store.listHistory()[0].id, spring = structuredClone(created.state); spring.courses = [course('spring', ['2027-03-01'])];
  const restored = store.restoreHistory(spring, oldSnapshot);
  assert.equal(restored.state.settings.termLabel, '2026 秋');
  assert.equal(store.listSemesters().filter(s => s.active)[0].name, '2026 秋');
  const back = store.switchSemester(restored.state, created.activeId); assert.equal(back.state.courses[0].id, 'spring');
});

test('semester limits reject the thirteenth term and invalid Monday without mutating input', () => {
  const before = state(), opts = options(); let archive = E.saveCurrentSemester(before, null, opts), current = before;
  for (let i = 0; i < 11; i++) { const plan = E.planCreateSemester(current, archive, { startMonday: '2027-03-01', termLabel: '学期 ' + i, periods: before.periods }, opts); archive = plan.archive; current = plan.state; }
  const saved = structuredClone(archive);
  assert.throws(() => E.planCreateSemester(current, archive, { startMonday: '2027-03-01', termLabel: '超出', periods: before.periods }, opts), { code: 'SEMESTER_LIMIT' });
  assert.deepEqual(archive, saved);
  assert.throws(() => E.planCreateSemester(before, null, { startMonday: '2027-03-02', termLabel: '错日', periods: before.periods }, opts), { code: 'SEMESTER_MONDAY_REQUIRED' });
});

test('single occurrence edits split deterministically, shift date/day and remap ledger binding', () => {
  const before = withLedger(), request = { courseId: 'math', date: '2026-09-14', scope: 'one', targetDate: '2026-09-15', changes: { room: 'B303' } };
  const first = E.editOccurrences(before, request, options()), second = E.editOccurrences(before, request, options());
  assert.equal(first.courseId, second.courseId); assert.notEqual(first.courseId, 'math'); assert.equal(first.affected, 1);
  assert.deepEqual(first.state.courses.find(c => c.id === 'math').dates, ['2026-09-07', '2026-09-21']);
  const edited = first.state.courses.find(c => c.id === first.courseId); assert.equal(edited.day, 2); assert.deepEqual(edited.dates, ['2026-09-15']);
  const binding = first.state.importLedger.entries.find(e => e.sourceOccurrenceId === 'remote-1');
  assert.deepEqual(binding.association, { courseId: first.courseId, date: '2026-09-15' }); assert.equal(binding.baseline.date, '2026-09-14');
  const merge = S.planMerge(first.state, incoming(before), first.state.importLedger); assert.equal(merge.preview.find(p => p.sourceOccurrenceId === 'remote-1').type, 'protectedLocal');
  assert.deepEqual(before.courses[0].dates, ['2026-09-07', '2026-09-14', '2026-09-21']);
});

test('future edits select anchor and later dates; all edits retain id; no-op edits do not split', () => {
  const before = withLedger();
  const future = E.editOccurrences(before, { courseId: 'math', date: '2026-09-14', scope: 'future', changes: { day: 3, name: '新数学' } }, options());
  assert.equal(future.affected, 2); assert.deepEqual(future.dates, ['2026-09-16', '2026-09-23']); assert.deepEqual(future.state.courses[0].dates, ['2026-09-07']);
  const all = E.editOccurrences(before, { courseId: 'math', date: '2026-09-14', scope: 'all', changes: { teacher: '李老师' } }, options()); assert.equal(all.state.courses.length, 1); assert.equal(all.courseId, 'math');
  const noChange = E.editOccurrences(before, { courseId: 'math', date: '2026-09-14', scope: 'one', changes: {} }, options()); assert.equal(noChange.affected, 0); assert.equal(noChange.state.courses.length, 1);
  const canonicalNoChange = E.editOccurrences(before, { courseId: 'math', date: '2026-09-14', scope: 'one', changes: { name: ' 数学 ', timeMode: 'periods' } }, options()); assert.equal(canonicalNoChange.affected, 0); assert.equal(canonicalNoChange.state.courses.length, 1);
  assert.throws(() => E.editOccurrences(before, { courseId: 'math', date: '2026-09-14', scope: 'one', targetDate: '2026-09-07', changes: {} }, options()), { code: 'OCCURRENCE_DATE_COLLISION' });
});

test('occurrence removals set tombstones so reimport never re-adds locally deleted dates', () => {
  const before = withLedger(); const removed = E.removeOccurrences(before, { courseId: 'math', date: '2026-09-14', scope: 'future' }, options());
  assert.equal(removed.affected, 2); assert.deepEqual(removed.state.courses[0].dates, ['2026-09-07']);
  assert.deepEqual(removed.state.importLedger.entries.slice(1).map(e => [e.tombstone, e.association]), [[true, null], [true, null]]);
  const merge = S.planMerge(removed.state, incoming(before), removed.state.importLedger); assert.equal(merge.stats.deletedLocally, 2); assert.equal(merge.stats.additions, 0);
  assert.deepEqual(removed.state.appliedUpdateIds, ['notice-preserved']);
  const all = E.removeOccurrences(before, { courseId: 'math', date: '2026-09-14', scope: 'all' }, options()); assert.deepEqual(all.state.courses, []); assert.ok(all.state.importLedger.entries.every(e => e.tombstone));
});

test('split occurrence series inherits course mute and reminder override without aliasing', () => {
  const before = withLedger(), request = { courseId: 'math', date: '2026-09-14', scope: 'one', changes: { room: 'B' } };
  const result = E.editOccurrences(before, request, options()), reminders = result.state.productSettings.reminders;
  assert.deepEqual(reminders.mutedCourseIds, ['math', result.courseId]);
  assert.deepEqual(reminders.courseOverrides[result.courseId], reminders.courseOverrides.math);
  reminders.courseOverrides[result.courseId].leadMinutes = 7;
  assert.equal(reminders.courseOverrides.math.leadMinutes, 30);
  assert.deepEqual(before.productSettings.reminders.mutedCourseIds, ['math']);
  const all = E.editOccurrences(before, { ...request, scope: 'all' }, options());
  assert.deepEqual(all.state.productSettings.reminders, before.productSettings.reminders);
});

test('split reminder inheritance fails before mutation when either exception list reaches 500', () => {
  const request = { courseId: 'math', date: '2026-09-14', scope: 'one', changes: { room: 'B' } };
  const muted = withLedger(); muted.productSettings.reminders.mutedCourseIds = ['math', ...Array.from({ length: 499 }, (_, i) => 'old-' + i)];
  const mutedOriginal = structuredClone(muted);
  assert.throws(() => E.editOccurrences(muted, request, options()), { code: 'REMINDER_LIMIT' }); assert.deepEqual(muted, mutedOriginal);
  const overridden = withLedger(); overridden.productSettings.reminders.mutedCourseIds = [];
  for (let i = 0; i < 499; i++) overridden.productSettings.reminders.courseOverrides['old-' + i] = { enabled: false };
  const overrideOriginal = structuredClone(overridden);
  assert.throws(() => E.editOccurrences(overridden, request, options()), { code: 'REMINDER_LIMIT' }); assert.deepEqual(overridden, overrideOriginal);
});

test('conflicts use actual daytime periods, night source times and exclusive time boundaries', () => {
  const input = state(); input.periods[2] = { start: '09:30', end: '10:10' }; input.courses[0].sourceTime = '17:00-18:00';
  const candidate = { ...course('new', ['2026-09-07']), start: 3, end: 3, sourceTime: '13:00-14:00' };
  const checked = E.detectConflicts(input, candidate); assert.equal(checked.status, 'conflict'); assert.equal(checked.conflicts[0].start, '08:00');
  input.periods[2] = { start: '09:40', end: '10:10' }; assert.equal(E.detectConflicts(input, candidate).status, 'clear');
  input.courses[0].start = 9; input.courses[0].end = 10; input.courses[0].sourceTime = '19:00-20:30';
  candidate.start = 9; candidate.end = 9; candidate.sourceTime = '20:00-20:45'; assert.equal(E.detectConflicts(input, candidate).status, 'conflict');
  candidate.sourceTime = '20:30-21:00'; assert.equal(E.detectConflicts(input, candidate).status, 'clear');
});

test('unconfirmed time is explicit and edited original occurrence is ignored, while other courses remain visible', () => {
  const input = state(), opts = options(); input.courses.push({ ...course('pending', ['2026-09-14']), start: null, end: null, timeMode: 'pending', timeNote: '以通知为准' });
  const result = E.editOccurrences(input, { courseId: 'math', date: '2026-09-14', scope: 'one', changes: { room: 'B' } }, opts);
  assert.deepEqual(result.conflicts, []); assert.equal(result.unconfirmed.length, 1); assert.equal(result.unconfirmed[0].courseId, 'pending'); assert.equal(result.conflictStatus, 'unconfirmed');
  const night = { ...course('night', ['2026-09-14']), start: 9, end: 10 }; assert.equal(E.detectConflicts({ ...input, courses: [] }, night).unconfirmed[0].detail, 'NIGHT_TIME_MISSING');
  input.courses.push(course('other', ['2026-09-14'])); const conflict = E.editOccurrences(input, { courseId: 'math', date: '2026-09-14', scope: 'one', changes: { room: 'B' } }, opts); assert.equal(conflict.conflicts[0].courseId, 'other');
});
