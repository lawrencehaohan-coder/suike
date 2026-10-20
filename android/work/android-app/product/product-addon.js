  // 随课 1.4.0 功能界面（Kimi 设计版）：沿用主界面黑白仪表风组件。
  // 数据保护语义不变：先预览/核对，再统一提交；OCR 与通知不直接写课表。
  const Product = window.SuikeProductCore, Workspace = window.SuikeWorkspaceEngine, Notice = window.SuikeNoticeEngine;
  let nativeFingerprint = '', productProjectionWarning = '', productDialogAction = null, noticeDrafts = [], noticeBase = null, nativeFeatureStatus = null, noticeTextField = null;

  /* ======== 基础构件 ======== */
  function pfIcon(paths) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    paths.forEach(d => { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); svg.appendChild(p); });
    return svg;
  }
  function fmtShanghai(iso) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
      const get = type => (parts.find(part => part.type === type) || {}).value || '--';
      return get('year') + '-' + get('month') + '-' + get('day') + ' ' + get('hour') + ':' + get('minute');
    } catch (_) { return String(iso); }
  }
  function pfField(target, label, value, type, id, hint) {
    const wrap = node('label', 'field pf-field'), input = node(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') input.type = type || 'text';
    input.value = value == null ? '' : String(value); if (id) input.id = id;
    if (!type || type === 'text') input.maxLength = 160;
    if (type === 'textarea') { input.maxLength = 20000; input.rows = 7; }
    wrap.append(node('span', '', label), input);
    if (hint) wrap.append(node('small', '', hint));
    target.append(wrap); return input;
  }
  function pfSelect(target, label, choices, value, id, hint) {
    const wrap = node('label', 'field pf-field'), input = node('select'); if (id) input.id = id;
    choices.forEach(choice => { const option = node('option', '', choice[1]); option.value = choice[0]; input.append(option); });
    input.value = value; wrap.append(node('span', '', label), input);
    if (hint) wrap.append(node('small', '', hint));
    target.append(wrap); return input;
  }
  function pfCheck(target, label, checked, id, hint) {
    const wrap = node('label', 'pf-check'), input = node('input');
    input.type = 'checkbox'; input.checked = checked; if (id) input.id = id;
    const text = node('span', 'pf-check-text'); text.append(node('strong', '', label));
    if (hint) text.append(node('small', '', hint));
    wrap.append(input, text); target.append(wrap); return input;
  }
  function pfScope(target) {
    const choices = [['one', '仅这一次', '只改选中的这一天'], ['future', '这次及以后', '含所选日在内的后续'], ['all', '全部日期', '这门课所有上课日']];
    const select = node('select'); select.id = 'occurrenceScope'; select.className = 'pf-vhidden'; select.setAttribute('aria-hidden', 'true');
    choices.forEach(choice => { const option = node('option', '', choice[1]); option.value = choice[0]; select.append(option); });
    select.value = 'one';
    const seg = node('div', 'pf-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', '影响范围');
    const buttons = choices.map(choice => {
      const item = button('pf-seg-btn' + (choice[0] === 'one' ? ' active' : ''), '', () => {
        select.value = choice[0]; syncScope();
        select.dispatchEvent(new Event('input'));
      });
      item.append(node('strong', '', choice[1]), node('small', '', choice[2])); seg.append(item); return item;
    });
    function syncScope() { choices.forEach((choice, index) => buttons[index].classList.toggle('active', select.value === choice[0])); }
    select.addEventListener('input', syncScope);
    const wrap = node('label', 'field pf-field'); wrap.append(node('span', '', '影响范围'), seg, select);
    target.append(wrap); return select;
  }
  function pfPill(text, kind) { return node('span', 'pf-pill' + (kind ? ' is-' + kind : ''), text); }
  function pfKv(label, text) { const row = node('div', 'pf-kv'); row.append(node('span', 'pf-kv-label', label), node('span', '', text)); return row; }

  /* ======== 共用弹窗 ======== */
  const productDialog = node('dialog', 'product-dialog'); productDialog.id = 'productDialog';
  const pdHead = node('div', 'pd-head');
  const pdHeadText = node('div');
  const productEyebrow = node('p', 'pd-eyebrow', 'SUIKE'); productEyebrow.id = 'productEyebrow';
  const productTitle = node('h2', '', ''); productTitle.id = 'productDialogTitle';
  pdHeadText.append(productEyebrow, productTitle);
  const productClose = button('icon-button', '', () => closeDialog(productDialog));
  productClose.setAttribute('aria-label', '关闭'); productClose.append(pfIcon(['m6 6 12 12M18 6 6 18']));
  pdHead.append(pdHeadText, productClose);
  productDialog.setAttribute('aria-labelledby', productTitle.id);
  const productSubtitle = node('p', 'pd-sub'); productSubtitle.hidden = true;
  const productBody = node('div', 'pd-body');
  const productError = node('p', 'form-error'); productError.id = 'productError'; productError.hidden = true; productError.setAttribute('role', 'alert');
  const pdFoot = node('div', 'pd-foot');
  const productCancel = button('button button-outline', '取消', () => closeDialog(productDialog));
  const productConfirm = button('button button-primary', '确认', () => {
    try { if (productDialogAction) productDialogAction(); } catch (error) { productError.textContent = error.message; productError.hidden = false; }
  }); productConfirm.id = 'productConfirm';
  pdFoot.append(productCancel, productConfirm);
  productDialog.append(pdHead, productSubtitle, productBody, productError, pdFoot);
  document.body.append(productDialog); armDialogCancel(productDialog);

  function productOpen(title, action, options) {
    options = options || {};
    productTitle.textContent = title;
    productEyebrow.textContent = options.eyebrow || 'SUIKE · 工具';
    productSubtitle.textContent = options.subtitle || ''; productSubtitle.hidden = !options.subtitle;
    productBody.replaceChildren(); productError.hidden = true;
    productDialogAction = action || null;
    productConfirm.hidden = !action; productConfirm.disabled = false;
    productConfirm.textContent = options.confirm || '确认';
    productCancel.textContent = options.cancel || '取消';
    if (!productDialog.open) showDialog(productDialog);
    productDialog.scrollTop = 0;
  }

  /* ======== 提交与状态 ======== */
  function productOptions() { return { validateState: value => M.validateState(value), validateLedger: value => SafeMerge.validateLedger(value) }; }
  function productCommit(next, message, canUndo) {
    try {
      if (!workspaceStore) throw new Error('本地存储不可用，未修改课表，请先导出备份');
      const before = clone(state), result = workspaceStore.commit(state, M.validateState(next), message);
      if (result.changed) { undoState = canUndo === false ? null : before; state = result.state; storageAvailable = true; }
      render(); showToast(result.changed ? message : '内容没有变化', canUndo !== false && result.changed); return true;
    } catch (error) { storageAvailable = false; showToast('未能保存，原课表未改动：' + error.message); return false; }
  }
  function invalidateProductPreview() {
    noticeBase = null; noticeDrafts = [];
    teachingCapture = null; teachingNormalized = null; teachingPlan = null; teachingChoices = new Map();
    importPanel.hidden = true; confirmImport.hidden = true; importList.replaceChildren();
  }
  function productAdopt(result, message) {
    state = result.state; undoState = null; storageAvailable = true; invalidateProductPreview();
    selectedDate = state.settings.startMonday || chinaToday(); weekMonday = M.mondayOf(selectedDate); render(); showToast(message); return clone(state);
  }
  function nativeCall(method) {
    if (!window.SuikeNative || typeof window.SuikeNative[method] !== 'function') throw new Error('请在随课安卓应用中使用此功能');
    return window.SuikeNative[method]();
  }
  function syncNative(force) {
    try {
      if (!window.SuikeNative || typeof window.SuikeNative.syncFeatures !== 'function') return false;
      const custom=document.documentElement.dataset.appearance==='custom';
      const key = Workspace.fingerprint(state) + ':' + custom + ':' + chinaToday();
      if (!force && key === nativeFingerprint) return true;
      const payload = Product.nativePayload(state, Date.now(), M);
      if(custom)payload.theme='light';
      productProjectionWarning = payload.projectionInfo.truncated ? ' · 组件/提醒仅纳入最近 ' + payload.projectionInfo.included + ' 次课（数据量限制）' : '';
      const accepted = window.SuikeNative.syncFeatures(JSON.stringify(payload));
      if (accepted) nativeFingerprint = key; return accepted;
    } catch (_) { return false; }
  }

  /* ======== 设置页 · 课表工具面板 ======== */
  const toolDesc = {};
  const productPanel = node('section', 'settings-card'); productPanel.id = 'productFeatures';
  const pfHead = node('div', 'card-heading');
  const pfHeadIcon = node('span', 'section-icon'); pfHeadIcon.setAttribute('aria-hidden', 'true');
  pfHeadIcon.append(pfIcon(['M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z']));
  const pfHeadText = node('div'); pfHeadText.append(node('h3', '', '课表工具'), node('p', '', '快照 · 学期 · 通知 · 提醒'));
  pfHead.append(pfHeadIcon, pfHeadText); productPanel.append(pfHead);
  const pfTools = node('div', 'pf-tools');
  [
    ['noticeImport', '导入实验 / 调课通知', '粘贴文字或本机截图识别，逐条核对后写入', () => openNoticeImport(), ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M9 13h6M9 17h6'], null],
    ['historyList', '历史快照', '改动前自动保存 · 最多 10 份', openHistory, ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5', 'M12 7v5l3 3'], 'history'],
    ['semesterList', '学期管理', '存档与切换学期', openSemesters, ['m12 3 8 4-8 4-8-4 8-4z', 'm4 11 8 4 8-4', 'm4 15 8 4 8-4'], 'semester'],
    ['reminderSettings', '上课提醒', '未开启', openReminders, ['M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'M10.3 21a2 2 0 0 0 3.4 0'], 'reminder'],
    ['setupGuide', '学期与班级', '第一周周一 · 专业 · 班级 · 批次', openSetup, ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'], 'setup']
  ].forEach(item => {
    const row = button('pf-tool', '', item[3]); row.id = item[0];
    const icon = node('span', 'pf-tool-icon'); icon.append(pfIcon(item[4]));
    const text = node('span', 'pf-tool-text');
    text.append(node('strong', 'pf-tool-title', item[1]));
    const desc = node('span', 'pf-tool-desc', item[2]); text.append(desc);
    if (item[5]) toolDesc[item[5]] = desc;
    const chevron = pfIcon(['m9 6 6 6-6 6']); chevron.setAttribute('class', 'pf-tool-chevron');
    row.append(icon, text, chevron); pfTools.append(row);
  });
  const productSummary = node('p', 'pf-summary-line');
  productPanel.append(pfTools, productSummary);
  backupCard.parentElement.insertBefore(productPanel, backupCard);

  function renderProductControls() {
    if (typeof productPanel === 'undefined' || !productPanel) return;
    const preferences = Product.settings(state);
    toolDesc.semester.textContent = '当前：' + (state.settings.termLabel || '未命名学期');
    toolDesc.reminder.textContent = preferences.reminders.enabled ? '已开启 · 提前 ' + preferences.reminders.leadMinutes + ' 分钟' : '未开启';
    toolDesc.setup.textContent = preferences.setupCompleted ? '已完成 · ' + preferences.profile.classNumber + ' 班 · ' + preferences.profile.batchNumber + ' 批' : '待完成 · 点这里开始';
    try { toolDesc.history.textContent = workspaceStore.listHistory().length + ' 份快照 · 仅本机'; } catch (_) { toolDesc.history.textContent = '本地存储不可用'; }
    productSummary.textContent = '本地快照 · 学期存档 · 通知导入' + (preferences.reminders.enabled ? ' · 上课提醒已开启' : ' · 上课提醒未开启');
    syncNative(false);
    productSummary.textContent += productProjectionWarning;
  }

  /* ======== 新用户引导 / 学期与班级 ======== */
  function openSetup() {
    const preferences = Product.settings(state); let monday, term, major, classNumber, batchNumber;
    productOpen('开始使用随课', () => {
      const next = clone(state); next.productSettings = preferences;
      if (preferences.profile.major !== major.value.trim() || preferences.profile.classNumber !== Number(classNumber.value) || preferences.profile.batchNumber !== Number(batchNumber.value)) delete next.productSettings.aiIdentity;
      next.productSettings.setupCompleted = true; next.productSettings.profile.major = major.value.trim();
      next.productSettings.profile.classNumber = Number(classNumber.value); next.productSettings.profile.batchNumber = Number(batchNumber.value);
      next.settings.startMonday = monday.value || null; next.settings.termLabel = term.value.trim();
      if (!next.settings.startMonday) throw new Error('请填写第一周的周一，方便按周次导入通知');
      if (productCommit(next, '学期与班级已保存，接下来导入或添加课程', true)) { closeDialog(productDialog); activeView = 'settings'; render(); }
    }, {
      eyebrow: 'SETUP · 学期与班级', confirm: '保存设置',
      subtitle: '新安装从空课表开始：先填写学期与班级，再导入教务课表或恢复备份。完成设置不会自动产生课程。'
    });
    monday = pfField(productBody, '第一周周一', state.settings.startMonday, 'date', 'setupMonday', '教学周次和通知里的周次都按它换算');
    term = pfField(productBody, '学期名称', state.settings.termLabel, 'text', 'setupTerm');
    major = pfField(productBody, '专业（选填）', preferences.profile.major, 'text', 'setupMajor');
    const grid = node('div', 'pf-grid2'); productBody.append(grid);
    classNumber = pfField(grid, '班级序号', preferences.profile.classNumber, 'number', 'setupClass'); classNumber.min = 1; classNumber.max = 100;
    batchNumber = pfField(grid, '实验批次', preferences.profile.batchNumber, 'number', 'setupBatch'); batchNumber.min = 1; batchNumber.max = 100;
    productBody.append(node('p', 'pf-note', '实验和调课通知会按班级、批次筛出你的安排；解析身份会显示在导入前的核对页面。'));
    const actions = node('div', 'pf-row-actions');
    actions.append(
      button('text-button', '打开教务导入', () => { closeDialog(productDialog); activeView = 'settings'; render(); importSection.scrollIntoView({ block: 'start' }); openPortal.focus(); }),
      button('text-button', '从 JSON 备份恢复', () => { closeDialog(productDialog); $('importFile').click(); })
    );
    productBody.append(actions);
  }

  /* ======== 历史快照 ======== */
  function openHistory() {
    productOpen('历史快照', null, {
      eyebrow: 'SNAPSHOTS · 仅本机',
      subtitle: '重要改动前自动保存，最多 10 份、合计约 4 MB；恢复前会先保存当前课表。快照只在这台设备上，不是云备份。'
    });
    try {
      const snapshots = workspaceStore.listHistory();
      if (!snapshots.length) {
        const empty = node('div', 'pf-empty');
        empty.append(node('h4', '', '还没有历史快照'), node('p', '', '导入、调课、清空等重要改动前会自动保存一份。'));
        productBody.append(empty); return;
      }
      snapshots.forEach(snapshot => {
        const card = node('div', 'pf-card');
        const head = node('div', 'pf-card-head');
        head.append(node('strong', '', snapshot.reason), pfPill((snapshot.sizeBytes / 1024).toFixed(1) + ' KB'));
        card.append(head, node('p', 'pf-card-meta', fmtShanghai(snapshot.createdAt) + ' · UTC+8'));
        const actions = node('div', 'pf-card-actions');
        actions.append(button('text-button', '恢复这一份', () => {
          productOpen('确认恢复历史课表', () => { productAdopt(workspaceStore.restoreHistory(state, snapshot.id), '历史课表已恢复'); closeDialog(productDialog); }, { eyebrow: 'SNAPSHOTS · 恢复', confirm: '确认恢复' });
          productBody.append(
            pfKv('快照原因', snapshot.reason),
            pfKv('保存时间', fmtShanghai(snapshot.createdAt) + ' · UTC+8'),
            node('p', 'pf-note', '课表将回到这次保存时的样子；当前课表会先存为一份新快照。')
          );
        }));
        card.append(actions); productBody.append(card);
      });
    } catch (error) { productError.textContent = error.message; productError.hidden = false; }
  }

  /* ======== 学期管理 ======== */
  function openSemesters() {
    productOpen('学期管理', null, {
      eyebrow: 'SEMESTERS',
      subtitle: '每个学期独立保存课程、导入记录与偏好；创建和切换前会先保存当前学期，最多 12 个。'
    });
    const current = node('div', 'pf-card');
    const currentHead = node('div', 'pf-card-head');
    currentHead.append(node('strong', '', state.settings.termLabel || '未命名学期'), pfPill('当前', 'ok'));
    current.append(currentHead, node('p', 'pf-card-meta',
      (state.settings.startMonday ? '开学 ' + state.settings.startMonday : '第一周周一未设置') + ' · ' + state.settings.totalWeeks + ' 周 · ' + state.courses.length + ' 门课程'));
    productBody.append(current);
    const actions = node('div', 'pf-row-actions');
    actions.append(
      button('text-button', '存档当前学期', () => { try { workspaceStore.saveSemester(state); openSemesters(); showToast('当前学期已存档'); } catch (error) { showToast(error.message); } }),
      button('text-button', '新建空白学期', () => {
        let monday, term, weeks;
        productOpen('新建空白学期', () => {
          const result = workspaceStore.createSemester(state, { startMonday: monday.value, termLabel: term.value, totalWeeks: Number(weeks.value), periods: state.periods });
          productAdopt(result, '新学期已创建，可以导入新课表'); closeDialog(productDialog);
        }, { eyebrow: 'SEMESTERS · NEW', confirm: '创建学期', subtitle: '沿用当前课时表（含晚课 19:00–19:45 / 19:55–20:40）；创建后课表为空，需要重新导入或添加。' });
        monday = pfField(productBody, '新学期第一周周一', '', 'date', 'semesterMonday');
        term = pfField(productBody, '学期名称', '', 'text', 'semesterName');
        weeks = pfField(productBody, '学期总周数', state.settings.totalWeeks, 'number', 'semesterWeeks'); weeks.min = 1; weeks.max = 52;
      })
    );
    productBody.append(actions);
    try {
      const terms = workspaceStore.listSemesters().filter(term => !term.active);
      if (terms.length) productBody.append(node('p', 'pf-steps', 'ARCHIVED · ' + terms.length + ' 个存档'));
      terms.forEach(term => {
        const card = node('div', 'pf-card');
        const head = node('div', 'pf-card-head'); head.append(node('strong', '', term.name), pfPill(term.courseCount + ' 门'));
        card.append(head, node('p', 'pf-card-meta', '存档于 ' + fmtShanghai(term.updatedAt)));
        const row = node('div', 'pf-card-actions');
        row.append(button('text-button', '切换到此学期', () => {
          productOpen('确认切换学期', () => { productAdopt(workspaceStore.switchSemester(state, term.id), '已切换到 ' + term.name); closeDialog(productDialog); }, { eyebrow: 'SEMESTERS · 切换', confirm: '确认切换' });
          productBody.append(
            pfKv('目标学期', term.name),
            pfKv('课程数量', term.courseCount + ' 门课程'),
            node('p', 'pf-note', '当前学期会先保存，然后打开「' + term.name + '」并定位到它的第一周。')
          );
        }));
        card.append(row); productBody.append(card);
      });
      productBody.append(node('p', 'pf-note', '存档名称以存档时为准；学期名的后续修改在下次存档或切换时同步。'));
    } catch (error) { productError.textContent = error.message; productError.hidden = false; }
  }

  /* ======== 上课提醒与桌面组件 ======== */
  function openReminders() {
    const prefs = Product.settings(state); let enabled, lead;
    productOpen('上课提醒', () => {
      prefs.reminders.enabled = enabled.checked; prefs.reminders.leadMinutes = Number(lead.value);
      const next = clone(state); next.productSettings = prefs;
      if (productCommit(next, enabled.checked ? '已保存提醒设置' : '上课提醒已关闭', true)) {
        if (enabled.checked) { try { nativeCall('requestReminderPermission'); } catch (error) { showToast(error.message); } }
        closeDialog(productDialog);
      }
    }, { eyebrow: 'REMINDERS', confirm: '保存设置' });
    enabled = pfCheck(productBody, '开启上课提醒', prefs.reminders.enabled, 'remindersEnabled', '按课表时间在上课前发送本机通知');
    lead = pfField(productBody, '提前几分钟（0–120）', prefs.reminders.leadMinutes, 'number', 'reminderLead'); lead.min = 0; lead.max = 120;
    const status = node('p', 'pf-note'); status.id = 'nativeFeatureStatus';
    try { nativeFeatureStatus = JSON.parse(nativeCall('featuresStatus')); } catch (_) {}
    status.textContent = nativeStatusText(nativeFeatureStatus); productBody.append(status);
    productBody.append(node('p', 'pf-note', '提醒由系统调度（约 10 分钟窗口），不是精确闹钟；省电、勿扰或强制停止可能推迟送达。时间待确认的课程不提醒；全局关闭时，单课开启也不发送。'));
    if (window.SuikeNative && typeof window.SuikeNative.requestPinWidget === 'function') {
      const widget = node('div', 'pf-card');
      const widgetHead = node('div', 'pf-card-head'); widgetHead.append(node('strong', '', '桌面组件'), pfPill('WIDGET'));
      widget.append(widgetHead, node('p', 'pf-card-meta', '在桌面查看课程、时间和教室，放大可看后续安排。'));
      const widgetActions = node('div', 'pf-card-actions');
      const wide=button('text-button', '添加 4×2', () => {
        try { if (nativeCall('requestPinWidget')) showToast('请在系统弹窗中确认添加'); else showToast('请长按桌面，在小组件中找到「随课」'); }
        catch (error) { showToast(error.message); }
      });wide.id='pinWidgetWide';widgetActions.append(wide);
      const compact=button('text-button','添加 2×2',()=>{try{if(nativeCall('requestPinCompactWidget'))showToast('请在系统弹窗中确认添加');else showToast('请长按桌面，在小组件中选择「随课 · 2×2」');}catch(error){showToast(error.message);}});compact.id='pinWidgetCompact';widgetActions.append(compact);
      const appearance=button('text-button','调整外观',()=>{closeDialog(productDialog);activeView='settings';render();const fold=$('settingsDisplayDetails');if(fold)fold.open=true;const glass=$('glassEnabled');if(glass){glass.scrollIntoView({block:'center'});glass.focus();}});appearance.id='widgetAppearanceSettings';widgetActions.append(appearance);
      widget.append(node('p','pf-card-meta','外观跟随「显示与外观」中的玻璃开关与磨砂程度。'));
      widget.append(widgetActions); productBody.append(widget);
    }
    productBody.append(node('p', 'pf-note', '单课例外：打开课程详情，可在「这门课的提醒」里单独关闭或设置提前时间。'));
  }
  function nativeStatusText(status) {
    if (!status) return '系统通知与调度状态会在随课安卓应用中显示。';
    if (status.notificationsAllowed === false || status.notificationPermission === false) return '系统通知权限尚未开启：设置会保存，但提醒不会送达。可在系统设置中允许随课通知。';
    return '系统已允许通知；提醒由安卓系统调度，实际送达时间受系统限制。';
  }

  /* ======== 课程详情内的单次操作入口 ======== */
  function renderProductCourseTools(course, date) {
    const target = $('courseDetail'), wrap = node('div', 'pf-course-tools');
    wrap.append(node('span', 'micro', '单次调整 · OCCURRENCE'));
    const row = node('div', 'pf-course-tools-row');
    row.append(
      button('inst-btn', '调课 / 按次修改', () => { closeDialog($('courseDialog')); setTimeout(() => openOccurrenceEdit(course.id, date), 190); }),
      button('inst-btn', '按次删除', () => { closeDialog($('courseDialog')); setTimeout(() => openOccurrenceDelete(course.id, date), 190); }),
      button('inst-btn', '这门课的提醒', () => { closeDialog($('courseDialog')); setTimeout(() => openCourseReminder(course.id), 190); })
    );
    wrap.append(row); target.append(wrap);
  }

  /* ======== 按次删除 ======== */
  function openOccurrenceDelete(id, date) {
    const course = state.courses.find(item => item.id === id); if (!course) return;
    let scope; const base = Workspace.fingerprint(state);
    productOpen('按次删除课程', () => {
      if (base !== Workspace.fingerprint(state)) throw new Error('课表已改变，请重新核对');
      const result = Workspace.removeOccurrences(state, { courseId: id, date, scope: scope.value }, productOptions());
      if (productCommit(result.state, '已删除 ' + result.affected + ' 次课', true)) closeDialog(productDialog);
    }, { eyebrow: 'OCCURRENCE · DELETE', confirm: '确认删除', subtitle: dateText(date, true) + ' · ' + course.name });
    scope = pfScope(productBody);
    productBody.append(node('p', 'pf-note', '删除会记录在导入账本里：之后从教务网页合并时，不会把已删除的安排加回来。'));
  }

  /* ======== 调课 / 按次修改 ======== */
  function openOccurrenceEdit(id, date) {
    const course = state.courses.find(item => item.id === id); if (!course) return;
    let scope, name, room, teacher, targetDate, start, end, pending, note, night, clockBegin, clockFinish, acceptConflict = null, plan = null;
    const base = Workspace.fingerprint(state);
    const preview = node('div');
    productOpen('调课 / 按次修改', onConfirm, { eyebrow: 'OCCURRENCE · EDIT', confirm: '核对修改', subtitle: dateText(date, true) + ' · ' + course.name });
    scope = pfScope(productBody);
    name = pfField(productBody, '课程名称', course.name, 'text', 'occurrenceName');
    const grid = node('div', 'pf-grid2'); productBody.append(grid);
    room = pfField(grid, '教室', course.room, 'text', 'occurrenceRoom');
    teacher = pfField(grid, '教师', course.teacher, 'text', 'occurrenceTeacher');
    targetDate = pfField(productBody, '把所选这次课调整到（后续按相同天数平移）', date, 'date', 'occurrenceTargetDate');
    const grid2 = node('div', 'pf-grid2'); productBody.append(grid2);
    start = pfField(grid2, '开始节次', course.start, 'number', 'occurrenceStart'); start.min = 1; start.max = state.periods.length;
    end = pfField(grid2, '结束节次', course.end, 'number', 'occurrenceEnd'); end.min = 1; end.max = state.periods.length;
    pending = pfCheck(productBody, '时间待确认', course.timeMode === 'pending', 'occurrencePending', '保留已知信息，时间确认后再核对冲突');
    note = pfField(productBody, '待确认说明', course.timeNote || '', 'text', 'occurrenceTimeNote');
    const clocks=window.SuikeCourseTime.initial(course,state.periods),clockGrid=node('div','pf-grid2');productBody.append(clockGrid);
    clockBegin=pfField(clockGrid,'开始时间',clocks.begin,'time','occurrenceBegin');clockFinish=pfField(clockGrid,'结束时间',clocks.finish,'time','occurrenceFinish');
    note.closest('label').hidden=true;night=document.createElement('input');night.type='hidden';night.value=course.sourceTime||'';
    [clockBegin,clockFinish].forEach(input=>input.addEventListener('change',()=>{
      const mapped=window.SuikeCourseTime.infer(state.periods,clockBegin.value,clockFinish.value);if(mapped){start.value=mapped.start;end.value=mapped.end;}
      if(clockBegin.value&&clockFinish.value)pending.checked=false;resetPlan();
    }));
    [start,end].forEach(input=>input.addEventListener('change',()=>{
      const a=Number(start.value),b=Number(end.value);if(a>0&&b>=a&&b<=state.periods.length){clockBegin.value=state.periods[a-1].start;clockFinish.value=state.periods[b-1].end;}resetPlan();
    }));
    productBody.append(preview);
    [scope, name, room, teacher, targetDate, start, end, pending, note, night].forEach(input => input.addEventListener('input', resetPlan));
    function resetPlan() { plan = null; acceptConflict = null; preview.replaceChildren(); productConfirm.textContent = '核对修改'; }
    function onConfirm() {
      if (base !== Workspace.fingerprint(state)) throw new Error('课表已改变，请重新核对');
      if (!plan) {
        const changes=Object.assign({name:name.value.trim(),room:room.value.trim(),teacher:teacher.value.trim()},window.SuikeCourseTime.resolve(state.periods,clockBegin.value,clockFinish.value,Number(start.value)||null,Number(end.value)||null,pending.checked,note.value));
        plan = Workspace.editOccurrences(state, { courseId: id, date, scope: scope.value, targetDate: targetDate.value, changes }, productOptions());
        renderEditPreview(); productConfirm.textContent = '确认保存'; return;
      }
      if (acceptConflict && !acceptConflict.checked) throw new Error('请先核对并确认时间冲突');
      if (productCommit(plan.state, '已修改 ' + plan.affected + ' 次课', true)) closeDialog(productDialog);
    }
    function renderEditPreview() {
      preview.replaceChildren();
      const box = node('div', 'pf-card');
      box.append(node('p', 'pf-steps', 'PREVIEW · 将修改 ' + plan.affected + ' 次课'));
      if (!plan.affected) box.append(node('p', 'pf-note', '修改后与原来一致，没有需要保存的内容。'));
      if (plan.dates.length) {
        const chips = node('div', 'pf-chips');
        plan.dates.forEach((moved, index) => {
          const original = plan.originalDates[index];
          chips.append(node('span', 'pf-chip', original === moved ? moved : original + ' → ' + moved));
        });
        box.append(chips);
      }
      plan.conflicts.forEach(conflict => {
        const row = node('div', 'pf-conflict');
        row.append(node('strong', '', conflict.name), node('span', '', ' ' + conflict.date + ' · ' + conflict.start + '–' + conflict.end + ' 与调整后 ' + conflict.candidateStart + '–' + conflict.candidateEnd + ' 重叠'));
        box.append(row);
      });
      if (plan.conflicts.length) acceptConflict = pfCheck(box, '我已核对，仍保留这次修改', false, 'acceptOccurrenceConflict', '时间重叠的修改会同时写入课表');
      plan.unconfirmed.forEach(item => {
        const row = node('div', 'pf-unconfirmed', (item.name || '这次调整') + ' ' + item.date + ' · 时间待确认，无法核对冲突');
        box.append(row);
      });
      if (plan.unconfirmed.length) box.append(node('p', 'pf-note', '部分课程时间待确认，无法完整核对冲突；修改仍会保存。'));
      const back = node('div', 'pf-row-actions');
      back.append(button('text-button', '返回修改', resetPlan));
      box.append(back);
      preview.append(box);
    }
  }

  /* ======== 单课提醒 ======== */
  function openCourseReminder(id) {
    const course = state.courses.find(item => item.id === id); if (!course) return;
    const prefs = Product.settings(state), rule = prefs.reminders.courseOverrides[id] || {}; let mode, lead;
    productOpen('课程提醒', () => {
      delete prefs.reminders.courseOverrides[id]; prefs.reminders.mutedCourseIds = prefs.reminders.mutedCourseIds.filter(value => value !== id);
      if (mode.value !== 'inherit') prefs.reminders.courseOverrides[id] = { enabled: mode.value === 'on', leadMinutes: Number(lead.value) };
      const next = clone(state); next.productSettings = prefs;
      if (productCommit(next, '课程提醒已保存', true)) closeDialog(productDialog);
    }, { eyebrow: 'REMINDERS · 单课', confirm: '保存设置', subtitle: course.name });
    mode = pfSelect(productBody, '这门课的提醒', [['inherit', '跟随全局'], ['on', '开启'], ['off', '关闭']], prefs.reminders.mutedCourseIds.includes(id) || rule.enabled === false ? 'off' : rule.enabled === true ? 'on' : 'inherit', 'courseReminderMode');
    lead = pfField(productBody, '提前几分钟', rule.leadMinutes === undefined ? prefs.reminders.leadMinutes : rule.leadMinutes, 'number'); lead.min = 0; lead.max = 120;
    productBody.append(node('p', 'pf-note', '全局提醒关闭时，所有课程均不发送通知。'));
  }

  /* ======== 实验 / 调课通知导入（三层确认） ======== */
  const ISSUE_TEXT = {
    COURSE_NAME_REQUIRED: '缺少课程名称', CLASS_REQUIRED: '需要先选择班级', BATCH_REQUIRED: '需要先选择批次',
    BATCH_MAPPING_UNCLEAR: '批次对应不明', DAY_REQUIRED: '缺少明确星期', DATES_REQUIRED: '缺少日期或周次',
    START_MONDAY_REQUIRED: '需要先设置第一周周一', DATE_DAY_MISMATCH: '日期与星期不一致', DATE_WEEK_MISMATCH: '日期与周次不一致',
    ROOM_MAPPING_UNCLEAR: '地点对应不明，请逐次确认', ROOM_REQUIRED: '地点待补充', TIME_REQUIRED: '缺少明确时间',
    ALTERNATIVE_TIME_UNCLEAR: '含备选时间，请确认实际安排', NOTICE_CHANGE_REQUIRES_REVIEW: '取消/调整类通知，请核对原安排'
  };
  function issueText(issue) { return ISSUE_TEXT[issue] || issue; }
  function openNoticeImport(text) {
    const prefs = Product.settings(state); let courseName;
    productOpen('导入实验 / 调课通知', () => {
      const parsed = Notice.parse(noticeTextField.value, { courseName: courseName.value.trim(), startMonday: state.settings.startMonday, totalWeeks: state.settings.totalWeeks, classNumber: prefs.profile.classNumber, batchNumber: prefs.profile.batchNumber });
      if (!parsed.drafts.length) throw new Error('未识别到明确日期或周次，请补充原通知后重试');
      noticeDrafts = parsed.drafts; noticeBase = Workspace.fingerprint(state); renderNoticePreview(parsed.warnings || []);
    }, {
      eyebrow: 'NOTICE · STEP 01 原文', confirm: '生成预览',
      subtitle: '粘贴通知文字，或用本机识别截图。识别内容可修改，逐条确认后才会写入课表。'
    });
    const profile = node('div', 'pf-profile');
    const profileText = node('p', 'pf-profile-text');
    profileText.append(document.createTextNode('解析身份 '), node('strong', '', prefs.profile.classNumber + ' 班 · ' + prefs.profile.batchNumber + ' 批'), document.createTextNode(' · ' + (state.settings.startMonday || '周一未设置')));
    profile.append(profileText, button('text-button', '修改', () => { closeDialog(productDialog); setTimeout(openSetup, 190); }));
    productBody.append(profile);
    courseName = pfField(productBody, '课程名称（通知未写明时填写）', '', 'text', 'noticeCourseName');
    noticeTextField = pfField(productBody, '通知原文', typeof text === 'string' ? text : '', 'textarea', 'noticeText');
    const actions = node('div', 'pf-row-actions');
    actions.append(button('text-button', '从截图识别（本机）', () => { try { if (nativeCall('chooseNoticeScreenshot')) showToast('请选择通知截图；识别后请核对文字'); } catch (error) { showToast(error.message); } }));
    productBody.append(actions);
    productBody.append(node('p', 'pf-note', '「下午」「下课后」等模糊时间会保留为待确认，不会猜成具体节次；取消或调整类通知只提示，不会自动删除原安排。'));
  }
  function renderNoticePreview(warnings) {
    let allowWrap;
    productOpen('核对通知安排', () => {
      if (noticeBase !== Workspace.fingerprint(state)) throw new Error('课表已改变，请重新生成通知预览');
      const selected = noticeDrafts.filter(draft => draft.confirmed);
      if (!selected.length) throw new Error('请核对并勾选要导入的安排');
      const plan = Notice.plan(state, selected, productOptions());
      if (plan.errors.length) throw new Error('部分安排还缺少有效日期、节次或时间说明，请补全');
      if (plan.conflicts.length && !$('noticeAllowConflicts').checked) throw new Error('存在时间冲突，请先核对并勾选保留冲突安排');
      const result = Notice.merge(state, selected, Object.assign(productOptions(), { allowConflicts: $('noticeAllowConflicts').checked }));
      if (productCommit(result.state, '通知已导入：新增 ' + result.summary.added + ' 次，重复 ' + result.summary.duplicates + ' 次', true)) { noticeBase = null; noticeDrafts = []; closeDialog(productDialog); }
    }, {
      eyebrow: 'NOTICE · STEP 02 逐条核对', confirm: '导入已确认安排',
      subtitle: '每条安排默认不勾选；修改任何字段都会撤销该条确认。'
    });
    warnings.forEach(warning => productBody.append(node('p', 'pf-warn', typeof warning === 'string' ? warning : warning.message || warning.code || '请核对通知中的歧义')));
    noticeDrafts.forEach((draft, index) => {
      const row = node('div', 'teaching-row pf-card pf-draft');
      const head = node('div', 'pf-card-head');
      head.append(node('strong', '', '安排 ' + (index + 1)), pfPill(draft.week ? '第 ' + draft.week + ' 周' : (draft.date || '日期待补')));
      row.append(head);
      function bind(label, key, type) {
        const input = pfField(row, label, draft[key], type);
        input.addEventListener('input', () => {
          draft[key] = type === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value;
          if (key === 'date' && M.parseISO(input.value)) { draft.day = M.dayOf(input.value); draft.dates = [input.value]; }
          draft.confirmed = false; confirmed.checked = false; updateNoticePlan();
        });
        return input;
      }
      bind('课程', 'name', 'text'); bind('日期', 'date', 'date');
      const mode = pfSelect(row, '时间类型', [['periods', '已确认节次'], ['pending', '时间待确认']], draft.timeMode === 'pending' ? 'pending' : 'periods');
      const grid = node('div', 'pf-grid2'); row.append(grid);
      const firstPeriod = bind('开始节次', 'start', 'number'), lastPeriod = bind('结束节次', 'end', 'number');
      grid.append(firstPeriod.closest('label'), lastPeriod.closest('label'));
      bind('教室', 'room', 'text'); bind('教师（选填）', 'teacher', 'text');
      const nightTime = bind('晚课完整时间（9–10节请补填）', 'sourceTime', 'text'); bind('待确认说明', 'timeNote', 'text');
      function noticeTimeMode() {
        const isPending = mode.value === 'pending'; draft.timeMode = mode.value;
        firstPeriod.disabled = isPending; lastPeriod.disabled = isPending; nightTime.disabled = isPending;
        if (isPending) { draft.start = null; draft.end = null; draft.sourceTime = ''; }
        else { draft.start = firstPeriod.value === '' ? null : Number(firstPeriod.value); draft.end = lastPeriod.value === '' ? null : Number(lastPeriod.value); draft.sourceTime = nightTime.value; }
      }
      noticeTimeMode();
      mode.addEventListener('change', () => { noticeTimeMode(); draft.confirmed = false; confirmed.checked = false; updateNoticePlan(); });
      if (draft.issues && draft.issues.length) row.append(node('p', 'pf-draft-issues', '需要核对：' + draft.issues.map(issue => issueText(typeof issue === 'string' ? issue : issue.code || issue.message)).join('、')));
      const confirmed = pfCheck(row, '我已核对这次安排，加入课表', false, 'noticeConfirm' + index);
      confirmed.addEventListener('change', () => { draft.confirmed = confirmed.checked; updateNoticePlan(); });
      productBody.append(row);
    });
    const summary = node('p', 'pf-summary'); summary.id = 'noticePlanSummary'; productBody.append(summary);
    allowWrap = node('div'); allowWrap.hidden = true;
    pfCheck(allowWrap, '已核对时间冲突，仍保留所选安排', false, 'noticeAllowConflicts', '冲突的安排会同时写入课表');
    productBody.append(allowWrap);
    updateNoticePlan();
    function updateNoticePlan() {
      const selected = noticeDrafts.filter(draft => draft.confirmed), plan = Notice.plan(state, selected, productOptions());
      summary.textContent = '已选 ' + selected.length + ' 次：新增 ' + plan.additions.length + '，重复 ' + plan.duplicates.length + '，冲突 ' + plan.conflicts.length + '，待补全 ' + plan.errors.length + '。';
      allowWrap.hidden = plan.conflicts.length === 0;
    }
  }

  /* ======== 对外接口（契约保持不变） ======== */
  window.SuikeFeatures = Object.freeze({
    openToday: () => { activeView='today';render(); },
    syncNative: () => syncNative(true),
    nativeStatus: value => { nativeFeatureStatus = value; if (value && value.ok === false) nativeFingerprint = ''; const target = $('nativeFeatureStatus'); if (target) target.textContent = nativeStatusText(value); return true; },
    receiveNoticeText: (text, error) => {
      if (error && error !== 'none') { if (error !== 'CANCELLED') showToast(error === 'NO_TEXT' ? '未识别到文字，请换张清晰截图或粘贴通知' : '截图识别失败，可粘贴通知文字'); return false; }
      if (typeof text !== 'string' || text.length > 20000) return false;
      if (!productDialog.open || !noticeTextField || !productDialog.contains(noticeTextField)) openNoticeImport(text); else noticeTextField.value = text;
      showToast('截图文字已填入，请核对后生成预览'); return true;
    },
    getState: () => clone(state), settings: () => Product.settings(state),
    openNoticeImport, openHistory, openSemesters, openReminders, openSetup, openOccurrenceEdit, openOccurrenceDelete,
    listHistory: () => workspaceStore.listHistory(), listSemesters: () => workspaceStore.listSemesters(),
    restoreHistory: id => productAdopt(workspaceStore.restoreHistory(state, id), '历史课表已恢复'),
    createSemester: config => productAdopt(workspaceStore.createSemester(state, Object.assign({ periods: state.periods }, config)), '新学期已创建'),
    switchSemester: id => productAdopt(workspaceStore.switchSemester(state, id), '学期已切换'),
    parseNotice: (text, context) => Notice.parse(text, Object.assign({ startMonday: state.settings.startMonday, totalWeeks: state.settings.totalWeeks, classNumber: Product.settings(state).profile.classNumber, batchNumber: Product.settings(state).profile.batchNumber }, context)),
    previewNotice: drafts => Notice.plan(state, drafts, productOptions()),
    commitNotice: (drafts, options) => { const result = Notice.merge(state, drafts, Object.assign(productOptions(), options)); return productCommit(result.state, '通知已导入', true) ? result.summary : false; },
    editOccurrences: request => Workspace.editOccurrences(state, request, productOptions()),
    removeOccurrences: request => Workspace.removeOccurrences(state, request, productOptions()),
    commitState: (next, reason) => productCommit(next, reason || '课表已保存', true)
  });
  setTimeout(() => { syncNative(true); if(window.SuikeNative&&typeof window.SuikeNative.consumeWidgetLaunch==='function'&&nativeCall('consumeWidgetLaunch')){activeView='today';render();} if (!Product.settings(state).setupCompleted) openSetup(); }, 500);
