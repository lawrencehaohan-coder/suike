const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, 'assets/index.html'), 'utf8');
const original = fs.readFileSync(path.join(__dirname, '../../outputs/随课_离线课表.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const oldScripts = [...original.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
assert.equal(scripts.length, 5);
assert.equal(scripts[2], oldScripts[0], 'Private seed must remain exact');
const mod = new Module(__filename, module);
mod.filename = __filename;
mod.paths = module.paths;
global.window = { __suikeBootPhase: function () {} };
mod._compile(scripts[3], __filename);
delete global.window;
const reference = require('../timetable/dist/model.js');
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets/timetable.json'), 'utf8'));
const actual = mod.exports.validateState(seed);
assert.equal(JSON.stringify(actual), JSON.stringify(reference.validateState(seed)));
assert.equal(actual.courses.reduce((sum, c) => sum + c.dates.length, 0), 181);
for (let week = 1; week <= 26; week++) {
  for (let day = 0; day < 7; day++) {
    const date = reference.addDays('2026-08-31', (week - 1) * 7 + day);
    assert.equal(JSON.stringify(mod.exports.coursesOn(actual.courses, date)), JSON.stringify(reference.coursesOn(seed.courses, date)));
  }
}
for (const course of actual.courses) {
  assert.equal(JSON.stringify(mod.exports.timeRange(course, actual.periods)), JSON.stringify(reference.timeRange(course, seed.periods)));
}
for (let i = 0; i < scripts.length; i++) new vm.Script(scripts[i]);
const modelPath = require.resolve('../timetable/dist/model.js');
require.cache[modelPath] = { id: modelPath, filename: modelPath, loaded: true, exports: mod.exports };
require('../timetable/tests/model.test.js');
console.log('Compiled APK model matches all 182 semester dates and 28 course time ranges; 181 meetings retained.');
