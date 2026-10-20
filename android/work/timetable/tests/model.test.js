'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../dist/model.js');
function fixture() {
  return { schemaVersion: 1, settings: { startMonday: null, totalWeeks: 24, termLabel: '测试学期', coverageStart: '2026-09-01', coverageEnd: '2027-01-31' }, periods: M.DEFAULT_PERIODS.map(p => ({ ...p })), courses: [
    { id: 'one', name: '示例力学', day: 1, start: 1, end: 2, room: 'A201', teacher: '', color: 'teal', dates: ['2026-10-05', '2026-10-12'], sourceTime: '08:30-10:05' }
  ] };
}
test('date arithmetic handles Sundays, leap days and year transitions without timezone shifts', () => {
  assert.equal(M.mondayOf('2026-10-11'), '2026-10-05');
  assert.equal(M.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(M.addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(M.parseISO('2026-02-29'), null);
  assert.equal(M.weekNumber('2026-10-11', '2026-09-07'), 5);
});
test('week parser accepts ranges and whole-expression parity and rejects invalid bounds', () => {
  assert.deepEqual(M.parseWeeks('1-6,8 单周', 24), [1, 3, 5]);
  assert.deepEqual(M.parseWeeks('第2—8周 双周', 24), [2, 4, 6, 8]);
  assert.deepEqual(M.parseWeeks('1，3、3，5', 24), [1, 3, 5]);
  assert.throws(() => M.parseWeeks('0-16', 24));
  assert.throws(() => M.parseWeeks('16-1', 24));
  assert.throws(() => M.parseWeeks('1-25', 24));
  assert.throws(() => M.parseWeeks('1-16 单双周', 24));
});
test('unknown first teaching week never repeats courses or invents week numbers', () => {
  const input = fixture();
  assert.throws(() => M.datesFromExpression('1-16', 1, input.settings), /第一周/);
  assert.deepEqual(M.datesFromExpression('2026-10-05, 2026-10-12', 1, input.settings), ['2026-10-05', '2026-10-12']);
  assert.throws(() => M.datesFromExpression('2026-10-06', 1, input.settings), /星期/);
  assert.equal(M.weekNumber('2026-10-05', null), null);
  const courses = M.validateState(input).courses;
  assert.equal(M.coursesOn(courses, '2026-10-19').length, 0);
  input.settings.startMonday = '2026-09-07';
  assert.deepEqual(M.datesFromExpression('1-3 单周', 7, input.settings), ['2026-09-13', '2026-09-27']);
});
test('backup validation rejects malformed records before any mutation', () => {
  const original = fixture(), originalJson = JSON.stringify(original);
  const valid = M.validateState(original);
  valid.courses[0].dates.push('2026-10-19');
  assert.equal(JSON.stringify(original), originalJson, 'validation must return an independent normalized copy');
  const mutators = [
    s => s.schemaVersion = 2,
    s => s.settings.startMonday = '2026-09-08',
    s => s.settings.coverageEnd = '2026-01-01',
    s => s.courses[0].dates = ['2026-10-06'],
    s => s.courses[0].dates = [],
    s => s.courses[0].start = 0,
    s => s.courses[0].end = 25,
    s => s.courses[0].color = 'constructor',
    s => s.courses[0].color = { unsafe: true },
    s => s.courses.push({ ...s.courses[0] }),
    s => s.periods[0].start = '08:99',
    s => s.courses[0].sourceTime = '20:05-18:30'
  ];
  for (const mutate of mutators) { const next = fixture(); mutate(next); assert.throws(() => M.validateState(next)); }
});
test('conflicts require both actual shared dates and overlapping periods', () => {
  const first = fixture().courses[0], differentDate = { ...first, id: 'two', dates: ['2026-10-19'] }, adjacent = { ...first, id: 'three', start: 3, end: 4 }, overlap = { ...first, id: 'four', start: 2, end: 3 };
  assert.deepEqual(M.conflictsFor([first, differentDate, adjacent, overlap], first).map(c => c.id), ['four']);
});
test('user daytime periods override portal time while evening preserves the known full source range', () => {
  const first = fixture().courses[0];
  assert.equal(M.timeRange(first, M.DEFAULT_PERIODS).text, '08:00–09:40');
  assert.equal(M.timeRange({ ...first, start: 9, end: 10, sourceTime: '18:30-20:05' }, M.DEFAULT_PERIODS).text, '18:30–20:05');
  assert.equal(M.timeRange({ ...first, start: 9, end: 10, sourceTime: '' }, M.DEFAULT_PERIODS).exact, false);
});
test('confirmed term start fills an empty local or imported setting without changing user data', () => {
  const stored = fixture(), seed = fixture();
  seed.settings.startMonday = '2026-08-31';
  stored.settings.theme = 'dark';
  stored.settings.totalWeeks = 20;
  stored.courses.push({ ...stored.courses[0], id: 'local-custom', name: '自习', color: '#123456', room: '图书馆', dates: ['2026-10-19'] });
  const before = JSON.stringify(stored), seedBefore = JSON.stringify(seed);
  const result = M.calibrateStartMonday(stored, seed);
  assert.equal(result.changed, true);
  assert.equal(result.state.settings.startMonday, '2026-08-31');
  assert.equal(result.state.settings.theme, 'dark');
  assert.equal(result.state.settings.totalWeeks, 20);
  assert.equal(result.state.schemaVersion, 1);
  assert.deepEqual(result.state.courses, M.validateState(stored).courses);
  assert.deepEqual(result.state.periods, stored.periods);
  assert.equal(JSON.stringify(stored), before, 'stored input is not mutated');
  assert.equal(JSON.stringify(seed), seedBefore, 'seed input is not mutated');
  assert.equal(M.calibrateStartMonday(result.state, seed).changed, false, 'calibration is idempotent');
  assert.equal(M.weekNumber('2026-10-11', result.state.settings.startMonday), 6);
  assert.equal(M.weekNumber('2026-10-12', result.state.settings.startMonday), 7);
});
test('term calibration preserves a nonempty manual start and does not guess another or unidentified term', () => {
  const seed = fixture(); seed.settings.startMonday = '2026-08-31';
  const cases = [
    state => { state.settings.startMonday = '2026-09-07'; },
    state => { state.settings.coverageStart = '2026-08-01'; },
    state => { state.settings.coverageEnd = '2026-12-31'; },
    state => { state.settings.coverageStart = null; state.settings.coverageEnd = null; }
  ];
  for (const change of cases) {
    const input = fixture(); change(input);
    const expected = M.validateState(input), result = M.calibrateStartMonday(input, seed);
    assert.equal(result.changed, false);
    assert.deepEqual(result.state, expected);
  }
  const unknownSeed = fixture();
  assert.equal(M.calibrateStartMonday(fixture(), unknownSeed).changed, false, 'an unconfirmed seed cannot fill the date');
});
test('term calibration validates both state and seed before any mutation', () => {
  const stored = fixture(), seed = fixture(), before = JSON.stringify(stored);
  seed.settings.startMonday = '2026-09-01';
  assert.throws(() => M.calibrateStartMonday(stored, seed), /周一/);
  assert.equal(JSON.stringify(stored), before);
  const invalid = fixture(); invalid.courses[0].dates = ['2026-10-06'];
  assert.throws(() => M.calibrateStartMonday(invalid, fixture()), /星期/);
});
const LAB_ID = 'notice-2026-engineering-mechanics-lab-class1';
function labSeed() {
  const seed = fixture(); seed.settings.startMonday = '2026-08-31';
  seed.appliedUpdateIds = [LAB_ID];
  seed.courses.push({ id: LAB_ID, name: '示例力学实验（1班）', day: 6, start: 5, end: 6, room: '', teacher: '', color: 'amber', dates: ['2026-10-31', '2026-11-07', '2026-11-21'], sourceTime: '14:00-15:40' });
  return seed;
}
test('update ids remain schema 1 compatible and are bounded, validated and deduplicated', () => {
  assert.deepEqual(M.validateState(fixture()).appliedUpdateIds, []);
  const input = fixture(); input.appliedUpdateIds = ['first', 'first', ' second '];
  assert.deepEqual(M.validateState(input).appliedUpdateIds, ['first', 'second']);
  assert.equal(M.validateState(input).schemaVersion, 1);
  for (const ids of [null, 'first', [1], [''], [' '.repeat(3)], ['x'.repeat(161)], Array.from({ length: 101 }, (_, i) => 'id-' + i)]) {
    const invalid = fixture(); invalid.appliedUpdateIds = ids;
    assert.throws(() => M.validateState(invalid), /更新/);
  }
});
test('seed notice fills an old customized timetable once and preserves existing edits and settings', () => {
  const old = fixture(), seed = labSeed();
  old.settings.theme = 'dark'; old.settings.totalWeeks = 20;
  old.courses[0].room = '自改教室'; old.courses[0].color = '#123456';
  const oldBefore = JSON.stringify(old), seedBefore = JSON.stringify(seed);
  const result = M.applySeedUpdates(old, seed), lab = result.state.courses.find(course => course.id === LAB_ID);
  assert.equal(result.changed, true);
  assert.equal(result.state.settings.startMonday, '2026-08-31');
  assert.equal(result.state.settings.theme, 'dark');
  assert.equal(result.state.settings.totalWeeks, 20);
  assert.deepEqual(result.state.courses[0], M.validateState(old).courses[0]);
  assert.deepEqual(lab.dates, ['2026-10-31', '2026-11-07', '2026-11-21']);
  assert.deepEqual(result.state.appliedUpdateIds, [LAB_ID]);
  assert.equal(M.timeRange(lab, result.state.periods).text, '14:00–15:40');
  assert.deepEqual(lab.dates.map(date => M.weekNumber(date, result.state.settings.startMonday)), [9, 10, 12]);
  const repeat = M.applySeedUpdates(result.state, seed);
  assert.equal(repeat.changed, false); assert.deepEqual(repeat.state, result.state);
  assert.equal(JSON.stringify(old), oldBefore); assert.equal(JSON.stringify(seed), seedBefore);
});
test('acknowledged notice does not restore a subsequently deleted or edited experiment', () => {
  const seed = labSeed(), once = M.applySeedUpdates(fixture(), seed).state;
  const deleted = JSON.parse(JSON.stringify(once)); deleted.courses = deleted.courses.filter(course => course.id !== LAB_ID);
  const afterDeletion = M.applySeedUpdates(deleted, seed);
  assert.equal(afterDeletion.changed, false); assert.deepEqual(afterDeletion.state, deleted);
  const edited = JSON.parse(JSON.stringify(once)), lab = edited.courses.find(course => course.id === LAB_ID);
  lab.name = '自改实验'; lab.room = '自选教室'; lab.dates = ['2026-11-07'];
  assert.deepEqual(M.applySeedUpdates(edited, seed).state, edited);
});
test('a pre-existing notice id is acknowledged without overwriting its deliberate changes', () => {
  const old = fixture(), seed = labSeed(), existing = { ...seed.courses[1], name: '我的实验', dates: ['2026-11-07'], room: '保留房间' };
  old.courses.push(existing); old.settings.startMonday = '2026-09-07';
  const result = M.applySeedUpdates(old, seed);
  assert.equal(result.changed, true);
  assert.equal(result.state.settings.startMonday, '2026-09-07');
  assert.deepEqual(result.state.courses.find(course => course.id === LAB_ID), existing);
  assert.deepEqual(result.state.appliedUpdateIds, [LAB_ID]);
});
test('equivalent experiment names deduplicate matching dates and periods and add only missing dates', () => {
  const old = fixture(), seed = labSeed(), base = seed.courses[1];
  old.courses.push({ ...base, id: 'manual-lab', name: '示例力学实验(1班)', dates: ['2026-10-31'] });
  old.courses.push({ ...base, id: 'other-lab', name: '示例力学实验', dates: ['2026-11-07'] });
  const result = M.applySeedUpdates(old, seed);
  assert.deepEqual(result.state.courses.find(course => course.id === LAB_ID).dates, ['2026-11-21']);
  assert.equal(result.state.courses.filter(course => course.dates.includes('2026-10-31')).length, 1);
  const fullyCovered = fixture(); fullyCovered.courses.push({ ...base, id: 'full-manual-lab', name: '示例力学实验' });
  const full = M.applySeedUpdates(fullyCovered, seed);
  assert.equal(full.state.courses.some(course => course.id === LAB_ID), false);
  assert.deepEqual(full.state.appliedUpdateIds, [LAB_ID]);
  const differentPeriods = fixture(); differentPeriods.courses.push({ ...base, id: 'morning-lab', start: 1, end: 2 });
  assert.deepEqual(M.applySeedUpdates(differentPeriods, seed).state.courses.find(course => course.id === LAB_ID).dates, base.dates);
});
test('seed notices do not affect other terms and reject invalid data without mutating inputs', () => {
  const seed = labSeed(), other = fixture(); other.settings.coverageStart = '2025-09-01';
  const result = M.applySeedUpdates(other, seed);
  assert.equal(result.changed, false); assert.deepEqual(result.state, M.validateState(other));
  const invalid = fixture(); invalid.appliedUpdateIds = [null]; const before = JSON.stringify(invalid), seedBefore = JSON.stringify(seed);
  assert.throws(() => M.applySeedUpdates(invalid, seed), /更新/);
  assert.equal(JSON.stringify(invalid), before); assert.equal(JSON.stringify(seed), seedBefore);
  const badSeed = labSeed(); badSeed.courses[1].dates = ['2026-11-08'];
  const validInput = fixture(), validBefore = JSON.stringify(validInput);
  assert.throws(() => M.applySeedUpdates(validInput, badSeed), /星期/);
  assert.equal(JSON.stringify(validInput), validBefore);
});
function pendingPhysics(overrides = {}) {
  return { id: 'pending-physics', name: '示例物理实验', day: 4, start: null, end: null, room: '实验室', teacher: '', color: 'blue', dates: ['2026-11-19', '2026-11-26'], sourceTime: '', timeMode: 'pending', timeNote: '19:00开始，结束时间待确认', ...overrides };
}
test('pending course validation preserves unknown periods and time note while ordinary course shape stays compatible', () => {
  const input = fixture(); input.courses.push(pendingPhysics());
  const before = JSON.stringify(input), state = M.validateState(input), pending = state.courses[1];
  assert.equal(pending.timeMode, 'pending');
  assert.equal(pending.start, null); assert.equal(pending.end, null);
  assert.deepEqual(M.timeRange(pending, state.periods), { start: null, end: null, text: '19:00开始，结束时间待确认', exact: false });
  assert.deepEqual(pending.dates, input.courses[1].dates);
  assert.equal(Object.hasOwn(state.courses[0], 'timeMode'), false);
  assert.equal(Object.hasOwn(state.courses[0], 'timeNote'), false);
  const explicit = fixture(); explicit.courses[0].timeMode = 'periods'; explicit.courses[0].timeNote = '过期说明';
  assert.deepEqual(M.validateState(explicit).courses[0], M.validateState(fixture()).courses[0]);
  assert.equal(JSON.stringify(input), before);
});
test('pending course validation rejects guessed periods, missing notes and unknown modes', () => {
  const badRecords = [
    { start: 9 }, { end: 10 }, { start: undefined }, { end: undefined },
    { timeNote: '' }, { timeNote: '  ' }, { timeNote: null }, { timeNote: 1900 }, { timeNote: '字'.repeat(161) },
    { timeMode: 'estimated' }, { timeMode: null }, { dates: ['2026-11-20'] }
  ];
  for (const overrides of badRecords) { const input = fixture(); input.courses.push(pendingPhysics(overrides)); assert.throws(() => M.validateState(input)); }
  const boundary = fixture(); boundary.courses.push(pendingPhysics({ timeNote: '字'.repeat(160) }));
  assert.equal(M.validateState(boundary).courses[1].timeNote.length, 160);
});
test('pending entries follow confirmed courses and are excluded from automatic conflict claims in both directions', () => {
  const input = fixture(), date = '2026-11-19', confirmed = { ...input.courses[0], id: 'night', day: 4, start: 9, end: 10, dates: [date], sourceTime: '18:30-20:05' }, overlap = { ...confirmed, id: 'overlap' }, morning = { ...confirmed, id: 'morning', start: 1, end: 2, sourceTime: '' }, pending = pendingPhysics();
  const courses = [pending, confirmed, overlap, morning];
  assert.deepEqual(M.coursesOn(courses, date).map(course => course.id), ['morning', 'night', 'overlap', 'pending-physics']);
  assert.deepEqual(M.conflictsFor(courses, pending), []);
  assert.deepEqual(M.conflictsFor(courses, confirmed).map(course => course.id), ['overlap']);
});
test('pending seed updates deduplicate same-name same-note dates without collapsing different notes or confirmed courses', () => {
  const seed = fixture(); seed.settings.startMonday = '2026-08-31';
  const update = pendingPhysics({ id: 'physics-notice' }); seed.courses.push(update); seed.appliedUpdateIds = [update.id];
  const old = fixture(); old.courses.push(pendingPhysics({ id: 'manual-physics', dates: ['2026-11-19'] }));
  const result = M.applySeedUpdates(old, seed);
  assert.deepEqual(result.state.courses.find(course => course.id === update.id).dates, ['2026-11-26']);
  assert.deepEqual(result.state.appliedUpdateIds, [update.id]);
  assert.equal(M.applySeedUpdates(result.state, seed).changed, false);
  const differentNote = fixture(); differentNote.courses.push(pendingPhysics({ id: 'manual-note', timeNote: '19:30开始，结束时间待确认' }));
  assert.deepEqual(M.applySeedUpdates(differentNote, seed).state.courses.find(course => course.id === update.id).dates, update.dates);
  const confirmed = fixture(); confirmed.courses.push({ ...pendingPhysics({ id: 'manual-confirmed' }), timeMode: 'periods', start: 9, end: 10, sourceTime: '19:00-20:30' });
  assert.deepEqual(M.applySeedUpdates(confirmed, seed).state.courses.find(course => course.id === update.id).dates, update.dates);
  const deleted = result.state; deleted.courses = deleted.courses.filter(course => course.id !== update.id);
  assert.equal(M.applySeedUpdates(deleted, seed).state.courses.some(course => course.id === update.id), false);
});
test('an existing pending notice id protects user edits and different terms receive no pending update', () => {
  const seed = fixture(), update = pendingPhysics({ id: 'physics-notice' }); seed.courses.push(update); seed.appliedUpdateIds = [update.id];
  const old = fixture(), edited = pendingPhysics({ id: update.id, timeNote: '20:00开始，待补结束时间', dates: ['2026-11-19'] }); old.courses.push(edited);
  const result = M.applySeedUpdates(old, seed);
  assert.deepEqual(result.state.courses.find(course => course.id === update.id), edited);
  assert.deepEqual(result.state.appliedUpdateIds, [update.id]);
  const other = fixture(); other.settings.coverageStart = '2025-09-01';
  assert.equal(M.applySeedUpdates(other, seed).changed, false);
  assert.equal(M.applySeedUpdates(other, seed).state.courses.some(course => course.timeMode === 'pending'), false);
});
