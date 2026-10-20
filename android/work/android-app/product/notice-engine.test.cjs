'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('./notice-engine.js');
const M = require('../../timetable/dist/model.js');

const context = { startMonday: '2026-08-31', totalWeeks: 26, classNumber: 1 };
const mechanics = '示例力学实验 第9、10、12周，周六下午5-6节（1班）、7-8节（2班）、9-10节（3班）！地点：实验1+实验2（示例实验楼118）、实验3（示例实验楼207）。';
const electrician = '电工1第12周周四5-6节下课后(第一批)+晚上(第二批)+周五5-6节下课后(第三批);第13,14,15,16周周四下午+晚上';
function state(courses = []) {
  return { schemaVersion: 1, settings: { startMonday: '2026-08-31', totalWeeks: 26, termLabel: '测试学期', coverageStart: null, coverageEnd: null, theme: 'auto' }, periods: M.DEFAULT_PERIODS.map(p => ({ ...p })), courses, appliedUpdateIds: [], customPreserved: { value: 7 } };
}
function rows(text = '机器人技术 第9-12周周六第5-6节地点示例实验楼118。', overrides = {}) {
  return E.parse(text, { ...context, ...overrides }).drafts;
}
function confirmed(drafts) { return drafts.map(draft => ({ ...draft, confirmed: true })); }
function hasWarning(result, code) { return result.warnings.some(w => w.code === code); }
function throwsCode(fn, code) { assert.throws(fn, error => error.code === code); }

test('the exact mechanics notice selects class 1 without inventing week/lab mapping', () => {
  const result = E.parse(mechanics, context);
  assert.deepEqual(result.drafts.map(d => [d.name, d.week, d.date, d.day, d.start, d.end]), [
    ['示例力学实验', 9, '2026-10-31', 6, 5, 6],
    ['示例力学实验', 10, '2026-11-07', 6, 5, 6],
    ['示例力学实验', 12, '2026-11-21', 6, 5, 6]
  ]);
  assert.ok(result.drafts.every(d => d.room === '' && d.confirmed === false && d.issues.includes('ROOM_MAPPING_UNCLEAR')));
  assert.ok(hasWarning(result, 'ROOM_MAPPING_UNCLEAR'));
});

test('room order is used only with an explicit ordered laboratory statement', () => {
  const result = E.parse('示例力学实验 第9、10、12周依次进行实验1、实验2、实验3，周六下午5-6节(1班)。地点：实验1+实验2(示例实验楼118)、实验3(示例实验楼207)。', context);
  assert.deepEqual(result.drafts.map(d => [d.week, d.labNumber, d.room]), [[9, 1, '示例实验楼118'], [10, 2, '示例实验楼118'], [12, 3, '示例实验楼207']]);
  assert.ok(!hasWarning(result, 'ROOM_MAPPING_UNCLEAR'));
});

test('explicit week/lab pairs carry their own rooms across scopes', () => {
  const result = E.parse('示例力学实验 第9周实验1，周六5-6节；第10周实验2，周六5-6节；第12周实验3，周六5-6节。地点：实验1+实验2(示例实验楼118)、实验3(示例实验楼207)。', context);
  assert.deepEqual(result.drafts.map(d => [d.week, d.room]), [[9, '示例实验楼118'], [10, '示例实验楼118'], [12, '示例实验楼207']]);
});

test('different explicit rooms in different week scopes remain separate', () => {
  const result = E.parse('机器人实验 第9周周六5-6节地点A101；第10周周六5-6节地点B202。', context);
  assert.deepEqual(result.drafts.map(d => [d.week, d.room]), [[9, 'A101'], [10, 'B202']]);
});

test('class 2 is filtered correctly; unknown class retains labelled alternatives', () => {
  assert.ok(rows(mechanics, { classNumber: 2 }).every(d => d.start === 7 && d.end === 8));
  const result = E.parse(mechanics, { ...context, classNumber: null });
  assert.equal(result.drafts.length, 9);
  assert.ok(hasWarning(result, 'CLASS_REQUIRED'));
});

