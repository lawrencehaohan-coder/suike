  // APK-only local flow. External school pages never receive this entry point.
  const Teaching = window.TeachingParser, SafeMerge = window.JustSafeMerge, SchoolAdapters=window.SuikeSchoolAdapters;
  let teachingCapture = null, teachingNormalized = null, teachingPlan = null;
  let teachingChoices = new Map(), teachingManualTimesConfirmed=false;
  const importSection = node('section', 'settings-card');
  importSection.setAttribute('aria-labelledby', 'teachingImportTitle');
  const importTitle = node('h3', '', '导入教务课表'); importTitle.id = 'teachingImportTitle';
  const importHeading=settingsIconHeading(importTitle,['M12 15V3m9 12v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4','m7 10 5 5 5-5']);
  importSection.append(importHeading, node('p', 'settings-description', ''));
  const schoolField=node('label','field'),schoolSelect=node('select');schoolSelect.id='teachingSchool';schoolSelect.setAttribute('aria-label','导入课表的学校');
  SchoolAdapters.list().forEach(profile=>{const option=node('option','',profile.name+(profile.status==='trial'?'（试适配）':''));option.value=profile.id;schoolSelect.append(option);});
  schoolSelect.value=(SchoolAdapters.list().find(p=>state.importLedger&&state.importLedger.source.system===p.system)||SchoolAdapters.get(SchoolAdapters.defaultSchool)).id;
  schoolField.append(node('span','','学校'),schoolSelect);importSection.append(schoolField);
  importSection.querySelector('.settings-description').textContent=SchoolAdapters.get(schoolSelect.value).help;
  const openPortal = button('button button-primary', '打开学校网页', () => {
    try {
      if (!window.SuikeNative || typeof window.SuikeNative.openTeachingPortal !== 'function') throw new Error('请在随课安卓应用里打开');
      if(typeof window.SuikeNative.openTeachingPortalForSchool==='function')window.SuikeNative.openTeachingPortalForSchool(schoolSelect.value);
      else if(schoolSelect.value===SchoolAdapters.defaultSchool)window.SuikeNative.openTeachingPortal();
      else throw new Error('当前安卓版本尚未接入所选学校，请使用对应测试版本');
    } catch (error) { showToast(error.message || '暂时无法打开学校网页'); }
  });
  importSection.append(openPortal);
  const importPanel = node('div', 'teaching-preview'); importPanel.id = 'teachingImportPreview'; importPanel.hidden = true;
  const importTerm = node('p', 'teaching-term');
  const mondayLabel = node('label', 'field');
  const importMonday = document.createElement('input'); importMonday.type = 'date'; importMonday.required = true;
  importMonday.id = 'teachingStartMonday';
  mondayLabel.append(node('span', '', '本学期第一周周一'), importMonday, node('small', '', '用于把网页周次换算为日期；确认后也用于本地显示教学周。'));
  const previewButton = button('button button-outline', '核对导入内容', () => makeTeachingPreview());
  const importMessage = node('p', 'teaching-message'); importMessage.setAttribute('role', 'status');
  const importList = node('div', 'teaching-list'); importList.id = 'teachingImportList'; importList.hidden = true; importList.tabIndex = 0;
  importList.setAttribute('role', 'region'); importList.setAttribute('aria-label', '可滚动的课程导入明细');
  importList.setAttribute('aria-describedby', 'teachingPreviewHint');
  const importHint = node('p', 'teaching-list-hint', '课程明细可在下方区域内滚动查看，请核对后确认导入。'); importHint.id = 'teachingPreviewHint'; importHint.hidden = true;
  const confirmImport = button('button button-primary', '确认导入', submitTeachingImport); confirmImport.id = 'confirmTeachingImport'; confirmImport.hidden = true;
  const cancelImport = button('button button-outline', '取消', () => { teachingCapture = null; teachingNormalized = null; teachingPlan = null; importPanel.hidden = true; });
  const importActions = node('div', 'backup-actions teaching-import-actions'); importActions.id = 'teachingImportActions'; importActions.append(confirmImport, cancelImport);
  importPanel.append(importTerm, mondayLabel, previewButton, importMessage, importActions, importHint, importList);
  importSection.append(importPanel);
  const backupCard = $('backupTitle').closest('section'); backupCard.parentElement.insertBefore(importSection, backupCard);
  schoolSelect.addEventListener('change',()=>{teachingCapture=null;teachingNormalized=null;teachingPlan=null;teachingChoices=new Map();teachingPeriodPlan=null;teachingPeriodChoice=null;importPanel.hidden=true;importSection.querySelector('.settings-description').textContent=SchoolAdapters.get(schoolSelect.value).help;});
  importMonday.addEventListener('change', () => { teachingPlan = null; confirmImport.hidden = true; importHint.hidden = true; importList.hidden = true; importList.replaceChildren(); importMessage.textContent = '日期已改变，请重新核对导入内容。'; });
  function teachingError(error) {
    const code = error && (error.code || error.message);
    if (code === 'SCHOOL_NEEDS_SEPARATE_TIMETABLE') return '已有其他学校的课表，请切换到新学期后再导入，避免两校作息混用。';
    if (code === 'PERIOD_TIMES_AMBIGUOUS') return '网页没有足够的单节作息信息，暂未导入，请先核对实际上课时间。';
    if (error && /^PERIOD_/.test(error.code||'')) return error.message;
    if (code === 'PLAN_STALE') return '课表在预览后发生了变化，请重新核对再确认。';
    if (code === 'LEDGER_SOURCE_MISMATCH') return '暂不支持合并不同学期的导入记录，本地课表未改动。';
    return '无法导入这份课表，请核对学期、第一周周一和网页内容；本地课表未改动。';
  }
  function receiveTeachingCapture(capture) {
    try {
      if (!SchoolAdapters.accepts(schoolSelect.value,capture)) throw new Error('CAPTURE_INVALID');
      teachingCapture = capture; teachingPlan = null; teachingNormalized = null; teachingManualTimesConfirmed=false;
      teachingPeriodChoice=null;teachingPeriodPlan=null;
      importPanel.hidden = false; confirmImport.hidden = true; importHint.hidden = true; importList.hidden = true; importList.replaceChildren(); importList.scrollTop = 0;
      importTerm.textContent = capture.term.year + ' 学年 · 第 ' + capture.term.semester + ' 学期';
      const currentMonday = state.settings.startMonday;
      importMonday.value = currentMonday && currentMonday.slice(0, 4) === capture.term.year.slice(0, 4) && capture.term.semester === '1' ? currentMonday : '';
      activeView = 'settings'; render();
      importMessage.textContent = '请确认第一周周一，再核对导入内容。';
      if (importMonday.value) makeTeachingPreview();
      importSection.scrollIntoView({block: 'start'});
      return true;
    } catch (_) { showToast('网页课表格式不受支持，本地课表未改动'); return false; }
  }
  function meetingText(course) {
    return dateText(course.date, true) + ' 周' + WEEKDAYS[course.day - 1] + ' · ' + (course.timeMode === 'pending' ? course.timeNote : '第' + course.start + '–' + course.end + '节') + ' · ' + (course.room || '教室待补充');
  }
  function teachingNightReferences() {
    // The original semester contains the user's confirmed night clock. Keep
    // that reference even if its local course was renamed, moved or deleted;
    // otherwise a first upgrade could misclassify it as a new pending course.
    const first = original.settings.startMonday;
    const sameOriginalTerm = first && teachingCapture.term.semester === '1' && first.slice(0, 4) === teachingCapture.term.year.slice(0, 4) && first.slice(5, 7) >= '07';
    const known = sameOriginalTerm && state.skipLegacyImportBaseline !== true ? original.courses.filter(course => course.timeMode !== 'pending' && course.end > 8 && course.sourceTime) : [];
    const remaining = state.courses.filter(course => course.timeMode !== 'pending' && course.end > 8 && course.sourceTime && !known.some(reference => reference.name === course.name && reference.start === course.start && reference.end === course.end));
    return known.concat(remaining).slice(0, 500);
  }
  function makeTeachingPreview() {
    const oldTimes=$('teachingPeriodPreview');if(oldTimes)oldTimes.remove();teachingPeriodPlan=null;
    confirmImport.hidden = true; importHint.hidden = true; importList.hidden = true; importList.replaceChildren(); importList.scrollTop = 0; teachingPlan = null;
    try {
      const monday = importMonday.value;
      if (!M.parseISO(monday) || M.dayOf(monday) !== 1) { importMessage.textContent = '请填写本学期第一周的周一。'; return; }
      const settings = {...state.settings, startMonday: monday};
      const profile=SchoolAdapters.get(schoolSelect.value);
      if(state.importLedger&&state.importLedger.source.system!==profile.system||profile.id!==SchoolAdapters.defaultSchool&&state.courses.length&&!state.importLedger&&state.skipLegacyImportBaseline!==true){const error=new Error();error.code='SCHOOL_NEEDS_SEPARATE_TIMETABLE';throw error;}
      teachingNormalized = SchoolAdapters.normalize(profile.id,teachingCapture, settings, state.periods, profile.id===SchoolAdapters.defaultSchool?teachingNightReferences():[]);
      const normalized = teachingNormalized;
      const incoming = {source: normalized.source, scope: normalized.scope, occurrences: normalized.occurrences, rejectedCount: normalized.rejectedCount};
      teachingPlan = SafeMerge.planMerge(state, incoming, state.importLedger, teachingMergeOptions());
      const plan = teachingPlan, stats = plan.stats;
      teachingChoices = new Map();
      importMessage.textContent = '读到 ' + normalized.stats.uniqueMeetings + ' 次课：新增 ' + stats.additions + '，已存在 ' + (stats.exactBindings + stats.unchanged + stats.protectedLocal + stats.deletedLocally) + '，需核对 ' + (stats.sourceUpdates + stats.conflicts) + '。';
      if (!plan.canCommit) { importMessage.textContent = '当前页面未读到有效课程，本地课表未改动。'; return; }
      importPanel.insertBefore(renderTeachingPeriodPreview(normalized.periods,normalized),importActions);
      if(normalized.clockInference){const note=node('p','teaching-warning','单节时间由网页大节时段按统一课长换算，请核对时间后再确认。');note.id='schoolClockInference';$('teachingPeriodPreview').append(note);}
      if(normalized.requiresManualTimes){
        const label=node('label','teaching-choice'),check=node('input');check.type='checkbox';check.id='schoolManualTimes';check.checked=teachingManualTimesConfirmed;
        check.addEventListener('change',()=>{teachingManualTimesConfirmed=check.checked;});
        label.append(check,node('span','','网页未提供作息：我已核对“上课时间”与本校一致；缺少时间的晚课会保留待确认。'));$('teachingPeriodPreview').append(label);
      }
      if (normalized.rejectedCount || plan.invalid.length) importList.append(node('p', 'teaching-warning', '有 ' + (normalized.rejectedCount + plan.invalid.length) + ' 项无法确认，未加入导入内容。'));
      if (normalized.unscheduledPresent) importList.append(node('p', 'settings-description', '网页还列有未排具体时间的实践课或其它课程，未生成上课安排。' + (state.skipLegacyImportBaseline === true ? '需要时可手动补充实验安排。' : '已有工程力学、电工及物理实验安排继续保留。')));
      if (state.settings.startMonday !== monday) importList.append(node('p', 'teaching-warning', '确认后，第一周周一将设为 ' + dateText(monday, true) + '；原有课程的具体日期保持不变。'));
      const existing = node('details', 'help-details'); existing.append(node('summary', '', '查看已存在及保留的课程'));
      plan.preview.forEach(item => {
        const course = item.incoming, row = node('div', 'teaching-row');
        row.append(node('strong', '', course.name), node('p', '', meetingText(course)));
        const choices = item.allowedActions;
        let initial = 'skip';
        if (item.type === 'addition') initial = 'add';
        if (choices.length) teachingChoices.set(item.sourceOccurrenceId, initial);
        if (item.type === 'addition' || item.type === 'sourceUpdate') {
          const label = node('label', 'teaching-choice'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = initial === 'add';
          const action = item.type === 'addition' ? 'add' : 'acceptSource';
          const updateLabel=item.sourceChanges&&item.sourceChanges.indexOf('sourceTime')>=0?'采用网页上的完整上课时间（含教室和教师）':'采用网页上的教室和教师';
          label.append(check, node('span', '', item.type === 'addition' ? '加入这次课' : updateLabel));
          check.addEventListener('change', () => teachingChoices.set(item.sourceOccurrenceId, check.checked ? action : 'skip'));
          if (item.type === 'sourceUpdate') row.append(node('p', 'teaching-warning', '当前：' + (item.local.room || '教室待补充') + ' · ' + (item.local.teacher || '教师未提供')));
          row.append(label); importList.append(row);
        } else if (item.type === 'conflict') {
          row.append(node('p', 'teaching-warning', '可能与已有调课或人工修改有关，本次跳过。可在课程详情里手动核对。')); importList.append(row);
        } else {
          const label = item.type === 'deletedLocally' ? '你已删除，保留删除结果' : item.type === 'protectedLocal' ? '保留你的修改' : '已存在，保留本地安排';
          row.append(node('p', '', label)); existing.append(row);
        }
      });
      importList.append(existing); confirmImport.hidden = false; importHint.hidden = false; importList.hidden = false;
      confirmImport.textContent = stats.additions || stats.sourceUpdates ? '确认导入所选内容' : '确认并记住导入记录';
    } catch (error) { importMessage.textContent = teachingError(error); }
  }
  function submitTeachingImport() {
    if (!teachingPlan || !teachingNormalized) return;
    try {
      const n = teachingNormalized;
      if(n.requiresManualTimes&&!teachingManualTimesConfirmed){importMessage.textContent='请先核对本校上课时间，再勾选作息确认。尚未导入课程。';return;}
      const incoming = {source: n.source, scope: n.scope, occurrences: n.occurrences, rejectedCount: n.rejectedCount};
      const choices = Array.from(teachingChoices).map(([sourceOccurrenceId, action]) => ({sourceOccurrenceId, action}));
      const result = SafeMerge.commitMerge(state, incoming, state.importLedger, {baseFingerprint: teachingPlan.baseFingerprint, choices}, teachingMergeOptions());
      result.state.importLedger = result.ledger; result.state.settings.startMonday = importMonday.value;
      let next = result.state;
      if(teachingPeriodChoice===true&&teachingPeriodPlan)next=PeriodTimes.applyToState(next,teachingPeriodPlan.periods);
      next = M.validateState(next);
      const changed = JSON.stringify(next) !== JSON.stringify(state);
      if (changed && !commit(next, '已导入：新增 ' + result.summary.addedOccurrences + ' 次，更新 ' + result.summary.updatedOccurrences + ' 次；已有实验和人工修改已保留')) return;
      if (!changed) showToast('课程已存在，本地课表无需更改');
      if(window.SuikeCampusMap)SuikeCampusMap.imported(n);
      teachingCapture = null; teachingPlan = null; teachingNormalized = null; importPanel.hidden = true;
    } catch (error) { importMessage.textContent = teachingError(error); }
  }
  function teachingMergeOptions() {
    // Whole-timetable clearing explicitly starts a fresh import. Ordinary
    // per-course deletions still use the ledger / trusted upgrade baseline.
    return state.skipLegacyImportBaseline === true || schoolSelect.value!==SchoolAdapters.defaultSchool ? {} : {trustedLegacyBaseline: original};
  }
  window.SuikeImport = Object.freeze({receiveCapture: receiveTeachingCapture});
