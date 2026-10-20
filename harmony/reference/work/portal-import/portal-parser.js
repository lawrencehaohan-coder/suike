/* DOM-capture normalization only. No network, DOM, storage or HTML execution. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JustPortalImport = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var SOURCE = 'just-schedule-dom';
  var KNOWN_TIMES = { '08:30-10:05': [1, 2], '10:25-12:00': [3, 4], '14:00-15:35': [5, 6], '15:55-17:30': [7, 8], '18:30-20:05': [9, 10] };
  var COLORS = ['teal', 'blue', 'amber', 'rose', 'purple'];

  function fail(code) { var error = new TypeError(code); error.code = code; throw error; }
  function text(value, max, required) {
    if (value === undefined || value === null) return required ? null : '';
    if (typeof value !== 'string') return null;
    var result = value.replace(/\r\n?/g, '\n').trim();
    return result.length > max || (required && !result) ? null : result;
  }
  function dateInfo(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    var p = value.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    if (p[0] < 1900 || p[0] > 2200 || d.getUTCFullYear() !== p[0] || d.getUTCMonth() + 1 !== p[1] || d.getUTCDate() !== p[2]) return null;
    return { day: d.getUTCDay() || 7 };
  }
  function clock(value) { return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
  function sourceTime(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string' || value.length > 40) return null;
    var normalized = value.trim().replace(/[–—－]/g, '-').replace(/\s/g, ''), parts = normalized.split('-');
    return parts.length === 2 && clock(parts[0]) && clock(parts[1]) && parts[0] < parts[1] ? normalized : null;
  }
  function warning(code, row, rowIndex, extra) {
    var result = { code: code };
    if (rowIndex !== undefined) result.rowIndex = rowIndex;
    if (row && typeof row.date === 'string') result.date = row.date;
    if (row && typeof row.name === 'string') result.name = row.name;
    if (extra) Object.keys(extra).forEach(function (key) { result[key] = extra[key]; });
    return result;
  }
  function stableHash(value) {
    var a = 2166136261, b = 3339675911;
    for (var i = 0; i < value.length; i++) {
      a = Math.imul(a ^ value.charCodeAt(i), 16777619);
      b = Math.imul(b ^ value.charCodeAt(i), 2246822519);
    }
    function hex(n) { return ('00000000' + (n >>> 0).toString(16)).slice(-8); }
    return hex(a) + hex(b);
  }
  function integer(value, min, max) { return Number.isInteger(value) && value >= min && value <= max; }
  function parseDetail(raw, name) {
    if (!Array.isArray(raw) || !raw.length || raw.length > 16 || raw.some(function (part) { return typeof part !== 'string' || part.length > 2000; })) return { error: 'DETAIL_MISSING_OR_INVALID' };
    var headings = raw.map(function (part) { return part.replace(/\r\n?/g, '\n').trim(); });
    if (!headings.some(function (part) { return part === name || part.indexOf('课程：' + name + '节次：') >= 0 || part.indexOf('课程:' + name + '节次:') >= 0; })) return { error: 'DETAIL_NAME_MISMATCH' };
    var ranges = [], rooms = [], teachers = [];
    headings.forEach(function (part) {
      var room = /^(?:上课)?地点\s*[:：]([\s\S]*)$/.exec(part);
      if (room) rooms.push(room[1].trim());
      var period = /节次\s*[:：]\s*(\d{1,2})(?:\s*[-–—－]\s*(\d{1,2}))?(?=\s*(?:老师\s*[:：]|$))/.exec(part);
      if (period) ranges.push([Number(period[1]), Number(period[2] || period[1])]);
      var teacher = /老师\s*[:：]([\s\S]*)$/.exec(part);
      if (teacher) teachers.push(teacher[1].trim());
    });
    if (!ranges.length) return { error: 'DETAIL_PERIOD_MISSING' };
    var first = ranges[0];
    if (!integer(first[0], 1, 10) || !integer(first[1], first[0], 10)) return { error: 'DETAIL_PERIOD_INVALID' };
    if (ranges.some(function (pair) { return pair[0] !== first[0] || pair[1] !== first[1]; }) || rooms.some(function (room) { return room !== rooms[0]; }) || teachers.some(function (teacher) { return teacher !== teachers[0]; })) return { error: 'DETAIL_CONFLICT' };
    if ((rooms[0] || '').length > 120 || (teachers[0] || '').length > 120) return { error: 'DETAIL_FIELD_TOO_LONG' };
    return { start: first[0], end: first[1], room: rooms.length ? rooms[0] : '', teacher: teachers.length ? teachers[0] : '', roomObserved: !!rooms.length, teacherObserved: !!teachers.length };
  }
  function courseKey(course) { return JSON.stringify([course.name, course.day, course.start, course.end, course.room, course.teacher, course.sourceTime, course.timeMode || 'periods', course.timeNote || '']); }
  function meetingKey(course, date) { return JSON.stringify([course.name, date, course.timeMode === 'pending' ? ['pending', course.timeNote] : ['periods', course.start, course.end]]); }

  function normalizeCapture(capture, settings, periods) {
    if (!capture || capture.source !== SOURCE || !Array.isArray(capture.rows) || capture.rows.length > 20000) fail('CAPTURE_INVALID');
    var scope = capture.scope;
    if (!scope || !dateInfo(scope.from) || !dateInfo(scope.to) || scope.from > scope.to || typeof scope.complete !== 'boolean') fail('SCOPE_INVALID');
    if (!settings || typeof settings !== 'object') fail('SETTINGS_REQUIRED');
    if (!Array.isArray(periods) || periods.length < 1 || periods.length > 24 || periods.some(function (period) { return !period || !clock(period.start) || !clock(period.end) || period.start >= period.end; })) fail('PERSONAL_PERIODS_INVALID');
    var warnings = [], groups = new Map(), seen = new Set(), variants = new Map();
    var stats = { sourceRows: capture.rows.length, acceptedRows: 0, rejectedRows: 0, duplicateRows: 0, uniqueMeetings: 0, courseGroups: 0 };
    if (!scope.complete) warnings.push(warning('SCOPE_INCOMPLETE'));
    capture.rows.forEach(function (row, index) {
      function reject(code) { stats.rejectedRows++; warnings.push(warning(code, row, index)); }
      if (!row || typeof row !== 'object') { reject('ROW_INVALID'); return; }
      var date = dateInfo(row.date), name = text(row.name, 80, true), time = sourceTime(row.sourceTime);
      if (!date) { reject('DATE_INVALID'); return; }
      if (row.date < scope.from || row.date > scope.to) { reject('DATE_OUTSIDE_SCOPE'); return; }
      if (name === null) { reject('COURSE_NAME_INVALID'); return; }
      if (time === null) { reject('SOURCE_TIME_INVALID'); return; }
      var detail = parseDetail(row.detailRaw, name);
      if (detail.error) { reject(detail.error); return; }
      if (detail.end > 8 && !time) { reject('NIGHT_TIME_MISSING'); return; }
      var known = KNOWN_TIMES[time];
      if (known && (known[0] !== detail.start || known[1] !== detail.end)) { reject('PERIOD_SOURCE_TIME_CONFLICT'); return; }
      if (!time) warnings.push(warning('SOURCE_TIME_MISSING_DAYTIME_USES_PERSONAL_PERIODS', row, index));
      if (!detail.roomObserved) warnings.push(warning('ROOM_NOT_OBSERVED', row, index));
      else if (!detail.room) warnings.push(warning('ROOM_NOT_SPECIFIED', row, index));
      if (!detail.teacherObserved || !detail.teacher) warnings.push(warning('TEACHER_NOT_SPECIFIED', row, index));
      var course = { name: name, day: date.day, start: detail.start, end: detail.end, room: detail.room, teacher: detail.teacher, sourceTime: time };
      var key = courseKey(course), instance = JSON.stringify([key, row.date]);
      if (seen.has(instance)) { stats.duplicateRows++; warnings.push(warning('DUPLICATE_CAPTURE_ROW', row, index)); return; }
      seen.add(instance);
      var meeting = meetingKey(course, row.date), priorVariant = variants.get(meeting);
      if (priorVariant && priorVariant !== key) warnings.push(warning('CAPTURE_MEETING_VARIANTS', row, index));
      variants.set(meeting, key);
      if (!groups.has(key)) {
        var hash = stableHash(key);
        course.id = 'just-' + hash; course.color = COLORS[parseInt(hash.slice(0, 8), 16) % COLORS.length]; course.dates = [];
        groups.set(key, course);
      }
      groups.get(key).dates.push(row.date); stats.acceptedRows++;
    });
    var courses = Array.from(groups.values());
    courses.forEach(function (course) { course.dates.sort(); });
    courses.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    stats.uniqueMeetings = stats.acceptedRows; stats.courseGroups = courses.length;
    return { courses: courses, warnings: warnings, scope: { from: scope.from, to: scope.to, complete: scope.complete && stats.rejectedRows === 0, declaredComplete: scope.complete }, stats: stats };
  }

  function validateCandidate(course) {
    if (!course || typeof course !== 'object' || text(course.id, 160, true) === null || text(course.name, 80, true) === null || !integer(course.day, 1, 7) || !Array.isArray(course.dates) || !course.dates.length || course.dates.length > 1000) return false;
    if (course.timeMode === 'pending') {
      if (course.start !== null || course.end !== null || text(course.timeNote, 160, true) === null) return false;
    } else if (course.timeMode !== undefined && course.timeMode !== 'periods') return false;
    else if (!integer(course.start, 1, 10) || !integer(course.end, course.start, 10)) return false;
    if (text(course.room, 120, false) === null || text(course.teacher, 120, false) === null || sourceTime(course.sourceTime) === null || (course.timeMode !== 'pending' && course.end > 8 && !sourceTime(course.sourceTime))) return false;
    if (course.color !== undefined && COLORS.indexOf(course.color) < 0 && !(typeof course.color === 'string' && /^#[\da-f]{6}$/i.test(course.color))) return false;
    return !course.dates.some(function (value) { var info = dateInfo(value); return !info || info.day !== course.day; });
  }
  function copyCandidate(course, dates, id) {
    var result = { id: id, name: course.name, day: course.day, start: course.start, end: course.end, room: course.room || '', teacher: course.teacher || '', color: course.color || 'teal', dates: dates, sourceTime: sourceTime(course.sourceTime) };
    if (course.timeMode === 'pending') { result.timeMode = 'pending'; result.timeNote = course.timeNote; }
    return result;
  }
  function equivalentMetadata(a, b) { return (a.room || '') === (b.room || '') && (a.teacher || '') === (b.teacher || '') && (sourceTime(a.sourceTime) || '') === (sourceTime(b.sourceTime) || ''); }

  function planImport(currentState, candidateCourses) {
    if (!currentState || !Array.isArray(currentState.courses) || !Array.isArray(candidateCourses) || candidateCourses.length > 500) fail('IMPORT_INPUT_INVALID');
    var existing = new Map(), ids = new Set(), additions = [], warnings = [];
    var stats = { candidateCourses: candidateCourses.length, candidateMeetings: 0, addedCourses: 0, addedMeetings: 0, exactSkippedMeetings: 0, possibleChangesSkippedMeetings: 0, invalidCourses: 0, rejectedMeetings: 0, duplicateCandidateDates: 0 };
    currentState.courses.forEach(function (course) {
      if (!course || !Array.isArray(course.dates)) fail('CURRENT_COURSES_INVALID');
      ids.add(course.id);
      course.dates.forEach(function (date) {
        var key = meetingKey(course, date);
        if (!existing.has(key)) existing.set(key, []);
        existing.get(key).push(course);
      });
    });
    candidateCourses.forEach(function (course, index) {
      var count = course && Array.isArray(course.dates) ? course.dates.length : 0;
      stats.candidateMeetings += count;
      if (!validateCandidate(course)) {
        stats.invalidCourses++; stats.rejectedMeetings += count;
        warnings.push(warning('CANDIDATE_INVALID', course, undefined, { candidateIndex: index })); return;
      }
      var dates = [], seenDates = new Set();
      course.dates.forEach(function (date) {
        if (seenDates.has(date)) { stats.duplicateCandidateDates++; warnings.push(warning('DUPLICATE_CANDIDATE_DATE', { name: course.name, date: date }, undefined, { candidateIndex: index })); return; }
        seenDates.add(date);
        var key = meetingKey(course, date), found = existing.get(key);
        if (found) {
          if (found.some(function (other) { return equivalentMetadata(other, course); })) stats.exactSkippedMeetings++;
          else { stats.possibleChangesSkippedMeetings++; warnings.push(warning('POSSIBLE_PORTAL_ADJUSTMENT_SKIPPED', { name: course.name, date: date }, undefined, { candidateIndex: index, existingIds: found.map(function (other) { return other.id; }) })); }
          return;
        }
        dates.push(date); existing.set(key, [course]);
      });
      if (!dates.length) return;
      dates.sort();
      var id = course.id;
      if (ids.has(id)) {
        id = 'just-' + stableHash(JSON.stringify([courseKey(course), dates]));
        var suffix = 1, base = id;
        while (ids.has(id)) { id = base + '-' + suffix; suffix++; }
        warnings.push(warning('ID_COLLISION_REKEYED', course, undefined, { candidateIndex: index, assignedId: id }));
      }
      ids.add(id); additions.push(copyCandidate(course, dates, id)); stats.addedMeetings += dates.length;
    });
    stats.addedCourses = additions.length;
    if (currentState.courses.length + additions.length > 500) fail('MERGED_COURSE_LIMIT');
    var nextState = {};
    Object.keys(currentState).forEach(function (key) { Object.defineProperty(nextState, key, { value: currentState[key], enumerable: true, configurable: true, writable: true }); });
    nextState.courses = currentState.courses.concat(additions);
    return { nextState: nextState, additions: additions, warnings: warnings, stats: stats, limitations: ['Additions only: no deletion or replacement.', 'Without a prior import baseline, deleted or renamed/rescheduled source meetings cannot be distinguished from new meetings.'] };
  }

  return { normalizeCapture: normalizeCapture, planImport: planImport };
});