test('the exact electrician notice never converts after-class to periods 7-8', () => {
  const result = E.parse(electrician, { ...context, batchNumber: 1 });
  const first = result.drafts.filter(d => d.week === 12);
  assert.equal(first.length, 1);
  assert.deepEqual([first[0].date, first[0].day, first[0].start, first[0].end, first[0].timeMode], ['2026-11-19', 4, null, null, 'pending']);
  assert.deepEqual(first[0].referencePeriods, { start: 5, end: 6 });
  assert.ok(first[0].timeNote.includes('下课后'));
  assert.ok(hasWarning(result, 'AFTER_CLASS_TIME_UNCLEAR'));
  assert.ok(hasWarning(result, 'BATCH_MAPPING_UNCLEAR'));
  assert.equal(result.drafts.length, 9, 'unlabelled afternoon/evening remain independent candidate rows');
  assert.ok(result.drafts.every(d => d.start === null && d.end === null));
  assert.ok(result.drafts.filter(d => d.week > 12).every(d => d.issues.includes('BATCH_MAPPING_UNCLEAR')));
});

test('batch 2 evening is pending, not automatically periods 9-10', () => {
  const first = E.parse(electrician, { ...context, batchNumber: 2 }).drafts.find(d => d.week === 12);
  assert.deepEqual([first.day, first.start, first.end, first.timeMode, first.timeNote], [4, null, null, 'pending', '晚上']);
});

test('straightforward explicit period ranges and full-width punctuation parse exactly', () => {
  const result = rows('机器人技术 第９－１２周，星期六，第５－６节，地点：示例实验楼118。');
  assert.deepEqual(result.map(d => d.week), [9, 10, 11, 12]);
  assert.ok(result.every(d => d.name === '机器人技术' && d.day === 6 && d.start === 5 && d.end === 6 && d.room === '示例实验楼118'));
});

test('odd/even filtering and Chinese-number ranges follow teaching-week parity', () => {
  assert.deepEqual(rows('机器人实验 第九至十二周（单周）周六第五至六节地点A101').map(d => d.week), [9, 11]);
  assert.deepEqual(rows('机器人实验 第9-12周(双周)周六5-6节地点A101').map(d => d.week), [10, 12]);
  assert.deepEqual(rows('机器人实验 第9周、第10周、第12周周六5-6节地点A101').map(d => d.week), [9, 10, 12]);
});

test('explicit context course names are preserved, including engineering distinctions', () => {
  assert.equal(rows('机械设计 第9周周六5-6节地点A101', { courseName: '机器人技术及应用' })[0].name, '机器人技术及应用');
  assert.equal(rows('机械设计 第9周周六5-6节地点A101')[0].name, '机械设计');
  assert.equal(rows('通知系统及星期教学 到场实验 第9周周六5-6节地点A101')[0].name, '通知系统及星期教学 到场实验');
});

test('explicit plural class lists and classes before weekdays select the intended event', () => {
  assert.equal(rows('机器人实验 第9周周六5-6节(1、2班)地点A101', { classNumber: 1 }).length, 1);
  const prefix = rows('机器人实验 第9周1班周六5-6节，2班周日7-8节地点A101', { classNumber: 1 });
  assert.equal(prefix.length, 1);
  assert.deepEqual([prefix[0].day, prefix[0].start, prefix[0].end], [6, 5, 6]);
});

test('missing term Monday never uses the computer date or guesses a calendar', () => {
  const result = E.parse('工程实验 第9周周六5-6节地点A101', { totalWeeks: 26 });
  assert.equal(result.drafts[0].date, null);
  assert.ok(hasWarning(result, 'START_MONDAY_REQUIRED'));
  assert.ok(E.plan(state(), result.drafts).errors.some(e => e.code === 'DATE_REQUIRED'));
});

test('missing weekday retains an editable candidate without guessing Saturday', () => {
  const result = E.parse('工程实验 第9周5-6节地点A101', context);
  assert.equal(result.drafts[0].day, null);
  assert.equal(result.drafts[0].date, null);
  assert.ok(hasWarning(result, 'DAY_REQUIRED'));
});

