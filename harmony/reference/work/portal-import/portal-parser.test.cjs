const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const P = require('./portal-parser.js');
const M = require('../timetable/dist/model.js');
const { evidenceFixture } = require('./fixtures.cjs');
const F = evidenceFixture();
const clone = value => JSON.parse(JSON.stringify(value));
const normalize = capture => P.normalizeCapture(capture, F.initial.settings, F.initial.periods);
const normalizeOne = row => normalize({ ...F.capture, rows: [row] });
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
function expanded(courses) { return courses.flatMap(c => c.dates.map(date => [date, c.name, c.sourceTime].join('|'))).sort(); }

test('anonymized 168 rows / 18 sampled heading signatures normalize without lost dates', () => {
  const input = freeze(clone(F.capture)), periods = freeze(clone(F.initial.periods)), settings = freeze(clone(F.initial.settings));
  const result = P.normalizeCapture(input, settings, periods);
  assert.equal(F.rows.length, 168); assert.equal(F.details.length, 18);
  assert.equal(result.courses.length, 20);
  assert.equal(result.stats.acceptedRows, 168); assert.equal(result.stats.rejectedRows, 0);
  assert.equal(result.stats.uniqueMeetings, 168); assert.equal(result.scope.complete, true);
  assert.deepEqual(expanded(result.courses), F.rows.map(r => [r.date, r.name, r.time].join('|')).sort());
  assert.equal(result.warnings.filter(w => w.code === 'ROOM_NOT_SPECIFIED').length, 9);
  assert.ok(result.courses.every(c => /^just-[0-9a-f]{16}$/.test(c.id)));
  assert.match(F.note, /未逐日核对/);
  assert.doesNotThrow(() => M.validateState({ ...F.initial, courses: result.courses }));
});

test('stable IDs and grouping do not depend on DOM row order', () => {
  const first = normalize(F.capture), reversed = normalize({ ...F.capture, rows: [...F.capture.rows].reverse() });
  assert.deepEqual(first.courses, reversed.courses);
});

test('both real detail formats parse teachers and the correct period-specific rooms', () => {
  const result = normalize(F.capture);
  const physics = result.courses.find(c => c.name === '示例物理2' && c.start === 1);
  assert.equal(physics.room, '示例教学楼A-101'); assert.equal(physics.teacher, '示例教师05');
  const linear = result.courses.filter(c => c.name === '示例数学');
  assert.equal(linear.find(c => c.start === 1).room, '示例教学楼BB-303');
  assert.equal(linear.find(c => c.start === 3).room, '示例教学楼BB-304');
});

test('user daytime periods remain in force and explicit evening source time survives', () => {
  const result = normalize(F.capture);
  const day = result.courses.find(c => c.start === 1), night = result.courses.find(c => c.start === 9);
  assert.equal(day.sourceTime, '08:30-10:05'); assert.equal(M.timeRange(day, F.initial.periods).text, '08:00–09:40');
  assert.equal(M.timeRange(night, F.initial.periods).text, '18:30–20:05');
  assert.deepEqual(F.initial.periods, M.DEFAULT_PERIODS);
});

test('strict dates and declared scope reject malformed or out-of-scope rows', () => {
  for (const [date, code] of [['2026-02-30', 'DATE_INVALID'], ['2026-9-01', 'DATE_INVALID'], ['1899-12-31', 'DATE_INVALID'], ['2027-02-01', 'DATE_OUTSIDE_SCOPE']]) {
    const result = normalizeOne({ ...F.capture.rows[0], date });
    assert.equal(result.courses.length, 0); assert.equal(result.stats.rejectedRows, 1);
    assert.equal(result.warnings[0].code, code); assert.equal(result.scope.complete, false);
  }
});

test('missing detail or period is rejected; no timing or week recurrence is inferred', () => {
  const missing = normalizeOne({ ...F.capture.rows[0], detailRaw: [] });
  assert.equal(missing.warnings[0].code, 'DETAIL_MISSING_OR_INVALID');
  const noPeriod = normalizeOne({ ...F.capture.rows[0], detailRaw: ['示例物理2', '上课地点：示例教学楼A-101'] });
  assert.equal(noPeriod.warnings[0].code, 'DETAIL_PERIOD_MISSING');
  const sparse = normalize({ ...F.capture, rows: [F.capture.rows[0], F.capture.rows.find(r => r.name === '示例物理2' && r.date === '2026-09-14' && r.sourceTime === '08:30-10:05')] });
  assert.deepEqual(sparse.courses[0].dates, ['2026-08-31', '2026-09-14']);
});

