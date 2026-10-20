/* JUST teaching-system table normalization. Pure data only; no DOM/network/storage. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../android-app/period-times.js'));
  else root.TeachingParser = factory(root.SuikePeriodTimes);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PeriodTimes) {
  'use strict';
  var SOURCE = 'just-jwglxt-table', DAY = 86400000, MAX_ROWS = 500;
  function fail(code) { var error = new TypeError(code); error.code = code; throw error; }
  function plain(value) { return !!value && Object.prototype.toString.call(value) === '[object Object]' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
  function keys(value, allowed, required) {
    if (!plain(value)) fail('OBJECT_INVALID');
    var own = Object.keys(value);
    if (own.some(function (key) { return allowed.indexOf(key) < 0; })) fail('UNKNOWN_FIELD');
    if ((required || allowed).some(function (key) { return !Object.prototype.hasOwnProperty.call(value, key); })) fail('FIELD_MISSING');
    if (own.some(function (key) { var d = Object.getOwnPropertyDescriptor(value, key); return !d || !Object.prototype.hasOwnProperty.call(d, 'value'); })) fail('ACCESSOR_INVALID');
  }
  function clean(value, max, required) {
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail('TEXT_INVALID');
    var result = value.replace(/\s+/g, ' ').trim();
    if (required && !result) fail('TEXT_EMPTY');
    return result;
  }
  function integer(value, min, max) { return Number.isInteger(value) && value >= min && value <= max; }
  function isoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    var p = value.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return p[0] >= 1900 && p[0] <= 2200 && d.getUTCFullYear() === p[0] && d.getUTCMonth() + 1 === p[1] && d.getUTCDate() === p[2] ? d : null;
  }
  function addDays(value, n) { return new Date(isoDate(value).getTime() + n * DAY).toISOString().slice(0, 10); }
  function clock(value) { return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
  function sourceTime(value) {
    if (typeof value !== 'string') return null;
    var normalized = value.replace(/[–—－]/g, '-').replace(/\s/g, ''), parts = normalized.split('-');
    return parts.length === 2 && clock(parts[0]) && clock(parts[1]) && parts[0] < parts[1] ? normalized : null;
  }
  function hash(value) {
    var a = 2166136261, b = 3339675911;
    for (var i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b ^ value.charCodeAt(i), 2246822519); }
    function hex(n) { return ('00000000' + (n >>> 0).toString(16)).slice(-8); }
    return hex(a) + hex(b);
  }
  /* Parity belongs to each segment, never to the entire expression. */
  function parseWeeks(expression, totalWeeks) {
    if (!integer(totalWeeks, 1, 52)) fail('TOTAL_WEEKS_INVALID');
    var text = clean(expression, 200, true).replace(/\s/g, '').replace(/[，、]/g, ',').replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/[–—－]/g, '-');
    var result = new Set(), parts = text.split(',');
    if (parts.length > 52) fail('WEEKS_INVALID');
    parts.forEach(function (part) {
      var match = /^(\d{1,2})(?:-(\d{1,2}))?周(?:\((单|双)\))?$/.exec(part);
      if (!match) fail('WEEKS_INVALID');
      var first = Number(match[1]), last = Number(match[2] || match[1]);
      if (!integer(first, 1, totalWeeks) || !integer(last, first, totalWeeks)) fail('WEEKS_OUTSIDE_TERM');
      var count = 0;
      for (var week = first; week <= last; week++) if (!match[3] || (match[3] === '单' ? week % 2 === 1 : week % 2 === 0)) { result.add(week); count++; }
      if (!count) fail('WEEKS_PARITY_EMPTY');
    });
    if (!result.size) fail('WEEKS_EMPTY');
    return Array.from(result).sort(function (a, b) { return a - b; });
  }
  function parsePattern(value, totalWeeks) {
    var line = clean(value, 200, true).replace(/\s/g, '').replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/[–—－]/g, '-');
    var match = /^\((\d{1,2})(?:-(\d{1,2}))?节\)(.+)$/.exec(line);
    if (!match) fail('PERIOD_PATTERN_INVALID');
    var start = Number(match[1]), end = Number(match[2] || match[1]);
    if (!integer(start, 1, 11) || !integer(end, start, 11)) fail('PERIOD_PATTERN_INVALID');
    return { start: start, end: end, weeks: parseWeeks(match[3], totalWeeks) };
  }
  function warning(list, code, index, name) { var item = { code: code }; if (index !== undefined) item.rowIndex = index; if (name) item.name = name; list.push(item); }
  function normalizeCapture(capture, settings, periods, currentCourses) {
    keys(capture, ['source', 'adapterVersion', 'term', 'rows', 'unscheduledPresent','periods','periodCount'],['source', 'adapterVersion', 'term', 'rows', 'unscheduledPresent']);
    var schoolPeriods=capture.periods===undefined?[]:PeriodTimes.validateRows(capture.periods);
    if(capture.periodCount!==undefined&&(!Number.isInteger(capture.periodCount)||capture.periodCount<1||capture.periodCount>24||schoolPeriods.some(function(row){return row.period>capture.periodCount;})))fail('PERIOD_COUNT_INVALID');
    var periodsComplete=!!capture.periodCount&&schoolPeriods.length===capture.periodCount&&schoolPeriods.every(function(row,i){return row.period===i+1;});
    if (capture.source !== SOURCE || capture.adapterVersion !== 1 || !Array.isArray(capture.rows) || !capture.rows.length || capture.rows.length > MAX_ROWS || typeof capture.unscheduledPresent !== 'boolean') fail('CAPTURE_INVALID');
    keys(capture.term, ['year', 'semester']);
    var year = clean(capture.term.year, 9, true), semester = clean(capture.term.semester, 1, true), years = /^(\d{4})-(\d{4})$/.exec(year);
    if (!years || Number(years[1]) < 1900 || Number(years[2]) > 2200 || Number(years[2]) !== Number(years[1]) + 1 || !/^[12]$/.test(semester)) fail('TERM_INVALID');
    if (!plain(settings) || !integer(settings.totalWeeks, 1, 52) || !isoDate(settings.startMonday) || isoDate(settings.startMonday).getUTCDay() !== 1) fail('SETTINGS_INVALID');
    var firstYear = Number(years[1]);
    if ((semester === '1' && (settings.startMonday < firstYear + '-07-01' || settings.startMonday > firstYear + '-12-31')) || (semester === '2' && (settings.startMonday < (firstYear + 1) + '-01-01' || settings.startMonday > (firstYear + 1) + '-07-31'))) fail('TERM_DATE_MISMATCH');
    if (!Array.isArray(periods) || periods.length < 1 || periods.length > 24 || periods.some(function (p) { return !plain(p) || !clock(p.start) || !clock(p.end) || p.start >= p.end; })) fail('PERSONAL_PERIODS_INVALID');
    if (currentCourses === undefined) currentCourses = [];
    if (!Array.isArray(currentCourses) || currentCourses.length > 500) fail('CURRENT_COURSES_INVALID');
    var scopeEnd = addDays(settings.startMonday, settings.totalWeeks * 7 - 1);
    if (!isoDate(scopeEnd)) fail('SCOPE_OUTSIDE_DATE_RANGE');
    var termId = year + '-' + semester, warnings = [], occurrences = [], seen = new Map();
    var stats = { sourceRows: capture.rows.length, selectedRows: 0, acceptedRows: 0, rejectedRows: 0, excludedRows: 0, duplicateRows: 0, uniqueMeetings: 0 };
    capture.rows.forEach(function (row, index) {
      var name = '';
      try {
        keys(row, ['cell', 'name', 'lines', 'selected']);
        if (typeof row.selected !== 'boolean') fail('SELECTION_INVALID');
        name = clean(row.name, 80, true);
        var cell = /^([1-7])-(1[01]|[1-9])$/.exec(clean(row.cell, 40, true));
        if (!cell || !Array.isArray(row.lines) || row.lines.length !== 4) fail('COURSE_FIELDS_INVALID');
        var lines = row.lines.map(function (line) { return clean(line, 200, false); });
        if (!row.selected) { stats.excludedRows++; return; }
        stats.selectedRows++;
        var pattern = parsePattern(lines[0], settings.totalWeeks), day = Number(cell[1]);
        if (pattern.start !== Number(cell[2])) fail('CELL_PERIOD_MISMATCH');
        var code = lines[3], codeMatch = /^\((\d{4}-\d{4})-([12])\)-[A-Za-z0-9]{2,40}-[A-Za-z0-9]{1,20}$/.exec(code);
        if (!codeMatch || codeMatch[1] !== year || codeMatch[2] !== semester || code.length > 120) fail('TEACHING_CLASS_INVALID');
        var room = clean(lines[1], 120, false), teacher = clean(lines[2], 120, false);
        if (/未排地点|地点待定/.test(room)) { room = ''; warning(warnings, 'ROOM_PENDING', index, name); }
        else if (!room) warning(warnings, 'ROOM_EMPTY', index, name);
        if (!teacher) warning(warnings, 'TEACHER_EMPTY', index, name);
        var time = '', mode = 'periods', note = '', start = pattern.start, end = pattern.end;
        if (end > 8) {
          var clocks=[];
          for(var slot=start;slot<=end;slot++)clocks.push(schoolPeriods.find(function(p){return p.period===slot;}));
          var times = new Set();
          currentCourses.forEach(function (course) {
            if (plain(course) && course.name === name && course.start === start && course.end === end && course.timeMode !== 'pending') {
              var existing = sourceTime(course.sourceTime); if (existing) times.add(existing);
            }
          });
          if(clocks.length&&clocks.every(Boolean)){time=clocks[0].start+'-'+clocks[clocks.length-1].end;warning(warnings,'NIGHT_TIME_FROM_PAGE',index,name);}
          else if (end <= 10 && times.size === 1) { time = Array.from(times)[0]; warning(warnings, 'NIGHT_TIME_REUSED', index, name); }
          else { mode = 'pending'; note = '教务第' + start + (end === start ? '' : '–' + end) + '节；具体时间待确认'; start = null; end = null; warning(warnings, times.size > 1 ? 'NIGHT_TIME_CONFLICT' : 'NIGHT_TIME_REQUIRED', index, name); }
        }
        var rowOccurrences = [];
        pattern.weeks.forEach(function (week) {
          var date = addDays(settings.startMonday, (week - 1) * 7 + day - 1);
          /* This is a derived timetable-pattern identity, not an upstream occurrence ID. */
          var identity = JSON.stringify([termId, code, day, pattern.start, pattern.end, week]);
          var item = { sourceOccurrenceId: 'just-pattern-' + hash(identity), sourceKey: code, week: week, date: date, name: name, day: day, start: start, end: end, room: room, teacher: teacher, sourceTime: time, timeMode: mode, timeNote: note };
          var previous = seen.get(item.sourceOccurrenceId);
          if (previous && JSON.stringify(previous) !== JSON.stringify(item)) fail('SOURCE_PATTERN_CONFLICT');
          if (!previous) rowOccurrences.push(item);
        });
        if (!rowOccurrences.length) stats.duplicateRows++;
        rowOccurrences.forEach(function (item) { seen.set(item.sourceOccurrenceId, item); occurrences.push(item); });
        stats.acceptedRows++;
      } catch (error) {
        /* Conflicting pattern identity makes the capture ambiguous; do not keep its first variant. */
        if (error.code === 'SOURCE_PATTERN_CONFLICT') throw error;
        stats.rejectedRows++;
        warning(warnings, error.code || 'ROW_INVALID', index, name);
      }
    });
    occurrences.sort(function (a, b) { return a.date.localeCompare(b.date) || (a.start || 99) - (b.start || 99) || a.name.localeCompare(b.name) || a.sourceOccurrenceId.localeCompare(b.sourceOccurrenceId); });
    if (!stats.selectedRows) fail('NO_SELECTED_COURSES');
    if (!occurrences.length) fail('NO_VALID_COURSES');
    if (capture.unscheduledPresent) warning(warnings, 'UNSCHEDULED_COURSES_PRESENT');
    stats.uniqueMeetings = occurrences.length;
    return { source: { system: 'just-jwglxt', term: termId }, term: { year: year, semester: semester }, scope: { from: settings.startMonday, to: scopeEnd, complete: stats.rejectedRows === 0 }, occurrences: occurrences, warnings: warnings, rejectedCount: stats.rejectedRows, unscheduledPresent: capture.unscheduledPresent, periods:schoolPeriods, periodCount:capture.periodCount||null, periodsComplete:periodsComplete, stats: stats };
  }
  return { normalizeCapture: normalizeCapture, parseWeeks: parseWeeks, parsePattern: parsePattern };
});