test('complete calendar dates work without term Monday; missing years remain unresolved', () => {
  const result = E.parse('机器人实验 2026年10月31日第5-6节地点A101', { totalWeeks: 26 });
  assert.deepEqual([result.drafts[0].date, result.drafts[0].day], ['2026-10-31', 6]);
  const short = E.parse('机器人实验 10月31日周六5-6节地点A101', context);
  assert.equal(short.drafts[0].date, null);
  assert.ok(hasWarning(short, 'DATE_YEAR_REQUIRED'));
});

test('invalid dates, weekday disagreements, and week disagreements remain unresolved', () => {
  const invalid = E.parse('机器人实验 2026-02-30周六5-6节地点A101', context);
  assert.equal(invalid.drafts[0].date, null);
  assert.ok(hasWarning(invalid, 'DATE_INVALID'));
  const wrongDay = E.parse('机器人实验 2026-10-31周五5-6节地点A101', context);
  assert.equal(wrongDay.drafts[0].date, null);
  assert.ok(hasWarning(wrongDay, 'DATE_DAY_MISMATCH'));
  const wrongWeek = E.parse('机器人实验 第9周(2026-11-07)周六5-6节地点A101', context);
  assert.equal(wrongWeek.drafts[0].date, null);
  assert.ok(hasWarning(wrongWeek, 'DATE_WEEK_MISMATCH'));
});

test('noncontinuous periods and week alternatives do not become contiguous fixed events', () => {
  const periods = E.parse('机器人实验 第9周周六第5、7节地点A101', context);
  assert.equal(periods.drafts[0].timeMode, 'pending');
  assert.ok(hasWarning(periods, 'PERIODS_INVALID'));
  const alternatives = E.parse('机器人实验 第9或10周周六5-6节地点A101', context);
  assert.equal(alternatives.drafts[0].date, null);
  assert.ok(hasWarning(alternatives, 'WEEK_ALTERNATIVE_UNCLEAR'));
});

test('a changed or cancelled notice always exposes a review warning', () => {
  const result = E.parse('机器人实验 第9周周六5-6节取消，地点A101', context);
  assert.ok(hasWarning(result, 'NOTICE_CHANGE_REQUIRES_REVIEW'));
  assert.ok(result.drafts.every(d => d.confirmed === false));
});

test('plan is immutable; merge requires explicit row confirmation', () => {
  const original = state(), drafts = rows(), snapshot = JSON.stringify({ original, drafts });
  const preview = E.plan(original, drafts);
  assert.equal(preview.additions.length, 4);
  assert.equal(preview.canCommit, false);
  throwsCode(() => E.merge(original, drafts), 'CONFIRMATION_REQUIRED');
  assert.equal(JSON.stringify({ original, drafts }), snapshot);
  const result = E.merge(original, confirmed(drafts), { validateState: M.validateState });
  assert.deepEqual(result.summary, { added: 4, duplicates: 0, conflicts: 0 });
  assert.equal(original.courses.length, 0);
  assert.deepEqual(result.state.customPreserved, { value: 7 });
  assert.equal(M.validateState(result.state).courses.length, 4);
});

test('deterministic identifiers and semantic duplicate detection make reimports idempotent', () => {
  const first = E.merge(state(), confirmed(rows()));
  const second = E.merge(first.state, confirmed(rows('机器人技术 第9、10、11、12周周六5-6节地点示例实验楼118。')));
  assert.deepEqual(second.summary, { added: 0, duplicates: 4, conflicts: 0 });
  assert.deepEqual(first.state.courses, second.state.courses);
  assert.ok(first.state.courses.every(c => /^manual-notice-[0-9a-f]{16}$/.test(c.id)));
  const again = E.merge(state(), confirmed(rows()));
  assert.deepEqual(again.state.courses.map(c => c.id), first.state.courses.map(c => c.id));
});

