'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const P = require('./teaching-parser.js');
const fixture = require('./teaching-fixture.json');
const M = require('../timetable/dist/model.js');
const clone = value => JSON.parse(JSON.stringify(value));
const seedContext = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../timetable/dist/seed-data.js'), 'utf8'), seedContext);
const seed = clone(seedContext.window.TIMETABLE_SEED);
const normalize = (capture = clone(fixture), currentCourses = seed.courses, settings = seed.settings) => P.normalizeCapture(capture, settings, seed.periods, currentCourses);

test('actual 20 teaching blocks expand to the independently collected 168 calendar meetings', () => {
  const before = JSON.stringify([fixture, seed]);
  const out = normalize();
  assert.deepEqual(out.stats, { sourceRows: 20, selectedRows: 20, acceptedRows: 20, rejectedRows: 0, excludedRows: 0, duplicateRows: 0, uniqueMeetings: 168 });
  const key = row => [row.name, row.date, row.day, row.start, row.end].join('|');
  const expected = seed.courses.filter(c => c.id.startsWith('imported-')).flatMap(c => c.dates.map(date => key({ ...c, date }))).sort();
  assert.deepEqual(out.occurrences.map(key).sort(), expected);
  assert.equal(JSON.stringify([fixture, seed]), before, 'normalization must not mutate course/lab/period/settings data');
  assert.deepEqual(out.source, { system: 'just-jwglxt', term: '2026-2027-1' });
  assert.equal(out.scope.complete, true);
  out.occurrences.forEach(o => { assert.equal(M.dayOf(o.date), o.day); assert.equal(M.weekNumber(o.date, seed.settings.startMonday), o.week); assert.match(o.sourceKey, /^\(2026-2027-1\)-/); assert.match(o.sourceOccurrenceId, /^just-pattern-[a-f0-9]{16}$/); });
});