test('mismatched names, conflicting details, and known source/period disagreement reject', () => {
  const row = F.capture.rows[0];
  assert.equal(normalizeOne({ ...row, name: '另一门课' }).warnings[0].code, 'DETAIL_NAME_MISMATCH');
  assert.equal(normalizeOne({ ...row, detailRaw: [...row.detailRaw, '节次：3-4 老师：示例教师05'] }).warnings[0].code, 'DETAIL_CONFLICT');
  assert.equal(normalizeOne({ ...row, sourceTime: '10:25-12:00' }).warnings[0].code, 'PERIOD_SOURCE_TIME_CONFLICT');
});

test('missing daytime source time warns, missing evening time rejects', () => {
  const day = normalizeOne({ ...F.capture.rows[0], sourceTime: '' });
  assert.equal(day.stats.acceptedRows, 1); assert.ok(day.warnings.some(w => w.code === 'SOURCE_TIME_MISSING_DAYTIME_USES_PERSONAL_PERIODS'));
  const night = F.capture.rows.find(r => r.sourceTime === '18:30-20:05');
  assert.equal(normalizeOne({ ...night, sourceTime: '' }).warnings[0].code, 'NIGHT_TIME_MISSING');
  assert.equal(normalizeOne({ ...night, sourceTime: '19:00开始' }).warnings[0].code, 'SOURCE_TIME_INVALID');
});

test('missing room and teacher are distinguished from an explicitly blank room', () => {
  const row = F.capture.rows[0], result = normalizeOne({ ...row, detailRaw: ['示例物理2', '节次：1-2'] });
  assert.equal(result.courses[0].room, ''); assert.equal(result.courses[0].teacher, '');
  assert.deepEqual(result.warnings.map(w => w.code), ['ROOM_NOT_OBSERVED', 'TEACHER_NOT_SPECIFIED']);
  assert.equal(normalize(F.capture).courses.find(c => c.name === '示例运动3').room, '');
});

test('duplicate input rows do not duplicate meetings; incomplete capture remains incomplete', () => {
  const row = F.capture.rows[0], result = normalize({ ...F.capture, rows: [row, row], scope: { ...F.capture.scope, complete: false } });
  assert.equal(result.stats.sourceRows, 2); assert.equal(result.stats.acceptedRows, 1); assert.equal(result.stats.duplicateRows, 1);
  assert.equal(result.scope.complete, false); assert.ok(result.warnings.some(w => w.code === 'SCOPE_INCOMPLETE'));
});

test('empty complete month is valid and contract validation fails explicitly', () => {
  assert.equal(normalize({ ...F.capture, rows: [] }).courses.length, 0);
  assert.throws(() => normalize({ ...F.capture, source: 'guessed-api' }), { code: 'CAPTURE_INVALID' });
  assert.throws(() => normalize({ ...F.capture, scope: { from: '2026-10-01', to: '2026-09-01', complete: true } }), { code: 'SCOPE_INVALID' });
  assert.throws(() => P.normalizeCapture(F.capture, F.initial.settings, []), { code: 'PERSONAL_PERIODS_INVALID' });
});

