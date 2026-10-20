/* Test APK only. Injected into our isolated emulator's local timetable, never the school page. */
(function () {
  'use strict';
  var KEY = 'suike.timetable.v1';
  function check(value) { if (!value) throw new Error('QA_ASSERTION'); }
  function state() { return JSON.parse(localStorage.getItem(KEY) || JSON.stringify(window.TIMETABLE_SEED)); }
  // Test fixtures update the durable store as well as its compatibility mirror.
  function fixtureStorage(key, raw) {
    var bridge=window.SuikeNative;
    if(bridge&&typeof bridge.getWorkspaceCheckpoint==='function'){
      var saved=bridge.getWorkspaceCheckpoint(),box=saved&&saved!=='null'?JSON.parse(saved):{version:1,values:{'suike.timetable.v1':null,'suike.history.v1':null,'suike.semesters.v1':null,'suike.workspace.transaction.v1':null}};
      box.values[key]=raw;check(bridge.persistWorkspaceCheckpoint(JSON.stringify(box))===true);
    }
    if(raw===null)localStorage.removeItem(key);else localStorage.setItem(key,raw);return true;
  }
  function buttons(root) { return Array.from((root || document).querySelectorAll('button')); }
  function clickText(text, root) { var b = buttons(root).find(function (item) { return item.textContent.trim() === text; }); check(b); b.click(); }
  function summary() {
    var s = state(), labs = new Set(window.TIMETABLE_SEED.courses.filter(function (c) { return c.id.indexOf('imported-') !== 0; }).map(function (c) { return c.id; }));
    return { courses: s.courses.length, meetings: s.courses.reduce(function (n, c) { return n + c.dates.length; }, 0), labMeetings: s.courses.filter(function (c) { return labs.has(c.id); }).reduce(function (n, c) { return n + c.dates.length; }, 0), ledgerEntries: s.importLedger ? s.importLedger.entries.length : 0, tombstones: s.importLedger ? s.importLedger.entries.filter(function (e) { return e.tombstone; }).length : 0, renamed: s.courses.some(function (c) { return c.name === '测试_保留改名'; }), acceptedSourceMeetings: s.courses.filter(function (c) { return c.name === '示例电学1' && c.day === 5 && c.start === 3 && c.end === 4 && /示例教学楼BE-203/.test(c.room); }).reduce(function (n, c) { return n + c.dates.length; }, 0) };
  }
  function preview(fixture) {
    check(window.SuikeImport && window.SuikeImport.receiveCapture(fixture) === true);
    return inspectPreview();
  }
  function inspectPreview() {
    var panel = document.querySelector('.teaching-preview'); check(panel && !panel.hidden);
    var message = panel.querySelector('.teaching-message').textContent;
    var match = /^读到 (\d+) 次课：新增 (\d+)，已存在 (\d+)，需核对 (\d+)。$/.exec(message);
    check(match);
    return { read: Number(match[1]), additions: Number(match[2]), existing: Number(match[3]), review: Number(match[4]), protectedRows: Array.from(panel.querySelectorAll('.teaching-row p')).filter(function (p) { return p.textContent === '保留你的修改'; }).length, deletedRows: Array.from(panel.querySelectorAll('.teaching-row p')).filter(function (p) { return p.textContent === '你已删除，保留删除结果'; }).length };
  }
  function confirm() { var panel = document.querySelector('.teaching-preview'), b = buttons(panel).find(function (item) { return item.textContent.indexOf('确认') === 0 && !item.hidden; }); check(b); b.click(); check(panel.hidden); return summary(); }
  function acceptOneSourceUpdate() { var row = Array.from(document.querySelectorAll('.teaching-preview .teaching-row')).find(function (item) { return Array.from(item.querySelectorAll('label span')).some(function (span) { return span.textContent === '采用网页上的教室和教师'; }); }); check(row); var checkbox = row.querySelector('input[type=checkbox]'); check(checkbox && !checkbox.checked); checkbox.click(); check(checkbox.checked); return true; }
  function cancel() { var panel = document.querySelector('.teaching-preview'); clickText('取消', panel); check(panel.hidden); return true; }
  function openCourse(id) {
    var c = state().courses.find(function (item) { return item.id === id; }); check(c);
    document.querySelector('[data-view="week"]').click();
    var select = document.getElementById('weekSelect'); select.value = window.TimetableModel.mondayOf(c.dates[0]); select.dispatchEvent(new Event('change', { bubbles: true }));
    var prefix = String(c.start + 1) + ' / ' + String(c.day + 1) + ' /';
    var b = Array.from(document.querySelectorAll('.week-course')).find(function (item) { return item.querySelector('.course-name').textContent === c.name && item.style.gridArea.indexOf(prefix) === 0; }); check(b); b.click();
    check(document.getElementById('courseDialog').open); return c;
  }
  function edit(id, fields) {
    openCourse(id); document.getElementById('editCourse').click();
    var form = document.getElementById('courseForm'); check(form.elements.namedItem('id').value === id);
    Object.keys(fields).forEach(function (key) { form.elements.namedItem(key).value = String(fields[key]); });
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    check(document.getElementById('formError').hidden);
    return summary();
  }
  function prepareEdits() {
    var s = state();
    var renamed = s.courses.find(function (c) { return c.id.indexOf('imported-') === 0 && c.name === '示例物理2' && c.day === 1; });
    var moved = s.courses.find(function (c) { return c.id.indexOf('imported-') === 0 && c.name === '示例物理2' && c.day === 4; });
    var deleted = s.courses.find(function (c) { return c.id.indexOf('imported-') === 0 && c.name === '示例数学' && c.day === 3; });
    check(renamed && moved && deleted);
    return { renamedId: renamed.id, movedId: moved.id, deletedId: deleted.id, deletedCount: deleted.dates.length, protectedCount: renamed.dates.length + moved.dates.length };
  }
  function deleteCourse(id) { openCourse(id); document.getElementById('deleteCourse').click(); return summary(); }
  function verifyEdits(edits) { var s = state(); check(s.courses.find(function (c) { return c.id === edits.renamedId; }).name === '测试_保留改名'); var moved = s.courses.find(function (c) { return c.id === edits.movedId; }); check(moved && moved.start === 7 && moved.end === 8); check(!s.courses.some(function (c) { return c.id === edits.deletedId; })); return summary(); }
  function exportBackup() {
    var nativeBridge = window.SuikeNative; check(nativeBridge && typeof nativeBridge.exportBackup === 'function');
    window.__qaExport = null;
    /* Capture the real export button's serialized payload without opening another app. */
    window.SuikeNative = { exportBackup: function (name, json) { window.__qaExport = json; return true; } };
    try { document.getElementById('exportData').click(); } finally { window.SuikeNative = nativeBridge; }
    check(typeof window.__qaExport === 'string');
    window.TimetableModel.validateState(JSON.parse(window.__qaExport));
    return window.__qaExport;
  }
  window.__suikeQA = { state: state, summary: summary, preview: preview, inspectPreview: inspectPreview, confirm: confirm, acceptOneSourceUpdate: acceptOneSourceUpdate, cancel: cancel, prepareEdits: prepareEdits, editCourse: edit, deleteCourse: deleteCourse, verifyEdits: verifyEdits, exportBackup: exportBackup, openPortal: function () { document.querySelector('[data-view="settings"]').click(); clickText('打开学校网页'); return true; } };
  window.__suikeQA.fixtureStorage=fixtureStorage;
  // UI-only regression fixtures; never packaged in the shipping app.
  window.__suikeQA.layout = function () {
    function box(id) {
      var el = document.getElementById(id), r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return {width:r.width,height:r.height,top:r.top,bottom:r.bottom,radius:s.borderRadius,
        background:s.backgroundColor,color:s.color,border:s.borderColor,scrollHeight:el.scrollHeight};
    }
    return {viewportWidth:innerWidth,viewportHeight:innerHeight,add:box('addCourseWeek'),clear:box('clearTimetable'),
      settingsHeight:document.getElementById('settingsView').scrollHeight,
      folds:Array.from(document.querySelectorAll('.settings-fold')).map(function(el){return {id:el.id,open:el.open};}),
      horizontalOverflow:document.documentElement.scrollWidth>innerWidth};
  };
  window.__suikeQA.requestedLayout = function () {
    var grid=document.getElementById('weekGrid'),wrap=grid.parentElement,r=wrap.getBoundingClientRect();
    var summary=document.querySelector('#settingsSemesterDetails>summary'),style=getComputedStyle(summary);
    var nav=document.querySelector('.bottom-nav'),lens=nav.querySelector('.lg-nav-lens'),active=nav.querySelector('.nav-item.active');
    var l=lens.getBoundingClientRect(),a=active.getBoundingClientRect();
    return {glass:SuikeAppearance.isEnabled(),media:document.getElementById('suikeLiquidStyles').media,
      width:innerWidth,height:innerHeight,gridWidth:grid.getBoundingClientRect().width,wrapWidth:r.width,gridTop:r.top,gridBottom:r.bottom,navTop:nav.getBoundingClientRect().top,
      noPan:wrap.scrollWidth<=wrap.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth+1,
      allDays:Array.from(grid.querySelectorAll('.grid-day')).map(function(el){var b=el.getBoundingClientRect();return {name:el.textContent,left:b.left,right:b.right};}),
      rowHeights:Array.from(grid.querySelectorAll('.grid-time')).map(function(el){return el.getBoundingClientRect().height;}),
      clockDisplay:getComputedStyle(document.querySelector('.inst-clockrow')).display,
      courseCount:grid.querySelectorAll('.week-course').length,courseFont:getComputedStyle(grid.querySelector('.week-course .course-name')||grid).fontSize,
      summaryTransform:style.transform,summaryShadow:style.boxShadow,
      lensLeft:l.left,activeLeft:a.left,lensWidth:l.width,activeWidth:a.width,lensTop:l.top,activeTop:a.top,lensHeight:l.height,activeHeight:a.height,
      navFilter:nav.style.backdropFilter,filters:document.querySelectorAll('filter[id^=suike-clear-]').length,
      paper:getComputedStyle(document.body).backgroundColor,cardRadius:getComputedStyle(document.getElementById('settingsForm')).borderRadius,
      addRadius:getComputedStyle(document.getElementById('addCourseWeek')).borderRadius,
      foldOpen:document.getElementById('settingsSemesterDetails').open};
  };
  window.__suikeQA.largeCapture = function () {
    var rows=[];
    for(var day=1;day<=5;day++) for(var period=1;period<=5;period+=2) {
      rows.push({cell:day+'-'+period,name:'测试课程'+rows.length,
        lines:['('+period+'-'+(period+1)+'节)1-20周','测试教学楼-101','测试教师','(2026-2027-1)-QA'+rows.length+'-01'],selected:true});
    }
    return {source:'just-jwglxt-table',adapterVersion:1,term:{year:'2026-2027',semester:'1'},unscheduledPresent:false,rows:rows};
  };
  window.__suikeQA.importLayout = function () {
    var list=document.getElementById('teachingImportList'),actions=document.getElementById('teachingImportActions'),
      button=document.getElementById('confirmTeachingImport'),r=list.getBoundingClientRect(),a=actions.getBoundingClientRect(),
      b=button.getBoundingClientRect(),nav=document.querySelector('.bottom-nav').getBoundingClientRect();
    return {listHeight:r.height,scrollHeight:list.scrollHeight,scrollTop:list.scrollTop,
      confirmTop:b.top,confirmBottom:b.bottom,actionsTop:a.top,actionsBottom:a.bottom,navTop:nav.top,
      beforeList:a.bottom<=r.top,rows:list.querySelectorAll('.teaching-row').length,
      horizontalOverflow:document.documentElement.scrollWidth>innerWidth};
  };
  window.__suikeQA.liquid = function () {
    var nav=document.querySelector('.bottom-nav'),lens=nav.querySelector('.lg-nav-lens'),active=nav.querySelector('.nav-item.active');
    var l=lens&&lens.getBoundingClientRect(),a=active.getBoundingClientRect();
    return {ready:!!(window.SuikeLiquidUI&&SuikeLiquidUI.ready),
      commit:window.SuikeLiquidUI&&SuikeLiquidUI.optics&&SuikeLiquidUI.optics.commit,
      displacementChannels:document.querySelectorAll('filter[id^=suike-clear-] feDisplacementMap').length,
      offlineMap:!!document.querySelector('filter[id^=suike-clear-] feImage')&&/^data:image\/png;base64,/.test(document.querySelector('filter[id^=suike-clear-] feImage').getAttribute('href')),
      filter:getComputedStyle(nav).backdropFilter,
      optics:window.SuikeLiquidUI&&SuikeLiquidUI.optics,
      backdrop:getComputedStyle(nav).backdropFilter,view:active.dataset.view,
      lensLeft:l&&l.left,lensWidth:l&&l.width,activeLeft:a.left,activeWidth:a.width,
      visibleViews:document.querySelectorAll('.view:not([hidden])').length,
      touchHeights:Array.from(nav.querySelectorAll('.nav-item')).map(function(el){return el.getBoundingClientRect().height;}),
      folding:document.querySelectorAll('details.lg-folding').length,
      reduced:window.SuikeLiquidUI&&SuikeLiquidUI.motionReduced(),
      activeAnimations:document.getAnimations().length};
  };
  window.__suikeQA.press = function (id) {
    var el=document.getElementById(id),r=el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,isPrimary:true,pointerType:'touch',clientX:r.left+r.width*.7,clientY:r.top+r.height*.5}));
    return el.classList.contains('lg-pressed');
  };
  window.__suikeQA.release = function () {document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,isPrimary:true,pointerType:'touch'}));return true;};
  window.__suikeQA.sampleFrames = function (duration) {
    window.__qaFrameSample={done:false,intervals:[]};
    var start=performance.now(),previous=start;
    function sample(now){window.__qaFrameSample.intervals.push(now-previous);previous=now;
      if(now-start<(duration||500)) requestAnimationFrame(sample); else window.__qaFrameSample.done=true;}
    requestAnimationFrame(sample);return true;
  };
  window.__suikeQA.opticalProbe = function () {
    var nav=document.querySelector('.bottom-nav'),r=nav.getBoundingClientRect();
    window.__qaOpticalSaved={style:nav.style.cssText,children:Array.from(nav.children).map(function(el){return {el:el,style:el.style.cssText};})};
    Array.from(nav.children).forEach(function(el){el.style.visibility='hidden';});
    nav.style.background='transparent';nav.style.borderColor='transparent';nav.style.boxShadow='none';
    var probe=document.createElement('div');probe.id='qaOpticalProbe';
    probe.style.cssText='position:fixed;pointer-events:none;z-index:39;left:'+r.left+'px;top:'+r.top+'px;width:'+r.width+'px;height:'+r.height+'px;background:repeating-linear-gradient(90deg,#000 0,#000 8px,#fff 8px,#fff 16px)';
    document.body.appendChild(probe);
    nav.style.backdropFilter='blur(.65px)';nav.style.webkitBackdropFilter='blur(.65px)';
    return {left:r.left,top:r.top,width:r.width,height:r.height,dpr:devicePixelRatio,viewportWidth:innerWidth};
  };
  window.__suikeQA.enableProbeRefraction = function () {
    var nav=document.querySelector('.bottom-nav'),saved=document.createElement('div');saved.style.cssText=window.__qaOpticalSaved.style;
    nav.style.backdropFilter=saved.style.backdropFilter;nav.style.webkitBackdropFilter=saved.style.webkitBackdropFilter;return true;
  };
  window.__suikeQA.closeOpticalProbe = function () {
    var nav=document.querySelector('.bottom-nav');nav.style.cssText=window.__qaOpticalSaved.style;
    window.__qaOpticalSaved.children.forEach(function(item){item.el.style.cssText=item.style;});
    document.getElementById('qaOpticalProbe').remove();delete window.__qaOpticalSaved;return true;
  };
})();
