(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TimetableModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000;
  const COLORS = Object.freeze({ teal: '#087f75', blue: '#4277b8', amber: '#b47b22', rose: '#b55b73', purple: '#8065ad' });
  const DEFAULT_PERIODS = Object.freeze([
    { start: '08:00', end: '08:45' }, { start: '08:55', end: '09:40' },
    { start: '10:00', end: '10:45' }, { start: '10:55', end: '11:40' },
    { start: '14:00', end: '14:45' }, { start: '14:55', end: '15:40' },
    { start: '16:00', end: '16:45' }, { start: '16:55', end: '17:40' }
  ]);
  function fail(message) { throw new Error(message); }
  function parseISO(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1900 || year > 2200) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
  }
  function iso(date) { return date.toISOString().slice(0, 10); }
  function addDays(value, days) {
    const date = parseISO(value);
    if (!date || !Number.isInteger(days)) fail('日期无效');
    return iso(new Date(date.getTime() + days * DAY));
  }
  function dayOf(value) { const date = parseISO(value); if (!date) fail('日期无效'); return date.getUTCDay() || 7; }
  function mondayOf(value) { return addDays(value, 1 - dayOf(value)); }
  function weekNumber(value, startMonday) {
    const date = parseISO(value), first = parseISO(startMonday);
    return date && first ? Math.floor((date - first) / (7 * DAY)) + 1 : null;
  }
  function parseWeeks(expression, totalWeeks) {
    if (typeof expression !== 'string' || !expression.trim()) fail('请填写上课周次');
    let text = expression.replace(/[，、；;]/g, ',').replace(/[–—－~～至]/g, '-').replace(/第|周|\s/g, '');
    const odd = text.includes('单'), even = text.includes('双');
    if (odd && even) fail('请分别填写单周或双周');
    text = text.replace(/单|双/g, '');
    const weeks = new Set();
    for (const part of text.split(',')) {
      const match = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(part);
      if (!match) fail('周次格式应为 1-16、1,3,5，或 1-16 单周');
      const first = Number(match[1]), last = Number(match[2] || match[1]);
      if (first < 1 || last < first || last > totalWeeks) fail('周次须在 1–' + totalWeeks + ' 周之间');
      for (let week = first; week <= last; week++) if ((!odd || week % 2 === 1) && (!even || week % 2 === 0)) weeks.add(week);
    }
    if (!weeks.size) fail('这些周次没有符合单双周的课程');
    return Array.from(weeks).sort((a, b) => a - b);
  }
  function datesFromExpression(expression, day, settings) {
    if (typeof expression !== 'string' || !expression.trim()) fail('请填写上课日期或周次');
    let dates;
    if (/\d{4}-/.test(expression)) {
      dates = expression.trim().split(/[\s,，、;；]+/).filter(Boolean);
      if (dates.some(date => !parseISO(date))) fail('日期请使用 YYYY-MM-DD 格式，并用逗号分隔');
      if (dates.some(date => dayOf(date) !== day)) fail('上课日期与所选星期不一致，请检查日期或星期');
    } else {
      if (!settings.startMonday) fail('使用周次前，请先在设置中填写“第一周周一”；也可以直接填写上课日期');
      dates = parseWeeks(expression, settings.totalWeeks).map(week => addDays(settings.startMonday, (week - 1) * 7 + day - 1));
    }
    return Array.from(new Set(dates)).sort();
  }
  function knownColor(value) { return typeof value === 'string' && Object.prototype.hasOwnProperty.call(COLORS, value); }
  function colorHex(value) { return knownColor(value) ? COLORS[value] : (/^#[\da-f]{6}$/i.test(value || '') ? value : COLORS.teal); }
  function text(value, name, max, required) {
    if (value == null && !required) return '';
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(name + '格式无效');
    return value.trim();
  }
  function integer(value, name, min, max) {
    if (!Number.isInteger(value) || value < min || value > max) fail(name + '须为 ' + min + '–' + max + ' 的整数');
    return value;
  }
  function validTime(value) { return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
  function normalizeSourceTime(value) {
    const normalized = text(value, '上课时间', 40, false).replace(/[–—－~～至]/g, '-').replace(/\s/g, '');
    if (!normalized) return '';
    const parts = normalized.split('-');
    if (parts.length !== 2 || !parts.every(validTime) || parts[0] >= parts[1]) fail('上课时间应为 HH:MM-HH:MM，结束晚于开始');
    return normalized;
  }
  function validateState(input) {
    if (!input || typeof input !== 'object' || input.schemaVersion !== 1) fail('这不是受支持的随课备份（需版本 1）');
    const setting = input.settings;
    if (!setting || typeof setting !== 'object') fail('备份缺少学期设置');
    const startMonday = setting.startMonday || null;
    if (startMonday && (!parseISO(startMonday) || dayOf(startMonday) !== 1)) fail('第一周开始日期必须为周一');
    const coverageStart = setting.coverageStart || null, coverageEnd = setting.coverageEnd || null;
    if ((coverageStart && !parseISO(coverageStart)) || (coverageEnd && !parseISO(coverageEnd)) || (coverageStart && coverageEnd && coverageEnd < coverageStart)) fail('导入覆盖日期无效');
    const settings = {
      startMonday, totalWeeks: integer(setting.totalWeeks, '学期周数', 1, 52),
      termLabel: text(setting.termLabel || '示例课表', '学期名称', 120, true),
      coverageStart, coverageEnd, theme: setting.theme || 'auto'
    };
    if (!['auto', 'light', 'dark'].includes(settings.theme)) fail('外观设置无效');
    if (!Array.isArray(input.periods) || input.periods.length < 1 || input.periods.length > 24) fail('每天可设置 1–24 节');
    const periods = input.periods.map(period => {
      if (!period || !validTime(period.start) || !validTime(period.end) || period.start >= period.end) fail('课时时间无效');
      return { start: period.start, end: period.end };
    });
    if (!Array.isArray(input.courses) || input.courses.length > 500) fail('课程列表无效或超过 500 条');
    const ids = new Set();
    const courses = input.courses.map(course => {
      if (!course || typeof course !== 'object') fail('课程数据无效');
      const id = text(course.id, '课程编号', 160, true);
      if (ids.has(id)) fail('备份中有重复课程编号');
      ids.add(id);
      const day = integer(course.day, '星期', 1, 7);
      const timeMode = course.timeMode === undefined ? 'periods' : course.timeMode;
      if (!['periods', 'clock', 'pending'].includes(timeMode)) fail('课程时间模式无效');
      let start, end, timeNote;
      if (timeMode === 'pending') {
        if (course.start !== null || course.end !== null) fail('时间待确认课程的开始和结束节次须为空');
        start = null; end = null; timeNote = text(course.timeNote, '待确认时间说明', 160, true);
      } else if(timeMode==='clock'&&course.start===null&&course.end===null){
        start=null;end=null;
      } else {
        start = integer(course.start, '开始节次', 1, 24); end = integer(course.end, '结束节次', start, 24);
      }
      if (!Array.isArray(course.dates) || !course.dates.length || course.dates.length > 1000) fail('每门课程须包含有效上课日期');
      if (course.dates.some(date => !parseISO(date) || dayOf(date) !== day)) fail('课程日期无效或与星期不符');
      const color = course.color || 'teal';
      if (!knownColor(color) && !(typeof color === 'string' && /^#[\da-f]{6}$/i.test(color))) fail('课程颜色无效');
      const sourceTime = normalizeSourceTime(course.sourceTime);
      if(timeMode==='clock'&&!sourceTime)fail('请填写明确的开始和结束时间');
      const normalized = { id, name: text(course.name, '课程名称', 80, true), day, start, end,
        room: text(course.room, '教室', 120, false), teacher: text(course.teacher, '教师', 120, false),
        color, dates: Array.from(new Set(course.dates)).sort(), sourceTime };
      if(timeMode==='clock')normalized.timeMode='clock';
      if (timeMode === 'pending') { normalized.timeMode = 'pending'; normalized.timeNote = timeNote; }
      return normalized;
    });
    const updateIds = input.appliedUpdateIds === undefined ? [] : input.appliedUpdateIds;
    if (!Array.isArray(updateIds) || updateIds.length > 100) fail('更新记录须为不超过 100 项的列表');
    const appliedUpdateIds = Array.from(new Set(updateIds.map(id => text(id, '更新编号', 160, true))));
    return { schemaVersion: 1, settings, periods, courses, appliedUpdateIds };
  }
  function sameImportedTerm(current, confirmed) {
    return current.coverageStart !== null && current.coverageEnd !== null &&
      current.coverageStart === confirmed.coverageStart && current.coverageEnd === confirmed.coverageEnd;
  }
  function calibrateStartMonday(input, seed) {
    const state = validateState(input), initial = validateState(seed);
    const current = state.settings, confirmed = initial.settings;
    // Coverage dates identify this imported term. Missing or different coverage
    // cannot safely inherit a first teaching week from the bundled timetable.
    const sameTerm = sameImportedTerm(current, confirmed);
    const changed = sameTerm && current.startMonday === null && confirmed.startMonday !== null;
    if (changed) current.startMonday = confirmed.startMonday;
    return { state, changed };
  }
  function applySeedUpdates(input, seed) {
    const calibrated = calibrateStartMonday(input, seed), state = calibrated.state, initial = validateState(seed);
    if (!sameImportedTerm(state.settings, initial.settings)) return calibrated;
    let changed = calibrated.changed;
    const applied = new Set(state.appliedUpdateIds);
    const equivalentName = name => name.replace(/\s*[(（]\s*1\s*班\s*[)）]\s*$/, '').trim();
    for (const id of initial.appliedUpdateIds) {
      if (applied.has(id)) continue;
      const update = initial.courses.find(course => course.id === id);
      if (!update) continue;
      // An existing notice id may contain deliberate edits. Only acknowledge it.
      if (!state.courses.some(course => course.id === id)) {
        const coveredDates = new Set(state.courses.filter(course =>
          equivalentName(course.name) === equivalentName(update.name) &&
          (course.timeMode === 'pending') === (update.timeMode === 'pending') &&
          (update.timeMode === 'pending' ? course.timeNote === update.timeNote : course.start === update.start && course.end === update.end)
        ).flatMap(course => course.dates));
        const missingDates = update.dates.filter(date => !coveredDates.has(date));
        if (missingDates.length) state.courses.push({ ...update, dates: missingDates });
      }
      // Keep the acknowledgement even when all dates were already present, so a
      // user's later deletion or rescheduling will not be reversed on reload.
      applied.add(id); changed = true;
    }
    state.appliedUpdateIds = Array.from(applied);
    return { state: validateState(state), changed };
  }
  function coursesOn(courses, date, periods) {
    return courses.filter(course => course.dates.includes(date)).sort((a,b)=>{
      const ap=a.timeMode==='pending',bp=b.timeMode==='pending';
      if(ap!==bp)return ap?1:-1;
      if(ap)return a.name.localeCompare(b.name,'zh-CN');
      const x=timeRange(a,periods||DEFAULT_PERIODS),y=timeRange(b,periods||DEFAULT_PERIODS);
      return String(x.start||'24:00').localeCompare(y.start||'24:00')||String(x.end||'24:00').localeCompare(y.end||'24:00')||a.name.localeCompare(b.name,'zh-CN');
    });
  }
  function timeSegments(course,periods){
    periods=periods||DEFAULT_PERIODS;const range=timeRange(course,periods);
    if(!range.exact)return [];
    const first=periods[course.start-1],last=periods[course.end-1];
    if(course.timeMode==='clock'||!first||!last)return [range];
    return periods.slice(course.start-1,course.end).map(p=>({start:p.start,end:p.end}));
  }
  function conflictsFor(courses, course, periods) {
    if(course.timeMode==='pending')return [];
    const dates=new Set(course.dates),range=timeRange(course,periods||DEFAULT_PERIODS);
    return courses.filter(other=>{
      if(other.timeMode==='pending'||other.id===course.id||other.day!==course.day||!other.dates.some(date=>dates.has(date)))return false;
      const time=timeRange(other,periods||DEFAULT_PERIODS);
      if(range.exact&&time.exact)return timeSegments(course,periods).some(a=>timeSegments(other,periods).some(b=>a.start<b.end&&b.start<a.end));
      return course.start!==null&&other.start!==null&&other.start<=course.end&&other.end>=course.start;
    });
  }
  function timeRange(course, periods) {
    if (course.timeMode === 'pending') return { start: null, end: null, text: course.timeNote, exact: false };
    if((course.timeMode==='clock'||(!periods[course.start-1]||!periods[course.end-1])&&course.end>8)&&course.sourceTime){const parts=course.sourceTime.split('-');return {start:parts[0],end:parts[1],text:parts.join('–'),exact:true};}
    if(course.end>8&&!periods[course.end-1]&&!course.sourceTime)return {start:'',end:'',text:'晚间时间待确认',exact:false};
    const first = periods[course.start - 1], last = periods[course.end - 1];
    if(!first||!last)return {start:'',end:'',text:'上课时间待确认',exact:false};
    return { start: first.start, end: last.end, text: first.start + '–' + last.end, exact: true };
  }
  return { COLORS, DEFAULT_PERIODS, parseISO, iso, addDays, dayOf, mondayOf, weekNumber, parseWeeks, datesFromExpression, colorHex, validateState, calibrateStartMonday, applySeedUpdates, coursesOn, conflictsFor, timeRange, timeSegments, normalizeSourceTime };
});