test('portal strings remain literal text; module does not execute or interpret HTML', () => {
  const name = '<img src=x onerror=alert(1)>', row = { date: '2026-09-01', name, sourceTime: '', detailRaw: [name, '地点：<script>alert(1)</script>', '节次：1-2 老师：<b>教师</b>'] };
  const result = normalizeOne(row);
  assert.equal(result.courses[0].name, name); assert.equal(result.courses[0].room, '<script>alert(1)</script>');
  assert.equal(result.courses[0].teacher, '<b>教师</b>');
  assert.doesNotMatch(fs.readFileSync(require.resolve('./portal-parser.js'), 'utf8'), /innerHTML|eval\(|new Function|fetch\(/);
});

test('reimport of all 168 portal dates adds nothing and preserves 13 experiments by reference', () => {
  const state = freeze(clone(F.initial)), candidates = freeze(normalize(F.capture).courses);
  const result = P.planImport(state, candidates);
  assert.equal(result.stats.exactSkippedMeetings, 168); assert.equal(result.stats.addedMeetings, 0);
  assert.equal(result.nextState.settings, state.settings); assert.equal(result.nextState.periods, state.periods);
  assert.equal(result.nextState.appliedUpdateIds, state.appliedUpdateIds);
  state.courses.forEach((course, index) => assert.equal(result.nextState.courses[index], course));
  const labs = result.nextState.courses.filter(c => c.id.startsWith('notice-'));
  assert.equal(labs.reduce((n, c) => n + c.dates.length, 0), 13);
  assert.equal(labs.filter(c => c.timeMode === 'pending').reduce((n, c) => n + c.dates.length, 0), 5);
});

test('first import adds all actual meetings without mutating candidate or existing settings', () => {
  const state = freeze({ ...F.initial, courses: [] }), candidate = freeze(normalize(F.capture).courses), result = P.planImport(state, candidate);
  assert.equal(result.stats.addedMeetings, 168); assert.equal(result.stats.addedCourses, 20);
  assert.equal(result.nextState.periods, state.periods); assert.equal(result.nextState.settings, state.settings);
  assert.doesNotThrow(() => M.validateState(result.nextState));
  assert.equal(P.planImport(result.nextState, candidate).stats.addedMeetings, 0);
});

test('local room/teacher edits are warned as possible changes and skipped', () => {
  const course = clone(normalize(F.capture).courses[0]), edited = freeze({ ...course, room: '我的调课教室', teacher: '我的教师' });
  const state = freeze({ ...F.initial, courses: [edited] }), result = P.planImport(state, [course]);
  assert.equal(result.stats.possibleChangesSkippedMeetings, course.dates.length);
  assert.equal(result.stats.addedMeetings, 0); assert.equal(result.nextState.courses[0], edited);
  assert.ok(result.warnings.every(w => w.code === 'POSSIBLE_PORTAL_ADJUSTMENT_SKIPPED'));
});

test('partial same-ID import appends missing dates with a distinct stable ID', () => {
  const course = normalize(F.capture).courses.find(c => c.dates.length > 2), partial = freeze({ ...course, dates: [course.dates[0]] });
  const state = freeze({ ...F.initial, courses: [partial] }), result = P.planImport(state, [course]);
  assert.equal(result.stats.addedMeetings, course.dates.length - 1); assert.equal(result.stats.exactSkippedMeetings, 1);
  assert.equal(result.nextState.courses[0], partial); assert.notEqual(result.additions[0].id, partial.id);
  assert.equal(P.planImport(state, [course]).additions[0].id, result.additions[0].id);
  assert.doesNotThrow(() => M.validateState(result.nextState));
});

test('same candidate date/period with changed room is not added twice', () => {
  const first = clone(normalize(F.capture).courses[0]); first.dates = [first.dates[0]];
  const second = { ...first, id: 'just-other', room: '另一个房间' };
  const result = P.planImport({ ...F.initial, courses: [] }, [first, second]);
  assert.equal(result.stats.addedMeetings, 1); assert.equal(result.stats.possibleChangesSkippedMeetings, 1);
});

test('invalid candidates and repeated dates are explicitly counted', () => {
  const course = clone(normalize(F.capture).courses[0]); course.dates = [course.dates[0], course.dates[0]];
  const invalid = { ...course, id: 'invalid', room: 123 };
  const result = P.planImport({ ...F.initial, courses: [] }, [course, invalid]);
  assert.equal(result.stats.addedMeetings, 1); assert.equal(result.stats.duplicateCandidateDates, 1);
  assert.equal(result.stats.invalidCourses, 1); assert.equal(result.stats.rejectedMeetings, 2);
  assert.equal(result.stats.candidateMeetings, 4);
});

test('UMD browser mode exposes the same pure API', () => {
  const context = vm.createContext({}); vm.runInContext(fs.readFileSync(require.resolve('./portal-parser.js'), 'utf8'), context);
  assert.equal(typeof context.JustPortalImport.normalizeCapture, 'function'); assert.equal(typeof context.JustPortalImport.planImport, 'function');
});
