'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const M = require('../dist/model.js');
const dist = path.join(__dirname, '../dist');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(dist, 'seed-data.js'), 'utf8'), context);
// Normalize the VM fixture to this realm before strict array comparisons.
const state = M.validateState(JSON.parse(JSON.stringify(context.window.TIMETABLE_SEED)));
const sourceRows = JSON.parse(fs.readFileSync(path.join(dist, '../portal-rows.json'), 'utf8'));
const key = row => [row.date, row.name, row.time].join('\u0000');
const actualRows = state.courses.filter(course => course.id.startsWith('imported-')).flatMap(course => course.dates.map(date => ({ date, name: course.name, time: course.sourceTime })));
assert.equal(new Set(sourceRows.map(key)).size, sourceRows.length, 'source rows contain no duplicate meetings');
assert.equal(new Set(actualRows.map(key)).size, actualRows.length, 'seed contains no duplicate meetings');
assert.deepEqual(actualRows.map(key).sort(), sourceRows.map(key).sort(), 'seed retains every actual portal meeting exactly once and adds none');
assert.deepEqual(Array.from(new Set(actualRows.map(row => row.name))).sort(), Array.from(new Set(sourceRows.map(row => row.name))).sort(), 'all source course names are retained');
const lab = state.courses.find(course => course.id === 'notice-2026-engineering-mechanics-lab-class1');
assert.ok(lab, 'user-supplied engineering mechanics lab exists');
assert.deepEqual(lab.dates, ['2026-10-31', '2026-11-07', '2026-11-21']);
assert.deepEqual(lab.dates.map(date => M.weekNumber(date, state.settings.startMonday)), [9, 10, 12]);
assert.equal(lab.day, 6);
assert.deepEqual([lab.start, lab.end], [5, 6]);
assert.equal(M.timeRange(lab, state.periods).text, '14:00–15:40');
assert.equal(lab.name, '示例力学实验（1班）');
assert.ok(lab.room.includes('示例实验楼118') && lab.room.includes('示例实验楼207') && lab.room.includes('待确认'));
for (const date of lab.dates) assert.equal(M.coursesOn(state.courses, date).filter(course => course.id === lab.id).length, 1, 'each requested Saturday has exactly one mechanics lab');
assert.equal(M.conflictsFor(state.courses, lab).length, 0);
const electrical = state.courses.filter(course => course.id.startsWith('notice-2026-electrical-lab-'));
assert.equal(electrical.length, 2);
assert.deepEqual(electrical.flatMap(course => course.dates).sort(), ['2026-11-19', '2026-11-26', '2026-12-03', '2026-12-10', '2026-12-17']);
for (const course of electrical) {
  assert.equal(course.day, 4);
  assert.ok(course.name.includes('1批次') && course.name.includes('暂定'));
  assert.equal(M.conflictsFor(state.courses, course).length, 0);
  for (const date of course.dates) {
    const afternoonBusy = state.courses.some(other => other.id.startsWith('imported-') && other.dates.includes(date) && other.start <= 6 && other.end >= 5);
    assert.equal(course.start, M.weekNumber(date, state.settings.startMonday) === 12 || afternoonBusy ? 7 : 5);
    assert.equal(course.end, course.start + 1);
  }
}
const physics = state.courses.filter(course => course.id.startsWith('notice-2026-physics-lab-sample1-'));
assert.equal(physics.length, 5);
assert.deepEqual(physics.map(course => [course.dates[0], course.room.split('室')[0]]), [['2026-10-18','210'], ['2026-11-04','103'], ['2026-11-11','106'], ['2026-11-14','110'], ['2026-11-21','114']]);
for (const course of physics) {
  assert.equal(course.name, '示例物理实验（示例1班）');
  assert.equal(course.timeMode, 'pending');
  assert.equal(course.start, null); assert.equal(course.end, null);
  assert.deepEqual(M.timeRange(course, state.periods), {start:null,end:null,text:'19:00开始，结束时间待确认',exact:false});
}
assert.equal(state.courses.reduce((sum, course) => sum + course.dates.length, 0), 181);
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(dist, 'app.js'), 'utf8');
const ids = new Set(Array.from(html.matchAll(/id="([^"]+)"/g), match => match[1]));
const references = Array.from(app.matchAll(/\$\('([^']+)'\)/g), match => match[1]);
assert.deepEqual(Array.from(new Set(references.filter(id => !ids.has(id)))), [], 'app DOM references exist in HTML');
assert.ok(html.indexOf('src="seed-data.js"') < html.indexOf('src="model.js"'));
assert.ok(html.indexOf('src="model.js"') < html.indexOf('src="app.js"'));
const evening = M.coursesOn(state.courses, '2026-10-12').find(course => course.start === 9);
assert.ok(evening, 'October 12 evening source entry exists');
assert.equal(M.timeRange(evening, state.periods).text, '18:30–20:05');
assert.equal(state.periods.length, 8, 'no invented evening period split');
assert.deepEqual(M.coursesOn(state.courses, '2026-10-12').map(course => M.timeRange(course, state.periods).text), ['08:00–09:40', '10:00–11:40', '14:00–15:40', '18:30–20:05'], 'known October 12 times use the user daytime periods plus actual evening source time');
console.log(JSON.stringify({ scheduleGroups: state.courses.length, names: new Set(state.courses.map(course => course.name)).size, actualEntries: state.courses.reduce((n, course) => n + course.dates.length, 0), october12: M.coursesOn(state.courses, '2026-10-12').map(course => ({ name: course.name, periods: [course.start, course.end], time: M.timeRange(course, state.periods).text })), staticDOMReferences: new Set(references).size }, null, 2));