test('parity is local to each comma segment, including the observed mixed expression', () => {
  assert.deepEqual(P.parseWeeks('3-5周(单),6-8周(双),9-11周,13周', 26), [3, 5, 6, 8, 9, 10, 11, 13]);
  assert.deepEqual(P.parseWeeks('1-5周(单),6-12周', 26), [1, 3, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(P.parseWeeks('7周，14-16周（双），17周', 26), [7, 14, 16, 17]);
});

test('invalid/outside/ambiguous week expressions fail closed rather than invent dates', () => {
  ['1-5周单', '1-5周(单),6-8周(奇)', '0周', '27周', '5-3周', '2周(单)', '1-5周,', '1,3,5周', '一周', '1-3周；5周'].forEach(s => assert.throws(() => P.parseWeeks(s, 26)));
});

test('known night course retains the user-confirmed source time; new night course stays pending', () => {
  const known = normalize().occurrences.filter(o => o.name === '示例时政2');
  assert.equal(known.length, 4);
  known.forEach(o => { assert.equal(o.sourceTime, '18:30-20:05'); assert.equal(o.timeMode, 'periods'); assert.equal(o.start, 9); assert.equal(o.end, 10); });
  const unknown = normalize(clone(fixture), []).occurrences.filter(o => o.name === '示例时政2');
  unknown.forEach(o => { assert.equal(o.sourceTime, ''); assert.equal(o.timeMode, 'pending'); assert.equal(o.start, null); assert.equal(o.end, null); assert.equal(o.timeNote, '教务第9–10节；具体时间待确认'); });
});

test('conflicting existing night clocks cannot select a time silently', () => {
  const current = clone(seed.courses), night = current.find(c => c.name === '示例时政2');
  current.push({ ...night, id: 'second-night', sourceTime: '19:00-20:35' });
  const out = normalize(clone(fixture), current);
  assert(out.warnings.some(w => w.code === 'NIGHT_TIME_CONFLICT'));
  out.occurrences.filter(o => o.name === night.name).forEach(o => assert.equal(o.timeMode, 'pending'));
});

test('day courses use the eight personal period slots and never school-inferred clocks', () => {
  const out = normalize();
  out.occurrences.filter(o => o.end <= 8).forEach(o => { assert.equal(o.sourceTime, ''); assert.equal(o.timeMode, 'periods'); assert.equal(o.timeNote, ''); });
  assert.equal(out.occurrences.find(o => o.name === '示例运动3').room, '');
  assert(out.warnings.some(w => w.code === 'UNSCHEDULED_COURSES_PRESENT'));
  assert.equal(out.occurrences.some(o => /实验/.test(o.name)), false, 'unscheduled bottom row is only a flag');
});

test('red unselected entries are excluded; empty/unknown selection is never imported', () => {
  const capture = clone(fixture); capture.rows[0].selected = false;
  const out = normalize(capture);
  assert.equal(out.stats.excludedRows, 1); assert.equal(out.stats.uniqueMeetings, 158);
  capture.rows.forEach(row => { row.selected = false; });
  assert.throws(() => normalize(capture), e => e.code === 'NO_SELECTED_COURSES');
});

test('invalid cell/period/code row is rejected and coverage is explicitly incomplete', () => {
  for (const alter of [r => { r.cell = '8-1'; }, r => { r.cell = '1-3'; }, r => { r.lines[0] = '(1-2节)99周'; }, r => { r.lines[3] = '(2025-2026-1)-55Z30002a-02'; }, r => { r.selected = 'true'; }, r => { r.lines.push('student-id'); }]) {
    const capture = clone(fixture); alter(capture.rows[0]);
    const out = normalize(capture); assert.equal(out.rejectedCount, 1); assert.equal(out.scope.complete, false); assert.equal(out.stats.uniqueMeetings, 158);
  }
});

test('term must match an actual Monday in the selected academic semester', () => {
  assert.throws(() => normalize(clone(fixture), seed.courses, { ...seed.settings, startMonday: '2026-08-30' }), e => e.code === 'SETTINGS_INVALID');
  assert.throws(() => normalize(clone(fixture), seed.courses, { ...seed.settings, startMonday: '2025-09-01' }), e => e.code === 'TERM_DATE_MISMATCH');
  const capture = clone(fixture); capture.term.semester = '2';
  assert.throws(() => normalize(capture), e => e.code === 'TERM_DATE_MISMATCH');
});

test('duplicate pattern is idempotent, changed variant with same pattern identity aborts capture', () => {
  const capture = clone(fixture); capture.rows.push(clone(capture.rows[0]));
  const out = normalize(capture); assert.equal(out.stats.uniqueMeetings, 168); assert.equal(out.stats.duplicateRows, 1);
  capture.rows[20].lines[1] = 'another classroom';
  assert.throws(() => normalize(capture), e => e.code === 'SOURCE_PATTERN_CONFLICT');
});

test('strict capture boundaries reject extra/private fields, oversized arrays and accessors', () => {
  const extra = clone(fixture); extra.studentName = 'private'; assert.throws(() => normalize(extra), e => e.code === 'UNKNOWN_FIELD');
  const rows = clone(fixture); rows.rows = Array(501).fill(rows.rows[0]); assert.throws(() => normalize(rows), e => e.code === 'CAPTURE_INVALID');
  const accessor = clone(fixture); Object.defineProperty(accessor, 'term', { enumerable: true, get() { throw new Error('private getter must never execute'); } });
  assert.throws(() => normalize(accessor), e => e.code === 'ACCESSOR_INVALID');
});

const collectorCode = fs.readFileSync(path.join(__dirname, 'teaching-collector.js'), 'utf8');
function domFixture(capture = clone(fixture)) {
  const queries = [], reads = [];
  function node(text, label) { return { get textContent() { reads.push(label); return text; } }; }
  const blocks = capture.rows.map((row, index) => ({
    parentElement: { tagName: 'TD', id: row.cell },
    querySelector(selector) { assert.equal(selector, '.title'); return node(row.name, 'course-name-' + index); },
    querySelectorAll(selector) {
      if (selector === 'p') return row.lines.map((line, n) => node(line, 'course-field-' + index + '-' + n));
      assert.equal(selector, 'font'); return row.lines.map(() => ({ getAttribute(name) { assert.equal(name, 'color'); return row.selected ? 'blue' : 'red'; } }));
    }
  }));
  const days = ['时间段', '节次', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
  const rows = [{ cells: [] }, { cells: days.map(s => node(s, 'day-header')) }];
  for (let p = 1; p <= 11; p++) rows.push({ cells: [1, 5, 9].includes(p) ? [node(p === 1 ? '上午' : p === 5 ? '下午' : '晚上', 'time-group'), node(String(p), 'period-header')] : [node(String(p), 'period-header')] });
  rows.push(node(capture.unscheduledPresent ? '实践课程：未排课内容；其它课程：未排课内容' : '', 'unscheduled-flag'));
  const table = { rows, querySelector(selector) { assert.equal(selector, 'h6'); return node(capture.term.year + '学年第' + capture.term.semester + '学期', 'first-term-title-only'); }, querySelectorAll(selector) { assert.equal(selector, 'td[id] > div.timetable_con'); return blocks; } };
  const document = { querySelector(selector) {
    queries.push(selector);
    if (selector === '#kbgrid_table_0') return table;
    if (selector === '#ajaxForm #xnm option:checked') return node(capture.term.year, 'year-option-label');
    if (selector === '#ajaxForm #xqm option:checked') return node(capture.term.semester, 'semester-option-label');
    throw new Error('Private field was queried: ' + selector);
  } };
  Object.defineProperty(document, 'cookie', { get() { throw new Error('private-cookie-sentinel'); } });
  const context = { location: { protocol: 'https:', hostname: 'client.v.just.edu.cn', pathname: '/http/vpn-prefix/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html' }, document };
  Object.defineProperty(context, 'localStorage', { get() { throw new Error('private-storage-sentinel'); } });
  Object.defineProperty(context, 'fetch', { get() { throw new Error('private-network-sentinel'); } });
  return { context, table, blocks, queries, reads };
}
function collect(dom) { return JSON.parse(vm.runInNewContext(collectorCode, dom.context, { timeout: 1000 })); }

test('fixed collector returns exactly the five bounded course/semester fields', () => {
  const dom = domFixture(), out = collect(dom);
  const normalizedFixture = clone(fixture); normalizedFixture.periodCount=11;
  normalizedFixture.rows.forEach(row => { row.name = row.name.replace(/\s+/g, ' ').trim(); row.lines = row.lines.map(line => line.replace(/\s+/g, ' ').trim()); });
  assert.deepEqual(out, normalizedFixture);
  assert.deepEqual(dom.queries, ['#kbgrid_table_0', '#ajaxForm #xnm option:checked', '#ajaxForm #xqm option:checked']);
  assert.equal(dom.reads.filter(r => r === 'first-term-title-only').length, 1);
  assert.equal(dom.reads.filter(r => r === 'unscheduled-flag').length, 1);
});

test('collector rejects wrong origin/path/login grid without returning any course data', () => {
  for (const change of [d => { d.context.location.hostname = 'attacker.invalid'; }, d => { d.context.location.protocol = 'http:'; }, d => { d.context.location.pathname = '/cas/login'; }, d => { d.table.rows.pop(); }, d => { d.table.rows[1].cells[2] = { textContent: '登录' }; }, d => { d.table.rows[2].cells[1] = { textContent: '9' }; }]) {
    const dom = domFixture(); change(dom); const out = collect(dom);
    assert.deepEqual(Object.keys(out), ['source', 'adapterVersion', 'error']); assert.equal(out.rows, undefined);
  }
});

test('collector needs nonempty and consistently explicit blue/red fonts', () => {
  for (const fonts of [[], [{ getAttribute() { return null; } }], [{ getAttribute() { return 'blue'; } }, { getAttribute() { return 'red'; } }]]) {
    const dom = domFixture(), original = dom.blocks[0].querySelectorAll;
    dom.blocks[0].querySelectorAll = s => s === 'font' ? fonts : original(s);
    const out = collect(dom); assert(out.error === 'COURSE_FIELDS_INVALID' || out.error === 'SELECTION_UNKNOWN');
  }
});

test('collector exception diagnostics contain only fixed error codes, never exception text', () => {
  const dom = domFixture(); dom.table.querySelector = () => { throw new Error('password-and-token-private-sentinel'); };
  const out = collect(dom); assert.equal(out.error, 'COLLECTOR_FAILED'); assert.equal(JSON.stringify(out).includes('sentinel'), false);
});

test('collector reads only explicit clocks in known period headers, with no inferred times',()=>{
  const dom=domFixture();dom.table.rows[2].cells[1]={textContent:'第1节 8:05–8:50'};
  dom.table.rows[3].cells[0]={textContent:'2（09:00-09:45）'};
  const out=collect(dom);assert.deepEqual(out.periods,[{period:1,start:'08:05',end:'08:50'},{period:2,start:'09:00',end:'09:45'}]);
  assert.equal(out.rows.length,20);assert.equal(collect(domFixture()).periods,undefined);
  assert.deepEqual(dom.queries,['#kbgrid_table_0','#ajaxForm #xnm option:checked','#ajaxForm #xqm option:checked']);
});
test('malformed header clocks fail closed without exposing unrelated page content',()=>{
  for(const text of ['1 25:00-25:45','1 09:00-08:00','1 password-sentinel']){
    const dom=domFixture();dom.table.rows[2].cells[1]={textContent:text};const out=collect(dom);
    assert.equal(out.error,'PERIOD_HEADERS_INVALID');assert.equal(JSON.stringify(out).includes('sentinel'),false);
  }
});
test('explicit captured night slots resolve new evening classes without guessing or replacing stored courses',()=>{
  const capture=clone(fixture);capture.periods=[{period:9,start:'19:15',end:'20:00'},{period:10,start:'20:10',end:'20:55'}];
  const before=JSON.stringify(capture),out=normalize(capture,[]);
  const night=out.occurrences.filter(o=>o.name==='示例时政2');assert.equal(night.length,4);
  night.forEach(o=>{assert.equal(o.sourceTime,'19:15-20:55');assert.equal(o.timeMode,'periods');});
  assert.equal(JSON.stringify(capture),before);assert.deepEqual(out.periods,capture.periods);
});
test('invalid time metadata aborts normalization instead of changing the local time table',()=>{
  const capture=clone(fixture);capture.periods=[{period:1,start:'08:00',end:'08:45',token:'sentinel'}];
  assert.throws(()=>normalize(capture),e=>e.code==='PERIOD_FIELDS_INVALID');
});

test('an explicit eleventh school period is confirmed, while the same course without clocks stays pending',()=>{
 const capture=clone(fixture);capture.rows=[capture.rows[0]];capture.rows[0].cell='1-11';capture.rows[0].lines[0]='(11节)1-2周';capture.rows[0].selected=true;
 const unknown=normalize(capture,[]);assert.equal(unknown.occurrences[0].timeMode,'pending');
 capture.periods=[{period:11,start:'21:00',end:'21:45'}];const result=normalize(capture,[]);assert.equal(result.occurrences.length,2);
 result.occurrences.forEach(o=>{assert.equal(o.start,11);assert.equal(o.end,11);assert.equal(o.timeMode,'periods');assert.equal(o.sourceTime,'21:00-21:45');});
});