test('duplicates in the same incoming batch are counted once', () => {
  const drafts = confirmed(rows('机器人实验 第9周周六5-6节地点A101'));
  const result = E.merge(state(), [drafts[0], { ...drafts[0], draftId: 'repeat' }]);
  assert.deepEqual(result.summary, { added: 1, duplicates: 1, conflicts: 0 });
});

test('an already existing different identifier with the same occurrence is a duplicate', () => {
  const original = E.merge(state(), confirmed(rows('机器人实验 第9周周六5-6节地点A101'))).state;
  original.courses[0].id = 'existing-user-course';
  const result = E.merge(original, confirmed(rows('机器人实验 第9周周六5-6节地点A101')));
  assert.deepEqual(result.summary, { added: 0, duplicates: 1, conflicts: 0 });
});

test('period overlaps are previewed and require explicit conflict acknowledgement', () => {
  const existing = E.merge(state(), confirmed(rows('理论课 第9周周六6-7节地点A101'))).state;
  const incoming = confirmed(rows('机器人实验 第9周周六5-6节地点A102'));
  const preview = E.plan(existing, incoming);
  assert.equal(preview.conflicts.length, 1);
  assert.equal(preview.conflicts[0].type, 'period-overlap');
  throwsCode(() => E.merge(existing, incoming), 'CONFLICT_CONFIRMATION_REQUIRED');
  const result = E.merge(existing, incoming, { allowConflicts: true });
  assert.equal(result.state.courses.length, 2);
  assert.equal(existing.courses.length, 1);
});

test('pending times expose uncertain same-date overlaps; adjacent periods do not clash', () => {
  const existing = E.merge(state(), confirmed(rows('理论课 第9周周六3-4节地点A101'))).state;
  assert.equal(E.plan(existing, rows('机器人实验 第9周周六5-6节地点A102')).conflicts.length, 0);
  const preview = E.plan(existing, rows('机器人实验 第9周周六下午地点A102'));
  assert.equal(preview.conflicts[0].type, 'time-unresolved');
});

test('night courses use actual clock overlap rather than nominal period numbers', () => {
  const baseDraft = confirmed(rows('晚间实验 第9周周六9-10节地点A101'))[0];
  const evening = { ...baseDraft, name: '晚间实验甲', sourceTime: '18:00-19:00' };
  const existing = E.merge(state(), [evening]).state;
  const separated = { ...baseDraft, name: '晚间实验乙', sourceTime: '19:00-20:00' };
  assert.equal(E.plan(existing, [separated]).conflicts.length, 0, 'Identical period labels with adjacent actual clock ranges are clear');
  const overlapping = { ...separated, start: 10, end: 10, sourceTime: '18:30-20:00' };
  const check = E.plan(existing, [overlapping]);
  assert.equal(check.conflicts.length, 1);
  assert.equal(check.conflicts[0].type, 'clock-overlap');
});

test('different period labels still clash when actual daytime and explicit night clocks overlap', () => {
  const existing = E.merge(state(), confirmed(rows('白天课程 第9周周六1-2节地点A101'))).state;
  const incoming = { ...confirmed(rows('特殊实验 第9周周六9-10节地点A102'))[0], sourceTime: '08:20-09:30' };
  assert.equal(E.plan(existing, [incoming]).conflicts[0].type, 'clock-overlap');
});

test('missing night clock remains uncertain, while daytime uses changed period settings over old sourceTime', () => {
  const existing = E.merge(state(), confirmed(rows('白天课程 第9周周六5-6节地点A101'))).state;
  const night = confirmed(rows('夜间实验 第9周周六9-10节地点A102'))[0];
  assert.equal(E.plan(existing, [night]).conflicts[0].type, 'time-unresolved');
  existing.periods[4] = { start: '18:00', end: '18:45' }; existing.periods[5] = { start: '18:55', end: '19:40' };
  existing.courses[0].sourceTime = '14:00-15:40';
  assert.equal(E.plan(existing, [{ ...night, sourceTime: '18:30-20:00' }]).conflicts[0].type, 'clock-overlap');
  assert.equal(E.plan(existing, [{ ...night, sourceTime: '14:30-15:30' }]).conflicts.length, 0);
});

