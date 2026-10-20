(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SuikeNoticeEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // This module deliberately does not infer periods from "下午", "晚上", or
  // "下课后", nor pair a list of teaching weeks with laboratory rooms by order.
  // parse is a preview only. A caller must explicitly confirm each merged row.
  var MAX_TEXT = 12000;
  var MAX_DRAFTS = 1000;
  var DAY = 86400000;
  var NUM = '[0-9一二两三四五六七八九十]+';
  var COLORS = ['teal', 'blue', 'amber', 'rose', 'purple'];

  function fail(code, message) {
    var error = new Error(message || code);
    error.code = code;
    throw error;
  }
  function plain(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  function integer(value, min, max) {
    return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value >= min && value <= max;
  }
  function field(value, max, required, code) {
    if (value == null && !required) return '';
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || required && !value.trim()) fail(code || 'TEXT_INVALID', '字段为空、过长或包含无效字符');
    return value.trim();
  }
  function pad(value) { return value < 10 ? '0' + value : String(value); }
  function isoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    var p = value.split('-').map(Number);
    if (p[0] < 1900 || p[0] > 2200) return null;
    var date = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return date.getUTCFullYear() === p[0] && date.getUTCMonth() === p[1] - 1 && date.getUTCDate() === p[2] ? date : null;
  }
  function dayOf(value) { var date = isoDate(value); return date ? date.getUTCDay() || 7 : null; }
  function addDays(value, offset) {
    var date = isoDate(value);
    if (!date || !integer(offset, -20000, 20000)) fail('DATE_INVALID', '日期或日期偏移无效');
    var output = new Date(date.getTime() + offset * DAY).toISOString().slice(0, 10);
    if (!isoDate(output)) fail('DATE_INVALID', '日期超出支持范围');
    return output;
  }
  function numberOf(value) {
    var source = String(value).replace(/\s/g, '');
    if (/^\d+$/.test(source)) return Number(source);
    var digits = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
    if (source === '十') return 10;
    if (source.indexOf('十') >= 0) {
      var parts = source.split('十');
      if (parts.length !== 2 || parts[0] && !digits[parts[0]] || parts[1] && !digits[parts[1]]) return NaN;
      return (parts[0] ? digits[parts[0]] : 1) * 10 + (parts[1] ? digits[parts[1]] : 0);
    }
    return digits[source] || NaN;
  }
  function normalize(value) {
    return value.replace(/[０-９]/g, function (c) { return String(c.charCodeAt(0) - 65296); })
      .replace(/\r\n?/g, '\n').replace(/[（]/g, '(').replace(/[）]/g, ')')
      .replace(/[，]/g, ',').replace(/[；]/g, ';').replace(/[：]/g, ':')
      .replace(/[－–—～~]/g, '-').replace(/([0-9一二两三四五六七八九十])\s*[至到]\s*(?=[0-9一二两三四五六七八九十])/g, '$1-').replace(/星期|礼拜/g, '周');
  }
  function uniq(values) {
    return values.filter(function (value, index) { return values.indexOf(value) === index; });
  }
  function hash(value) {
    // Two independent 32-bit hashes keep IDs short without depending on crypto,
    // networking, randomness, WebView APIs, or the wording surrounding an event.
    var a = 2166136261, b = 2246822519;
    for (var i = 0; i < value.length; i++) {
      a = Math.imul(a ^ value.charCodeAt(i), 16777619);
      b = Math.imul(b ^ value.charCodeAt(i), 3266489917);
    }
    function hex(n) { return ('00000000' + (n >>> 0).toString(16)).slice(-8); }
    return hex(a) + hex(b);
  }
  function warning(list, code, message, detail) {
    var item = { code: code, message: message };
    if (detail) Object.keys(detail).forEach(function (key) { item[key] = detail[key]; });
    var serialized = JSON.stringify(item);
    if (!list.some(function (existing) { return JSON.stringify(existing) === serialized; })) list.push(item);
    return item;
  }
  function parseWeekExpression(expression, parity, totalWeeks) {
    var clean = expression.replace(/第|\s/g, '').replace(/和|及/g, ',').replace(/、/g, ',');
    var result = [];
    clean.split(',').forEach(function (part) {
      var range = part.split('-');
      var first = numberOf(range[0]), last = range.length === 1 ? first : numberOf(range[1]);
      if (range.length > 2 || !integer(first, 1, totalWeeks) || !integer(last, first, totalWeeks)) fail('WEEK_INVALID', '周次须为 1-' + totalWeeks + ' 内的有效周次或范围');
      for (var week = first; week <= last; week++) {
        if (!parity || parity === '单' && week % 2 === 1 || parity === '双' && week % 2 === 0) result.push(week);
      }
    });
    if (!result.length) fail('WEEK_INVALID', '单双周筛选后没有有效周次');
    return uniq(result).sort(function (a, b) { return a - b; });
  }
  function temporalHeaders(text, totalWeeks, warnings) {
    var headers = [], match;
    var weeks = new RegExp('(?:第\\s*)?(' + NUM + '(?:\\s*(?:[-、,]|和|及)\\s*(?:第\\s*)?' + NUM + ')*)\\s*周(?:\\s*\\(?\\s*(单|双)(?:周)?\\s*\\)?)?', 'g');
    while ((match = weeks.exec(text))) {
      var list = [], issue = null;
      try { list = parseWeekExpression(match[1], match[2], totalWeeks); }
      catch (error) { issue = warning(warnings, error.code, error.message, { text: match[0] }); }
      headers.push({ index: match.index, end: weeks.lastIndex, weeks: list, dates: [], issues: issue ? [issue.code] : [], raw: match[0] });
    }
    var alternatives = new RegExp('(?:第\\s*)?' + NUM + '\\s*或\\s*(?:第\\s*)?' + NUM + '\\s*周', 'g');
    while ((match = alternatives.exec(text))) {
      var alternativeStart = match.index, alternativeEnd = alternatives.lastIndex;
      headers.forEach(function (header) {
        if (header.index >= alternativeStart && header.index < alternativeEnd) {
          header.index = alternativeStart; header.weeks = []; header.issues.push('WEEK_ALTERNATIVE_UNCLEAR');
        }
      });
      warning(warnings, 'WEEK_ALTERNATIVE_UNCLEAR', '通知给出了可选周次，请确定实际周次后再导入。');
    }
    var dates = /(?:\d{4}-\d{1,2}-\d{1,2}|(?:\d{4}年)?\d{1,2}月\d{1,2}[日号])/g;
    while ((match = dates.exec(text))) {
      var token = match[0], date = null, dateIssue = null;
      var parts = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(token) || /^(\d{4})年(\d{1,2})月(\d{1,2})[日号]$/.exec(token);
      if (!parts) dateIssue = warning(warnings, 'DATE_YEAR_REQUIRED', '通知中的月日没有年份，请补全具体日期，不能默认套用当前年份。', { text: token });
      else {
        date = parts[1] + '-' + pad(Number(parts[2])) + '-' + pad(Number(parts[3]));
        if (!isoDate(date)) { date = null; dateIssue = warning(warnings, 'DATE_INVALID', '通知中有不存在或超出范围的日期。', { text: token }); }
      }
      headers.push({ index: match.index, end: dates.lastIndex, weeks: [], dates: [date], issues: dateIssue ? [dateIssue.code] : [], raw: token });
    }
    headers.sort(function (a, b) { return a.index - b.index; });
    // A list such as "第9周、第10周、第12周" is one temporal scope. The
    // same is true of an explicit date in parentheses after a week number.
    var grouped = [];
    headers.forEach(function (header) {
      var previous = grouped[grouped.length - 1];
      if (previous && /^[\s,、;()和及]*$/.test(text.slice(previous.end, header.index))) {
        previous.end = header.end;
        previous.weeks = uniq(previous.weeks.concat(header.weeks)).sort(function (a, b) { return a - b; });
        previous.dates = uniq(previous.dates.concat(header.dates));
        previous.issues = uniq(previous.issues.concat(header.issues));
        previous.raw += ' ' + header.raw;
      } else grouped.push(header);
    });
    return grouped;
  }
  function labelOf(text, kind) {
    var regexp = new RegExp('(?:第\\s*)?(' + NUM + '(?:\\s*[-、,]\\s*(?:第\\s*)?' + NUM + ')*)\\s*' + kind, 'g');
    var result = [], match;
    while ((match = regexp.exec(text))) {
      match[1].replace(/第|\s/g, '').split(/[、,]/).forEach(function (part) {
        var range = part.split('-'), first = numberOf(range[0]), last = range.length === 1 ? first : numberOf(range[1]);
        if (!integer(first, 1, 999) || !integer(last, first, 999)) return;
        for (var id = first; id <= last; id++) result.push(id);
      });
    }
    return uniq(result);
  }
  function labNumbers(text) {
    var result = [], match, regex = new RegExp('实验\\s*(' + NUM + ')', 'g');
    while ((match = regex.exec(text))) result.push(numberOf(match[1]));
    return result;
  }
  function roomInfo(text, warnings) {
    var locations = [], matches, regex = /(?:实验地点|上课地点|地点|教室)\s*:?\s*([^。!！;\n]+)/g;
    while ((matches = regex.exec(text))) locations.push({ index: matches.index, text: matches[1].trim() });
    var maps = {}, rooms = [];
    locations.forEach(function (location) {
      var section = location.text;
      var groups = new RegExp('((?:实验\\s*' + NUM + ')(?:\\s*(?:[+、,]|和|及|与)\\s*(?:实验\\s*)?' + NUM + ')*)\\s*\\(([^()]+)\\)', 'g');
      var m, mapped = false;
      while ((m = groups.exec(section))) {
        mapped = true;
        var ids = m[1].replace(/实验/g, '').split(/[+、,和及与]/).map(function (value) { return numberOf(value); });
        var room = m[2].trim();
        ids.forEach(function (id) {
          if (Object.prototype.hasOwnProperty.call(maps, id) && maps[id] !== room) {
            maps[id] = null;
            warning(warnings, 'ROOM_CONTRADICTION', '同一个实验出现了不同地点，请逐项核对。');
          } else maps[id] = room;
        });
        rooms.push(room);
      }
      if (!mapped && !/实验\s*[0-9一二三四五六七八九十]|或|待定|另行通知/.test(section)) {
        if (/[/、,]|\+/.test(section)) warning(warnings, 'ROOM_AMBIGUOUS', '通知列出多个地点，请为每次实验选择地点。');
        else rooms.push(section.replace(/[)\s]+$/, '').trim());
      }
    });
    return { maps: maps, rooms: uniq(rooms), locations: locations, room: uniq(rooms).length === 1 ? rooms[0] : '' };
  }
  function orderedLabs(body, weekCount) {
    var schedule = body.split(/(?:实验地点|上课地点|地点|教室)\s*:/)[0];
    var marker = /(?:分别|依次|对应)(?:进行|开展|完成|安排|为|是)?\s*/.exec(schedule);
    if (!marker) return [];
    var tail = schedule.slice(marker.index + marker[0].length);
    var list = labNumbers(tail);
    // "分别" is only meaningful when it explicitly introduces a lab list,
    // rather than a preceding list of times or rooms.
    return /^实验\s*[0-9一二两三四五六七八九十]/.test(tail) && list.length === weekCount ? list : [];
  }
  function scheduleEvents(body) {
    var regex = new RegExp('周([一二三四五六日天1-7])|(?:第\\s*)?(' + NUM + '(?:\\s*[-、,]\\s*' + NUM + ')*)\\s*节(?:\\s*(?:下课后|下课以后|课后|结束后))?|[0-2]?\\d:[0-5]\\d\\s*-\\s*[0-2]?\\d:[0-5]\\d|上午|中午|下午|晚上|晚间|晚自习|全天|下课后|课后', 'g');
    var tokens = [], match, currentDay = null;
    while ((match = regex.exec(body))) {
      if (match[1]) {
        currentDay = /[日天]/.test(match[1]) ? 7 : numberOf(match[1]);
        tokens.push({ type: 'day', day: currentDay, start: match.index, end: regex.lastIndex, text: match[0] });
      } else tokens.push({ type: match[2] ? 'periods' : /\d:/.test(match[0]) ? 'clock' : 'word', day: currentDay, start: match.index, end: regex.lastIndex, text: match[0], expression: match[2] || '' });
    }
    var result = [];
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      if (token.type === 'day') continue;
      var next = tokens[i + 1];
      if (token.type === 'word' && /^(上午|中午|下午|晚上|晚间)$/.test(token.text) && next && next.type === 'periods' && /^\s*$/.test(body.slice(token.end, next.start))) {
        token = { type: 'periods', day: token.day, start: token.start, end: next.end, text: token.text + next.text, expression: next.expression, timeOfDay: token.text };
        i++;
      }
      next = tokens[i + 1];
      var suffixEnd = next ? next.start : body.length;
      var suffix = body.slice(token.end, suffixEnd).split(/(?:实验地点|上课地点|地点|教室)\s*:/)[0];
      if (next && next.type === 'day') suffix = suffix.replace(new RegExp('[,、;+]\\s*(?:第\\s*)?' + NUM + '\\s*[班批]\\s*:?\\s*$'), '');
      var prefixStart = result.length ? result[result.length - 1].end : 0;
      // Only immediately adjacent prefix labels are in scope; labels attached
      // to the previous event must never leak into this event.
      var prefix = body.slice(prefixStart, token.start);
      var prefixLabel = new RegExp('((?:第\\s*)?' + NUM + '(?:\\s*[-、,]\\s*' + NUM + ')*\\s*[班批])\\s*[:：]?\\s*(?:周[一二三四五六日天1-7]\\s*)?$').exec(body.slice(0, token.start));
      var labelPrefix = prefixLabel ? prefixLabel[1] : '';
      result.push({ type: token.type, day: token.day, start: token.start, end: suffixEnd, text: token.text, expression: token.expression, timeOfDay: token.timeOfDay || '', suffix: suffix, classes: labelOf(suffix + ';' + labelPrefix, '班'), batches: labelOf(suffix + ';' + labelPrefix, '批'), labs: labNumbers(suffix) });
    }
    return result;
  }
  function eventTime(event, issues, warnings) {
    var result = { start: null, end: null, timeMode: 'pending', timeNote: event.text, sourceTime: '' };
    var after = /下课后|下课以后|课后|结束后/.test(event.text + event.suffix);
    if (event.type === 'periods') {
      var values = event.expression.split(/[-、,]/).map(numberOf);
      var first = values[0], last = values[values.length - 1];
      var valid = integer(first, 1, 24) && integer(last, first, 24);
      if (/、|,/.test(event.expression)) {
        for (var index = 1; index < values.length; index++) if (values[index] !== values[index - 1] + 1) valid = false;
      }
      if (!valid) {
        issues.push('PERIODS_INVALID');
        warning(warnings, 'PERIODS_INVALID', '节次范围无效或不连续，请人工填写本次实验的开始和结束节次。');
      } else if (after) {
        result.referencePeriods = { start: first, end: last };
        result.timeNote = '第' + first + (first === last ? '' : '-' + last) + '节下课后（实际开始时间待确认）';
        issues.push('AFTER_CLASS_TIME_UNCLEAR');
        warning(warnings, 'AFTER_CLASS_TIME_UNCLEAR', '“下课后”描述的是参照时间，不能自动换算成后面的节次。');
      } else {
        result.start = first; result.end = last; result.timeMode = 'periods'; result.timeNote = '';
        if (event.timeOfDay === '上午' && last > 4 || event.timeOfDay === '下午' && (first < 5 || last > 8) || /晚上|晚间/.test(event.timeOfDay) && first < 9) {
          issues.push('TIME_DESCRIPTION_CONTRADICTION');
          warning(warnings, 'TIME_DESCRIPTION_CONTRADICTION', '时段文字与节次描述不一致，请核对后确认。');
        }
        if (last > 8) {
          issues.push('NIGHT_CLOCK_UNCONFIRMED');
          warning(warnings, 'NIGHT_CLOCK_UNCONFIRMED', '已识别第9-10节；晚间实际钟点时间请按通知补充。');
        }
      }
    } else {
      if (event.type === 'clock') {
        var times = event.text.replace(/\s/g, '').split('-');
        result.sourceTime = times.map(function (time) { var p = time.split(':'); return pad(Number(p[0])) + ':' + p[1]; }).join('-');
      }
      issues.push(after ? 'AFTER_CLASS_TIME_UNCLEAR' : 'PERIODS_REQUIRED');
      warning(warnings, after ? 'AFTER_CLASS_TIME_UNCLEAR' : 'PERIODS_REQUIRED', after ? '“下课后”不能自动换算成节次，请填写实际时间或保留待确认。' : '只有时段或钟点描述，不能自动推定节次；本条保留为时间待确认。');
    }
    return result;
  }
  function parse(text, context) {
    if (typeof text !== 'string' || !text.trim()) fail('TEXT_REQUIRED', '请粘贴实验通知');
    if (text.length > MAX_TEXT) fail('TEXT_TOO_LONG', '通知最多支持 ' + MAX_TEXT + ' 个字符');
    context = context || {};
    if (!plain(context)) fail('CONTEXT_INVALID', '通知上下文无效');
    var warnings = [], normalized = normalize(text), drafts = [];
    var totalWeeks = context.totalWeeks == null ? 52 : context.totalWeeks;
    if (!integer(totalWeeks, 1, 52)) fail('TOTAL_WEEKS_INVALID', '学期周数须为 1-52 的整数');
    var monday = context.startMonday || null;
    if (monday && (!isoDate(monday) || dayOf(monday) !== 1)) fail('START_MONDAY_INVALID', '第一周开始日期必须是有效的周一');
    var classNumber = context.classNumber == null || context.classNumber === '' ? null : numberOf(context.classNumber);
    var batchNumber = context.batchNumber == null || context.batchNumber === '' ? null : numberOf(context.batchNumber);
    if (classNumber !== null && !integer(classNumber, 1, 999) || batchNumber !== null && !integer(batchNumber, 1, 999)) fail('GROUP_INVALID', '班级、批次须为有效编号');
    var headers = temporalHeaders(normalized, totalWeeks, warnings);
    var rawNum = '[0-9０-９一二两三四五六七八九十]+';
    var rawHeader = new RegExp('(?:第\\s*)?' + rawNum + '(?:\\s*(?:[-－–—～~至到、,，]|和|及|或)\\s*(?:第\\s*)?' + rawNum + ')*\\s*周|[0-9０-９]{4}[-年]|[0-9０-９]{1,2}月[0-9０-９]{1,2}[日号]').exec(text);
    var candidateName = rawHeader ? text.slice(0, rawHeader.index) : headers.length ? normalized.slice(0, headers[0].index) : '';
    candidateName = candidateName.replace(/^\s*(?:【(?:实验通知|课程通知|通知)】|\[(?:实验通知|课程通知|通知)\]|(?:实验通知|课程通知|通知)(?:\s*[:：]|\s+))\s*/, '').replace(/[\s:：;,，。!！()（）]+$/, '').trim();
    var name = field(context.courseName || candidateName, 80, false, 'NAME_INVALID');
    if (!name) warning(warnings, 'COURSE_NAME_REQUIRED', '请填写课程名称，通知里的名称不会自动替换成其他课程。');
    var roomData = roomInfo(normalized, warnings);
    if (!headers.length) {
      warning(warnings, 'DATES_REQUIRED', '未识别到完整周次或日期，请为候选安排补全日期。');
      headers = [{ index: 0, end: 0, weeks: [], dates: [], issues: ['DATES_REQUIRED'], raw: '' }];
    }
    var hasAnyBatchLabels = /(?:第\s*)?[0-9一二两三四五六七八九十]+\s*批/.test(normalized);
    headers.forEach(function (header, scopeIndex) {
      var body = normalized.slice(header.end, headers[scopeIndex + 1] ? headers[scopeIndex + 1].index : normalized.length);
      var localRooms = roomInfo(body, warnings);
      var scopeRooms = localRooms.locations.length ? localRooms : roomData;
      var events = scheduleEvents(body);
      var labOrder = orderedLabs(body, header.weeks.length);
      var directLabMatch = new RegExp('实验\\s*(' + NUM + ')\\s*[:：]?\\s*$').exec(normalized.slice(Math.max(0, header.index - 25), header.index));
      if (!directLabMatch) directLabMatch = new RegExp('^[\\s,、:;()]*实验\\s*(' + NUM + ')(?:[\\s,、:;()]|周)').exec(body);
      var directLab = directLabMatch ? numberOf(directLabMatch[1]) : null;
      var batchAmbiguous = batchNumber !== null && hasAnyBatchLabels && events.some(function (event) { return !event.batches.length; }) && events.length > 1;
      if (!events.length) warning(warnings, 'TIME_REQUIRED', '有周次或日期，但未识别到时间；请人工补全本段通知。', { scope: scopeIndex });
      events.forEach(function (event, eventIndex) {
        if (classNumber !== null && event.classes.length && event.classes.indexOf(classNumber) < 0) return;
        if (batchNumber !== null && event.batches.length && event.batches.indexOf(batchNumber) < 0) return;
        var commonIssues = header.issues.slice();
        if (/或/.test(body.slice(0, event.end).split(/(?:实验地点|上课地点|地点|教室)\s*:/)[0])) {
          commonIssues.push('ALTERNATIVE_TIME_UNCLEAR');
          warning(warnings, 'ALTERNATIVE_TIME_UNCLEAR', '通知包含备选星期或时间，请确定实际参加的安排。');
        }
        if (/取消|暂停|改为|改到|调整|另行通知/.test(body)) {
          commonIssues.push('NOTICE_CHANGE_REQUIRES_REVIEW');
          warning(warnings, 'NOTICE_CHANGE_REQUIRES_REVIEW', '这是取消或调整类通知，请确认候选安排是否仍然有效，并在课表中核对原安排。');
        }
        if (!name) commonIssues.push('COURSE_NAME_REQUIRED');
        if (classNumber === null && event.classes.length) {
          commonIssues.push('CLASS_REQUIRED');
          warning(warnings, 'CLASS_REQUIRED', '通知按班级安排时间，请先选择自己的班级。');
        }
        if (batchNumber === null && event.batches.length) {
          commonIssues.push('BATCH_REQUIRED');
          warning(warnings, 'BATCH_REQUIRED', '通知按批次安排时间，请先选择自己的批次。');
        }
        if (batchAmbiguous && !event.batches.length) {
          commonIssues.push('BATCH_MAPPING_UNCLEAR');
          warning(warnings, 'BATCH_MAPPING_UNCLEAR', '本段多个时段没有明确对应批次，请逐条选择自己参加的安排。');
        }
        var time = eventTime(event, commonIssues, warnings);
        var occurrences = [];
        if (header.dates.length) {
          header.dates.forEach(function (date) { occurrences.push({ week: null, date: date, day: event.day || dayOf(date) }); });
        } else if (header.weeks.length) {
          header.weeks.forEach(function (week) { occurrences.push({ week: week, date: monday && event.day ? addDays(monday, (week - 1) * 7 + event.day - 1) : null, day: event.day }); });
        } else occurrences.push({ week: null, date: null, day: event.day });
        occurrences.forEach(function (occurrence, occurrenceIndex) {
          if (drafts.length >= MAX_DRAFTS) fail('DRAFT_LIMIT_EXCEEDED', '通知生成的候选安排超过 ' + MAX_DRAFTS + ' 条');
          var issues = commonIssues.slice(), date = occurrence.date, day = occurrence.day;
          if (!day) {
            issues.push('DAY_REQUIRED');
            warning(warnings, 'DAY_REQUIRED', '缺少明确星期，不能把周次换算成上课日期。');
          }
          if (header.weeks.length && !monday) {
            issues.push('START_MONDAY_REQUIRED');
            warning(warnings, 'START_MONDAY_REQUIRED', '请先设置第一周周一，才能把周次换算成具体日期。');
          }
          if (date && event.day && dayOf(date) !== event.day) {
            issues.push('DATE_DAY_MISMATCH'); date = null;
            warning(warnings, 'DATE_DAY_MISMATCH', '通知中的具体日期与星期不一致，请人工核对。');
          }
          if (date && header.weeks.length && monday && header.weeks.indexOf(Math.floor((isoDate(date) - isoDate(monday)) / (DAY * 7)) + 1) < 0) {
            issues.push('DATE_WEEK_MISMATCH'); date = null;
            warning(warnings, 'DATE_WEEK_MISMATCH', '通知中的具体日期与教学周次不一致，请人工核对。');
          }
          var lab = event.labs.length === 1 ? event.labs[0] : directLab || labOrder[occurrenceIndex] || null;
          var room = scopeRooms.room;
          if (lab && Object.prototype.hasOwnProperty.call(scopeRooms.maps, lab)) room = scopeRooms.maps[lab] || '';
          if (!room && (scopeRooms.locations.length || Object.keys(scopeRooms.maps).length)) {
            issues.push('ROOM_MAPPING_UNCLEAR');
            warning(warnings, 'ROOM_MAPPING_UNCLEAR', '实验地点按实验项目区分，但周次与实验项目没有明确对应；请逐次确认地点。');
          }
          if (!room && !scopeRooms.locations.length) {
            issues.push('ROOM_REQUIRED');
            warning(warnings, 'ROOM_REQUIRED', '通知未提供明确地点，可补填或明确保留地点待确认。');
          }
          var draft = {
            draftId: 'notice-draft-' + hash(normalized + '|' + scopeIndex + '|' + eventIndex + '|' + occurrenceIndex),
            name: name, week: occurrence.week, date: date, dates: date ? [date] : [], day: day,
            start: time.start, end: time.end, timeMode: time.timeMode, timeNote: time.timeNote,
            sourceTime: time.sourceTime, room: room, teacher: '', color: 'teal',
            classNumber: event.classes.length === 1 ? event.classes[0] : classNumber,
            batchNumber: event.batches.length === 1 ? event.batches[0] : batchNumber,
            labNumber: lab, sourceText: event.text + event.suffix.trim(),
            issues: uniq(issues), needsConfirmation: true, confirmed: false
          };
          if (time.referencePeriods) draft.referencePeriods = time.referencePeriods;
          drafts.push(draft);
        });
      });
    });
    if (!drafts.length) warning(warnings, 'NO_MATCHING_SCHEDULE', '未找到符合当前班级、批次的完整候选安排，请检查通知和选择。');
    return { drafts: drafts, warnings: warnings, sourceText: text, context: { courseName: name, startMonday: monday, totalWeeks: totalWeeks, classNumber: classNumber, batchNumber: batchNumber } };
  }

  function sourceTime(value) {
    var result = field(value, 40, false, 'SOURCE_TIME_INVALID').replace(/[–—－~～至]/g, '-').replace(/\s/g, '');
    if (!result) return '';
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d$/.test(result) || result.slice(0, 5) >= result.slice(6)) fail('SOURCE_TIME_INVALID', '实际时间须为 HH:MM-HH:MM，且结束晚于开始');
    return result;
  }
  function validateCourse(course) {
    if (!plain(course)) fail('COURSE_INVALID', '课程数据无效');
    field(course.id, 160, true, 'ID_INVALID');
    field(course.name, 80, true, 'NAME_INVALID');
    if (!integer(course.day, 1, 7)) fail('DAY_INVALID', '星期须为 1-7 的整数');
    if (course.timeMode === 'pending') {
      if (course.start !== null || course.end !== null) fail('PENDING_PERIODS_INVALID', '待确认时间的节次必须为空');
      field(course.timeNote, 160, true, 'TIME_NOTE_REQUIRED');
    } else {
      if (course.timeMode !== undefined && course.timeMode !== 'periods' && course.timeMode !== 'clock') fail('TIME_MODE_INVALID', '时间模式无效');
      if (!integer(course.start, 1, 24) || !integer(course.end, course.start, 24)) fail('PERIODS_INVALID', '节次须在 1-24 内且结束不早于开始');
    }
    if (!Array.isArray(course.dates) || !course.dates.length || course.dates.length > 1000 || course.dates.some(function (date) { return !isoDate(date) || dayOf(date) !== course.day; })) fail('DATE_INVALID', '课程日期无效或与星期不符');
    field(course.room, 120, false, 'ROOM_INVALID');
    field(course.teacher, 120, false, 'TEACHER_INVALID');
    var color = course.color || 'teal';
    if (COLORS.indexOf(color) < 0 && !(typeof color === 'string' && /^#[\da-f]{6}$/i.test(color))) fail('COLOR_INVALID', '课程颜色无效');
    sourceTime(course.sourceTime);
    return course;
  }
  function validateState(state, options) {
    if (!plain(state) || state.schemaVersion !== 1 || !plain(state.settings)) fail('STATE_INVALID', '课表须为版本1并包含学期设置');
    if (!integer(state.settings.totalWeeks, 1, 52)) fail('TOTAL_WEEKS_INVALID', '学期周数须为 1-52');
    if (state.settings.startMonday && (!isoDate(state.settings.startMonday) || dayOf(state.settings.startMonday) !== 1)) fail('START_MONDAY_INVALID', '第一周开始日期须为周一');
    if (!Array.isArray(state.periods) || state.periods.length < 1 || state.periods.length > 24 || state.periods.some(function (period) { return !plain(period) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(period.start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(period.end) || period.start >= period.end; })) fail('PERIOD_SETTINGS_INVALID', '课时时间设置无效');
    if (!Array.isArray(state.courses) || state.courses.length > 500) fail('COURSE_LIMIT_EXCEEDED', '课程列表无效或超过500条');
    var ids = [];
    state.courses.forEach(function (course) {
      validateCourse(course);
      if (ids.indexOf(course.id) >= 0) fail('DUPLICATE_ID', '课程编号重复');
      ids.push(course.id);
    });
    if (options && typeof options.validateState === 'function') options.validateState(state);
    return state;
  }
  function courseFromDraft(draft) {
    if (!plain(draft)) fail('DRAFT_INVALID', '候选安排无效');
    var date = draft.date;
    if (date === undefined && Array.isArray(draft.dates) && draft.dates.length === 1) date = draft.dates[0];
    if (!isoDate(date)) fail('DATE_REQUIRED', '每条候选安排须有一个完整有效的上课日期');
    var course = {
      id: 'manual-notice-preview', name: field(draft.name, 80, true, 'NAME_INVALID'),
      day: draft.day, start: draft.start, end: draft.end,
      room: field(draft.room, 120, false, 'ROOM_INVALID'), teacher: field(draft.teacher, 120, false, 'TEACHER_INVALID'),
      color: draft.color || 'teal', dates: [date], sourceTime: sourceTime(draft.sourceTime)
    };
    if (draft.timeMode === 'clock') {
      course.timeMode = 'clock';
    } else if (draft.timeMode === 'pending' || draft.start === null && draft.end === null) {
      course.timeMode = 'pending'; course.timeNote = field(draft.timeNote, 160, true, 'TIME_NOTE_REQUIRED');
    } else if (draft.timeMode !== undefined && draft.timeMode !== 'periods' && draft.timeMode !== 'clock') fail('TIME_MODE_INVALID', '候选时间模式无效');
    validateCourse(course);
    course.id = 'manual-notice-' + hash(identity(course, date));
    return course;
  }
  function identity(course, date) {
    return JSON.stringify([course.name, date, course.day, course.start, course.end, course.timeMode === 'pending' ? course.timeNote : '', course.room || '', course.teacher || '', course.sourceTime || '']);
  }
  function sameOccurrence(a, b, date) {
    if (a.name !== b.name || a.day !== b.day || a.start !== b.start || a.end !== b.end || a.room !== b.room || (a.timeMode === 'pending') !== (b.timeMode === 'pending')) return false;
    if (a.timeMode === 'pending' && a.timeNote !== b.timeNote) return false;
    if (a.teacher && b.teacher && a.teacher !== b.teacher) return false;
    if (a.sourceTime && b.sourceTime && a.sourceTime !== b.sourceTime && (a.end > 8 || a.timeMode === 'pending')) return false;
    return a.dates.indexOf(date) >= 0 && b.dates.indexOf(date) >= 0;
  }
  function actualClock(course, periods) {
    if (course.timeMode === 'pending') return null;
    if(course.end>8&&!periods[course.end-1]&&!course.sourceTime)return null;
    if ((course.timeMode==='clock'||(!periods[course.start-1]||!periods[course.end-1])&&course.end>8)&&course.sourceTime) return { start:course.sourceTime.slice(0,5),end:course.sourceTime.slice(6) };
    var first = periods[course.start - 1], last = periods[course.end - 1];
    return first && last && first.start < last.end ? { start: first.start, end: last.end } : null;
  }
  function overlap(a, b, periods) {
    // The configured period table controls every ordinary course, including evenings.
    // Only independent clock arrangements or legacy missing periods use sourceTime.
    var left = actualClock(a, periods), right = actualClock(b, periods);
    if (!left || !right) return 'time-unresolved';
    if (left.start >= right.end || right.start >= left.end) return null;
    return a.end <= 8 && b.end <= 8 ? 'period-overlap' : 'clock-overlap';
  }
  function plan(state, drafts, options) {
    validateState(state, options);
    if (!Array.isArray(drafts) || drafts.length > MAX_DRAFTS) fail('DRAFT_LIMIT_EXCEEDED', '候选安排须为不超过1000条的数组');
    var additions = [], duplicates = [], conflicts = [], errors = [];
    var against = state.courses.map(function (course) { return { course: course, draftId: null }; });
    drafts.forEach(function (draft, index) {
      var draftId = plain(draft) && typeof draft.draftId === 'string' ? draft.draftId : 'draft-' + index;
      var course;
      try { course = courseFromDraft(draft); }
      catch (error) { errors.push({ draftId: draftId, index: index, code: error.code || 'DRAFT_INVALID', message: error.message }); return; }
      var date = course.dates[0];
      var collision = against.filter(function (other) { return other.course.id === course.id && !sameOccurrence(other.course, course, date); })[0];
      if (collision) { errors.push({ draftId: draftId, index: index, code: 'ID_COLLISION', message: '相同导入编号的已有课程已被编辑，请人工核对后创建新安排。' }); return; }
      var duplicate = against.filter(function (other) { return sameOccurrence(other.course, course, date); })[0];
      if (duplicate) {
        duplicates.push({ draftId: draftId, index: index, existingId: duplicate.course.id, existingDraftId: duplicate.draftId, date: date, course: course });
        return;
      }
      against.forEach(function (other) {
        if (other.course.day !== course.day || other.course.dates.indexOf(date) < 0) return;
        var type = overlap(course, other.course, state.periods);
        if (type) conflicts.push({ draftId: draftId, index: index, courseId: course.id, otherId: other.course.id, otherDraftId: other.draftId, otherName: other.course.name, date: date, type: type, blocking: false });
      });
      additions.push({ draftId: draftId, index: index, date: date, course: course, confirmed: draft.confirmed === true });
      against.push({ course: course, draftId: draftId });
    });
    if (state.courses.length + additions.length > 500) errors.push({ code: 'COURSE_LIMIT_EXCEEDED', message: '导入后课程超过500条，请减少候选安排。' });
    return { additions: additions, duplicates: duplicates, conflicts: conflicts, errors: errors, canCommit: errors.length === 0 && drafts.every(function (draft) { return plain(draft) && draft.confirmed === true; }) };
  }
  function merge(state, drafts, options) {
    if (!Array.isArray(drafts) || drafts.length > MAX_DRAFTS) fail('DRAFT_LIMIT_EXCEEDED', '候选安排须为不超过1000条的数组');
    if (drafts.some(function (draft) { return !plain(draft) || draft.confirmed !== true; })) fail('CONFIRMATION_REQUIRED', '请逐条确认候选安排后再导入');
    var preview = plan(state, drafts, options);
    if (preview.errors.length) fail(preview.errors[0].code, preview.errors[0].message);
    // Conflicts are informational in preview, but require a separate caller
    // acknowledgement so an accidental bulk confirmation cannot hide overlaps.
    if (preview.conflicts.length && !(options && options.allowConflicts === true)) fail('CONFLICT_CONFIRMATION_REQUIRED', '存在时间冲突或时间待确认的重叠，请核对后明确允许冲突导入');
    var next = JSON.parse(JSON.stringify(state));
    preview.additions.forEach(function (addition) { next.courses.push(addition.course); });
    validateState(next, options);
    return { state: next, plan: preview, summary: { added: preview.additions.length, duplicates: preview.duplicates.length, conflicts: preview.conflicts.length } };
  }
  return { version: 1, MAX_TEXT: MAX_TEXT, parse: parse, plan: plan, merge: merge, commit: merge, validateState: validateState, parseWeekExpression: parseWeekExpression };
});
