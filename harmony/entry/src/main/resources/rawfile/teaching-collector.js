/* Fixed, bundled DOM-only collector. The Android callback JSON-decodes twice. */
(function () {
  'use strict';
  var SOURCE = 'just-jwglxt-table', VERSION = 1;
  function stop(code) { var error = new Error(); error.collectorCode = code; throw error; }
  function smallText(element, max, required) {
    if (!element) stop('COURSE_FIELDS_INVALID');
    var raw = element.textContent;
    if (typeof raw !== 'string' || raw.length > max * 4 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) stop('COURSE_FIELDS_INVALID');
    var text = raw.replace(/\s+/g, ' ').trim();
    if (text.length > max || (required && !text)) stop('COURSE_FIELDS_INVALID');
    return text;
  }
  try {
    if (location.protocol !== 'https:' || location.hostname !== 'client.v.just.edu.cn' || !/\/jwglxt\/kbcx\/xskbcx_cxXskbcxIndex\.html$/.test(location.pathname)) stop('UNSUPPORTED_PAGE');
    var table = document.querySelector('#kbgrid_table_0');
    if (!table) stop('TABLE_MISSING');
    if (!table.rows || table.rows.length !== 14) stop('TABLE_INVALID');
    /* The first h6 is the semester title. Other h6 elements contain identity data. */
    var title = table.querySelector('h6'), titleText = title ? smallText(title, 80, true).replace(/\s/g, '') : '';
    var titleMatch = /^(\d{4}-\d{4})学年第([12])学期$/.exec(titleText);
    if (!titleMatch) stop('TERM_MISSING');
    /* Read selected option labels only, never form values, inputs or hidden fields. */
    var yearOption = document.querySelector('#ajaxForm #xnm option:checked'), semesterOption = document.querySelector('#ajaxForm #xqm option:checked');
    if (!yearOption || !semesterOption) stop('TERM_MISSING');
    var year = smallText(yearOption, 9, true), semester = smallText(semesterOption, 1, true), years = /^(\d{4})-(\d{4})$/.exec(year);
    if (!years || Number(years[1]) < 1900 || Number(years[2]) > 2200 || Number(years[2]) !== Number(years[1]) + 1 || !/^[12]$/.test(semester)) stop('TERM_INVALID');
    if (titleMatch[1] !== year || titleMatch[2] !== semester) stop('TERM_MISMATCH');
    var expectedDays = ['时间段', '节次', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
    var dayCells = table.rows[1].cells;
    if (!dayCells || dayCells.length !== expectedDays.length) stop('DAY_HEADERS_INVALID');
    for (var i = 0; i < expectedDays.length; i++) if (smallText(dayCells[i], 12, true) !== expectedDays[i]) stop('DAY_HEADERS_INVALID');
    /* Only known leading period-header cells are read; course text is collected below. */
    var periodTimes=[];
    for (var period = 1; period <= 11; period++) {
      var periodCells = table.rows[period + 1].cells;
      if (!periodCells || !periodCells.length) stop('PERIOD_HEADERS_INVALID');
      var first = smallText(periodCells[0], 80, true), observed;
      if (first === '上午' || first === '下午' || first === '晚上') observed = periodCells[1] ? smallText(periodCells[1], 80, true) : '';
      else observed = first;
      var clockHeader=/^(?:第)?(\d{1,2})(?:节)?(?:\s*[（(]?\s*((?:[01]?\d|2[0-3])[:：][0-5]\d)\s*(?:[-–—~～至]|\s+)\s*((?:[01]?\d|2[0-3])[:：][0-5]\d)\s*[）)]?)?$/.exec(observed);
      if (!clockHeader || Number(clockHeader[1]) !== period) stop('PERIOD_HEADERS_INVALID');
      if(clockHeader[2]&&period<=10){
        var times=[clockHeader[2],clockHeader[3]].map(function(value){var parts=value.replace('：',':').split(':');return ('0'+parts[0]).slice(-2)+':'+parts[1];});
        if(times[0]>=times[1])stop('PERIOD_HEADERS_INVALID');
        periodTimes.push({period:period,start:times[0],end:times[1]});
      }
    }
    var blocks = table.querySelectorAll('td[id] > div.timetable_con');
    if (!blocks.length) stop('NO_COURSES');
    if (blocks.length > 500) stop('TOO_MANY_COURSES');
    var rows = [];
    for (var b = 0; b < blocks.length; b++) {
      var block = blocks[b], cell = block.parentElement, nameNode = block.querySelector('.title'), paragraphs = block.querySelectorAll('p'), fonts = block.querySelectorAll('font');
      if (!cell || cell.tagName !== 'TD' || !/^([1-7])-(1[01]|[1-9])$/.test(cell.id) || !nameNode || paragraphs.length < 4 || !fonts.length || fonts.length > 20) stop('COURSE_FIELDS_INVALID');
      var isBlue = true, isRed = true;
      for (var f = 0; f < fonts.length; f++) {
        /* These literal color attributes and their meaning were observed on this page. */
        var color = fonts[f].getAttribute('color');
        if (color !== 'blue') isBlue = false;
        if (color !== 'red') isRed = false;
      }
      if (!isBlue && !isRed) stop('SELECTION_UNKNOWN');
      var lines = [];
      for (var p = 0; p < 4; p++) lines.push(smallText(paragraphs[p], 200, false));
      rows.push({ cell: cell.id, name: smallText(nameNode, 80, true), lines: lines, selected: isBlue });
    }
    /* Practice/other courses have no precise timetable slot. Return a flag only. */
    var bottom = table.rows[table.rows.length - 1].textContent;
    if (typeof bottom !== 'string' || bottom.length > 16000) stop('TABLE_INVALID');
    var capture = { source: SOURCE, adapterVersion: VERSION, term: { year: year, semester: semester }, rows: rows, unscheduledPresent: /实践课程|其它课程/.test(bottom) };
    if(periodTimes.length)capture.periods=periodTimes;
    var result = JSON.stringify(capture);
    if (result.length > 512 * 1024) stop('CAPTURE_TOO_LARGE');
    return result;
  } catch (error) {
    /* No exception messages, URLs, identity fields, form values, cookies or storage. */
    var allowed = ['UNSUPPORTED_PAGE', 'TABLE_MISSING', 'TABLE_INVALID', 'TERM_MISSING', 'TERM_INVALID', 'TERM_MISMATCH', 'DAY_HEADERS_INVALID', 'PERIOD_HEADERS_INVALID', 'NO_COURSES', 'TOO_MANY_COURSES', 'COURSE_FIELDS_INVALID', 'SELECTION_UNKNOWN', 'CAPTURE_TOO_LARGE'];
    var code = error && allowed.indexOf(error.collectorCode) >= 0 ? error.collectorCode : 'COLLECTOR_FAILED';
    return JSON.stringify({ source: SOURCE, adapterVersion: VERSION, error: code });
  }
})();
