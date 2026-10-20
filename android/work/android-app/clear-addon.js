  // APK-only whole-timetable clearing; no school-page bridge or network access.
  const weekHeading = $('addCourseWeek').parentElement;
  const weekActions = node('div', 'week-timetable-actions');
  weekActions.append($('addCourseWeek'));
  const clearTimetableButton = button('text-button clear-timetable-button', '清空课表', openClearTimetable);
  clearTimetableButton.id = 'clearTimetable';
  clearTimetableButton.setAttribute('aria-haspopup', 'dialog');
  clearTimetableButton.setAttribute('aria-controls', 'clearTimetableDialog');
  weekActions.append(clearTimetableButton); weekHeading.append(weekActions);

  const clearDialog = node('dialog', 'clear-timetable-dialog');
  clearDialog.id = 'clearTimetableDialog';
  clearDialog.setAttribute('aria-labelledby', 'clearTimetableTitle');
  clearDialog.setAttribute('aria-describedby', 'clearTimetableScope');
  const clearHeading = node('div', 'clear-timetable-heading');
  const clearPips = node('span', 'clear-timetable-pips'); clearPips.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) clearPips.append(node('i'));
  clearHeading.append(node('span', 'clear-timetable-label', 'CLEAR TIMETABLE'), clearPips);
  const clearTitle = node('h2', '', '清空全部课表？'); clearTitle.id = 'clearTimetableTitle';
  const clearCount = node('p', 'clear-timetable-count'); clearCount.id = 'clearTimetableCount';
  const clearScope = node('p', 'clear-timetable-scope', '清除所有周次的课程，包括手工添加的实验。学期、课时和外观设置保留，之后可以重新导入。');
  clearScope.id = 'clearTimetableScope';
  const clearHint = node('p', 'clear-timetable-note', '清空后可在底部提示中撤销；需要长期保留时，请先到设置导出备份。');
  const clearActions = node('div', 'clear-timetable-dialog-actions');
  const cancelClear = button('inst-btn', '取消', () => closeDialog(clearDialog)); cancelClear.id = 'cancelClearTimetable';
  const confirmClear = button('inst-btn clear-timetable-confirm', '确认清空', clearAllTimetable); confirmClear.id = 'confirmClearTimetable';
  clearActions.append(cancelClear, confirmClear);
  clearDialog.append(clearHeading, clearTitle, clearCount, clearScope, clearHint, clearActions);
  document.body.append(clearDialog); armDialogCancel(clearDialog);
  let clearTimetableFingerprint = null;

  const clearEmpty = node('section', 'clear-timetable-empty'); clearEmpty.id = 'clearTimetableEmpty'; clearEmpty.hidden = true;
  clearEmpty.setAttribute('aria-label', '空课表');
  clearEmpty.append(node('p', 'clear-timetable-label', 'EMPTY TIMETABLE'), node('h3', '', '课表已清空'), node('p', '', '可以重新导入教务课表，或手动添加课程。'));
  const emptyActions = node('div', 'clear-timetable-empty-actions');
  const emptyImport = button('inst-btn clear-timetable-confirm', '导入教务课表', () => {
    activeView = 'settings'; render(); importSection.scrollIntoView({block: 'start'}); openPortal.focus();
  }); emptyImport.id = 'importAfterClear';
  emptyActions.append(emptyImport, button('inst-btn', '添加课程', () => openEdit())); clearEmpty.append(emptyActions);
  $('weekView').insertBefore(clearEmpty, $('weekGrid').parentElement);

  function renderClearTimetableControls() {
    clearEmpty.hidden = state.courses.length !== 0 || state.skipLegacyImportBaseline !== true;
    clearTimetableButton.disabled = state.courses.length === 0 && state.skipLegacyImportBaseline === true && state.importLedger == null;
  }
  function openClearTimetable() {
    if (clearTimetableButton.disabled || clearDialog.getAttribute('open') !== null) return;
    const meetings = state.courses.reduce((count, course) => count + course.dates.length, 0);
    clearCount.textContent = state.courses.length + ' 条课程安排 · ' + meetings + ' 次上课';
    clearTimetableFingerprint = JSON.stringify(state); confirmClear.disabled = false;
    showDialog(clearDialog); cancelClear.focus();
  }
  function clearAllTimetable() {
    if (clearDialog.getAttribute('open') === null || confirmClear.disabled) return;
    if (clearTimetableFingerprint !== JSON.stringify(state)) {
      closeDialog(clearDialog); showToast('课表已发生变化，请重新确认清空范围。'); return;
    }
    const next = clone(state);
    next.courses = []; next.importLedger = null; next.skipLegacyImportBaseline = true;
    next.appliedUpdateIds = Array.from(new Set(next.appliedUpdateIds.concat(original.appliedUpdateIds)));
    // The shared store saves the pre-clear snapshot before replacing the timetable.
    if (!productCommit(next, '已清空全部课表，可重新导入', true)) return;
    confirmClear.disabled = true;
    teachingCapture = null; teachingNormalized = null; teachingPlan = null; teachingChoices = new Map();
    importPanel.hidden = true; confirmImport.hidden = true; importList.replaceChildren();
    clearTimetableFingerprint = null; closeDialog(clearDialog); render();
  }