test('incoming rows are checked against one another before any state is changed', () => {
  const drafts = confirmed(rows('机器人实验 第9周周六5-6节地点A101').concat(rows('机械实验 第9周周六6-7节地点A102')));
  const preview = E.plan(state(), drafts);
  assert.equal(preview.conflicts.length, 1);
  assert.ok(preview.conflicts[0].otherDraftId);
});

test('confirmed pending rows remain compatible with the application model', () => {
  const drafts = confirmed(E.parse(electrician, { ...context, batchNumber: 1 }).drafts.filter(d => d.week === 12));
  const result = E.merge(state(), drafts, { validateState: M.validateState });
  assert.equal(M.validateState(result.state).courses[0].timeMode, 'pending');
  assert.equal(result.state.courses[0].start, null);
  assert.equal(result.state.courses[0].end, null);
});

test('manual edits to a preview date are validated, and invalid merge is atomic', () => {
  const original = state(), drafts = confirmed(rows('机器人实验 第9周周六5-6节地点A101'));
  const validEdited = { ...drafts[0], date: '2026-11-07' };
  assert.equal(E.merge(original, [validEdited]).state.courses[0].dates[0], '2026-11-07');
  const invalid = { ...drafts[0], date: '2026-11-06' };
  throwsCode(() => E.merge(original, [drafts[0], invalid]), 'DATE_INVALID');
  assert.equal(original.courses.length, 0);
});

test('strict validation rejects malformed periods, invalid clock times, and missing pending notes', () => {
  const draft = confirmed(rows('机器人实验 第9周周六5-6节地点A101'))[0];
  for (const bad of [{ start: 0 }, { end: 25 }, { start: 7, end: 6 }, { day: 0 }, { sourceTime: '19:00-18:00' }, { timeMode: 'pending', start: null, end: null, timeNote: '' }]) {
    assert.ok(E.plan(state(), [{ ...draft, ...bad }]).errors.length > 0);
    assert.throws(() => E.merge(state(), [{ ...draft, ...bad }]));
  }
});

test('course and date limits fail before any partial commit', () => {
  const drafts = confirmed(rows('机器人实验 第9周周六5-6节地点A101'));
  const full = state(Array.from({ length: 500 }, (_, i) => ({ id: 'old-' + i, name: '旧课程' + i, day: 1, start: 1, end: 2, room: '', teacher: '', color: 'teal', dates: ['2026-08-31'], sourceTime: '' })));
  throwsCode(() => E.merge(full, drafts), 'COURSE_LIMIT_EXCEEDED');
  assert.equal(full.courses.length, 500);
  const oversized = state([{ ...full.courses[0], dates: Array(1001).fill('2026-08-31') }]);
  throwsCode(() => E.plan(oversized, []), 'DATE_INVALID');
  throwsCode(() => E.plan(state(), Array(1001).fill(drafts[0])), 'DRAFT_LIMIT_EXCEEDED');
});

test('bounds, invalid contexts, inert HTML text and browser UMD exports are safe', () => {
  throwsCode(() => E.parse('a'.repeat(E.MAX_TEXT + 1), context), 'TEXT_TOO_LONG');
  throwsCode(() => E.parse('通知', { ...context, startMonday: '2026-09-01' }), 'START_MONDAY_INVALID');
  throwsCode(() => E.parse('通知', { ...context, totalWeeks: 100 }), 'TOTAL_WEEKS_INVALID');
  const html = '<img src=x onerror=globalThis.compromised=true> 第9周周六5-6节地点A101';
  assert.equal(E.parse(html, context).drafts[0].name, '<img src=x onerror=globalThis.compromised=true>');
  assert.equal(globalThis.compromised, undefined);
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('./notice-engine.js'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.SuikeNoticeEngine.parse, 'function');
  assert.equal(typeof sandbox.SuikeNoticeEngine.commit, 'function');
});
