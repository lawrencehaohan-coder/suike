/* 随课：无账号、无第三方依赖，所有编辑与备份均留在用户设备。 */
(function () {
  'use strict';
  const M = window.TimetableModel;
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'suike.timetable.v1';
  const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
  const DOW_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const DOW_EN = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  let state, original, storageAvailable = true, detailId = null, detailDate = null, undoState = null, toastTimer = null, deferredInstall = null;
  let selectedDate = chinaToday(), weekMonday, activeView = 'today';
  function chinaNow() {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    return Object.fromEntries(parts.map(part => [part.type, part.value]));
  }
  function chinaToday() { const p = chinaNow(); return p.year + '-' + p.month + '-' + p.day; }
  function minutes(value) { if (!value) return null; const p = value.split(':').map(Number); return p[0] * 60 + p[1]; }
  function dateText(value, year) { const parts = value.split('-').map(Number); return (year ? parts[0] + '年' : '') + parts[1] + '月' + parts[2] + '日'; }
  function isPending(course) { return course.timeMode === 'pending'; }
  function periodText(course) { return isPending(course) ? '时间待确认' : '第 ' + course.start + (course.start === course.end ? '' : '–' + course.end) + ' 节'; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function node(tag, className, text) { const result = document.createElement(tag); if (className) result.className = className; if (text != null) result.textContent = text; return result; }
  function button(className, text, handler) { const result = node('button', className, text); result.type = 'button'; if (handler) result.addEventListener('click', handler); return result; }
  function setChildren(target, children) { target.replaceChildren(...children); }
  function showToast(message, canUndo) {
    clearTimeout(toastTimer);
    const toast = $('toast'); toast.replaceChildren(node('span', '', message));
    if (canUndo && undoState) {
      const undoButton = button('toast-undo', '撤销', () => {
        if (!undoState) return;
        state = undoState; undoState = null; save(); render(); showToast('已撤销刚才的修改');
      });
      undoButton.style.cssText = 'margin-left:12px;border:1px solid currentColor;border-radius:4px;padding:4px 10px;background:transparent;color:inherit';
      toast.append(undoButton);
    }
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, canUndo ? 14000 : 6000);
  }
  function save() {
    try {
      // A restored/undone initial timetable follows later bundled seed updates.
      // Customized timetables keep their own copy and are never silently replaced.
      if (JSON.stringify(state) === JSON.stringify(original)) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageAvailable = true;
    }
    catch (_) { storageAvailable = false; }
  }
  function commit(next, message) {
    const validated = M.validateState(next);
    undoState = clone(state); state = validated; save(); render();
    showToast(message + (storageAvailable ? '' : '；浏览器无法保存，请导出备份'), true);
  }
  try {
    if (!M) throw new Error('课表组件未载入');
    weekMonday = M.mondayOf(selectedDate);
    original = M.validateState(window.TIMETABLE_SEED);
    state = clone(original);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const loaded = M.applySeedUpdates(JSON.parse(stored), original);
          state = loaded.state;
          if (loaded.changed) save();
        }
        catch (_) { setTimeout(() => showToast('已有本地数据无法读取，当前显示初始课表；原数据未覆盖'), 400); }
      }
    } catch (_) { storageAvailable = false; }
  } catch (error) {
    $('agenda').textContent = '课表载入失败：' + error.message + '。请保留完整课表文件后重试。';
    $('statusLine').textContent = '未修改任何本地数据';
    return;
  }
  function weekDescription(monday) {
    const week = M.weekNumber(monday, state.settings.startMonday);
    return week && week > 0 && week <= state.settings.totalWeeks ? '第 ' + week + ' 周' : dateText(monday) + '这一周';
  }
  function selectedCourses() { return M.coursesOn(state.courses, selectedDate); }
  function courseConflictOn(course, date) { return M.conflictsFor(state.courses, course).filter(other => other.dates.includes(date)); }
  function two(value) { return String(value).padStart(2, '0'); }
  function renderHeader() {
    const p = chinaNow(), today = chinaToday(), dow = M.dayOf(today);
    $('clock').textContent = p.hour + ':' + p.minute;
    $('headDate').textContent = p.year + '.' + p.month + '.' + p.day + ' ' + DOW_EN[dow - 1] + ' · UTC+8';
    const week = M.weekNumber(today, state.settings.startMonday);
    $('headWeek').textContent = (week && week > 0 && week <= state.settings.totalWeeks ? 'W' + two(week) : 'W--') + ' · ' + DOW_EN[dow - 1];
    const now = Number(p.hour) * 60 + Number(p.minute), periods = state.periods;
    let current = -1, upcoming = -1;
    for (let index = 0; index < periods.length; index++) {
      const start = minutes(periods[index].start), end = minutes(periods[index].end);
      if (now >= start && now < end) { current = index; break; }
      if (now < start) { upcoming = index; break; }
    }
    if (current >= 0) {
      $('headPeriod').textContent = 'PERIOD ' + two(current + 1);
      $('headPhase').textContent = '进行中 · 剩 ' + (minutes(periods[current].end) - now) + ' MIN';
    } else if (upcoming >= 0) {
      $('headPeriod').textContent = 'PERIOD ' + two(upcoming + 1);
      $('headPhase').textContent = (upcoming === 0 ? '课前 ' : 'BREAK ') + (minutes(periods[upcoming].start) - now) + ' MIN';
    } else {
      $('headPeriod').textContent = 'PERIOD --';
      $('headPhase').textContent = '今日课程已结束';
    }
  }
  function applyColor(element, color) {
    const hex = M.colorHex(color);
    const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
    element.style.setProperty('--course-color', hex);
    element.style.setProperty('--course-bg', 'rgba(' + rgb.join(',') + ', .15)');
    element.style.setProperty('--course-ink', 'var(--text)');
  }
  function renderWeekPicker() {
    const current = chinaToday(), dates = state.courses.flatMap(course => course.dates);
    const bounds = [current, weekMonday, state.settings.coverageStart, state.settings.coverageEnd, state.settings.startMonday, ...dates].filter(Boolean).sort();
    if (state.settings.startMonday) bounds.push(M.addDays(state.settings.startMonday, (state.settings.totalWeeks - 1) * 7));
    bounds.sort();
    const first = M.mondayOf(bounds[0]), last = M.mondayOf(bounds[bounds.length - 1]);
    const fragment = document.createDocumentFragment();
    let count = 0;
    for (let monday = first; monday <= last && count < 1600; monday = M.addDays(monday, 7), count++) {
      const option = node('option', '', weekDescription(monday)); option.value = monday; option.selected = monday === weekMonday; fragment.append(option);
    }
    $('weekSelect').replaceChildren(fragment);
    // A very distant imported date must not make the currently selected week disappear.
    if (!$('weekSelect').value || $('weekSelect').value !== weekMonday) {
      const option = node('option', '', weekDescription(weekMonday)); option.value = weekMonday; option.selected = true; $('weekSelect').append(option);
    }
    $('weekLabel').textContent = weekDescription(weekMonday);
    $('weekRange').textContent = dateText(weekMonday, true) + ' — ' + dateText(M.addDays(weekMonday, 6));
  }
  function renderDayStrip() {
    const today = chinaToday();
    const buttons = WEEKDAYS.map((name, index) => {
      const date = M.addDays(weekMonday, index), count = M.coursesOn(state.courses, date).length;
      const item = button('day-btn' + (date === selectedDate ? ' active' : '') + (date === today ? ' is-today' : ''), '', () => { selectedDate = date; render(); });
      item.setAttribute('aria-label', dateText(date) + '星期' + name + '，' + count + ' 门课程');
      item.setAttribute('aria-pressed', String(date === selectedDate));
      item.append(node('span', 'day-name', DOW_LETTERS[index]));
      const pips = node('span', 'day-pips'); pips.setAttribute('aria-hidden', 'true');
      for (let pip = 0; pip < Math.min(count, 5); pip++) pips.append(node('i'));
      item.append(pips);
      return item;
    });
    setChildren($('dayStrip'), buttons);
  }
  function courseStatus(course, date) {
    if (isPending(course)) return { label: '时间待确认', className: '' };
    const today = chinaToday(), range = M.timeRange(course, state.periods), p = chinaNow(), now = Number(p.hour) * 60 + Number(p.minute);
    if (date < today) return { label: '已结束', className: 'done' };
    if (date > today || !range.exact) return { label: '待上课', className: '' };
    if (now >= minutes(range.end)) return { label: '已结束', className: 'done' };
    if (now >= minutes(range.start)) return { label: '进行中', className: 'current' };
    return { label: '待上课', className: '' };
  }
  function renderNext() {
    const target = $('nextCourse'), today = chinaToday(), p = chinaNow(), now = Number(p.hour) * 60 + Number(p.minute);
    const cards = [];
    let upcoming;
    if (selectedDate === today) {
      const current = selectedCourses().filter(course => !isPending(course)).find(course => {
        const time = M.timeRange(course, state.periods);
        return time.exact && now >= minutes(time.start) && now < minutes(time.end);
      });
      if (current) {
        const time = M.timeRange(current, state.periods);
        const card = button('now-card', '', () => openDetail(current.id, today));
        const label = node('p', 'nc-label');
        label.append(node('i', 'nc-dot'), document.createTextNode('NOW · 第 ' + current.start + (current.start === current.end ? '' : '–' + current.end) + ' 节进行中'));
        const row = node('div', 'nc-row');
        row.append(node('h3', 'nc-name', current.name), node('span', 'nc-time', time.start + '–' + time.end));
        const meta = node('p', 'nc-meta', (current.room || '地点待补充') + (current.teacher ? ' · ' + current.teacher : ''));
        const progress = node('span', 'nc-progress'); progress.setAttribute('aria-hidden', 'true');
        const bar = node('i');
        bar.style.width = Math.min(100, Math.max(0, (now - minutes(time.start)) / (minutes(time.end) - minutes(time.start)) * 100)) + '%';
        progress.append(bar);
        card.append(label, row, meta, progress);
        cards.push(card);
      }
      const candidates = state.courses.filter(course => !isPending(course)).flatMap(course => course.dates.filter(date => date >= today).map(date => ({ course, date, time: M.timeRange(course, state.periods) })))
        .filter(item => item.date !== today || !item.time.exact || minutes(item.time.end) > now)
        .filter(item => !current || item.course !== current)
        .sort((a, b) => a.date.localeCompare(b.date) || a.course.start - b.course.start);
      upcoming = candidates[0];
    } else {
      const first = selectedCourses().find(course => !isPending(course));
      if (first) upcoming = { course: first, date: selectedDate, time: M.timeRange(first, state.periods) };
    }
    if (upcoming) {
      const { course, date, time } = upcoming;
      const card = button('next-card', '', () => openDetail(course.id, date));
      card.append(node('p', 'nc-label', 'NEXT UP' + (date !== today ? ' · ' + dateText(date) : '')));
      const row = node('div', 'nc-row');
      const info = node('div', 'nc-info');
      info.append(node('h3', 'nc-name', course.name), node('p', 'nc-meta', (course.room || '地点待补充') + (course.teacher ? ' · ' + course.teacher : '') + ' · ' + periodText(course)));
      row.append(node('span', 'nc-big', time.start || '晚课'), info);
      card.append(row);
      cards.push(card);
    }
    target.replaceChildren(...cards);
  }
  function renderWeekLoad() {
    const target = $('weekLoad'); if (!target) return;
    const counts = WEEKDAYS.map((_, index) => M.coursesOn(state.courses, M.addDays(weekMonday, index)).length);
    const total = counts.reduce((sum, count) => sum + count, 0);
    const wrap = node('div');
    wrap.append(node('p', 'micro wl-title', 'WEEK LOAD · ' + total + ' 节'));
    const bars = node('div', 'wl-bars'); bars.setAttribute('aria-hidden', 'true');
    counts.forEach((count, index) => {
      const col = node('span', 'wl-col');
      const bar = node('i', 'wl-bar' + (count ? '' : ' empty'));
      bar.style.height = count ? Math.max(10, count * 8) + 'px' : '2px';
      col.append(bar, node('span', 'wl-label', DOW_LETTERS[index]));
      bars.append(col);
    });
    wrap.append(bars);
    target.replaceChildren(wrap);
  }
  function pendingCard(course, date, showDate) {
    const item = button('pending-course', '', () => openDetail(course.id, date)); applyColor(item, course.color);
    if (showDate) item.append(node('p', 'pending-date', dateText(date) + ' · 周' + WEEKDAYS[M.dayOf(date) - 1]));
    item.append(node('h3', 'course-name', course.name), node('p', 'pending-time-note', M.timeRange(course, state.periods).text));
    const meta = node('div', 'course-meta'); meta.append(node('span', '', course.room || '地点待补充'));
    if (course.teacher) meta.append(node('span', '', course.teacher));
    item.append(meta);
    item.setAttribute('aria-label', dateText(date) + '，' + course.name + '，时间待确认，' + course.timeNote + '，' + (course.room || '地点待补充'));
    return item;
  }
  function renderAgenda() {
    const allCourses = selectedCourses(), courses = allCourses.filter(course => !isPending(course)), pending = allCourses.filter(isPending), today = chinaToday();
    $('selectedDayLabel').textContent = (selectedDate === today ? '今天 · ' : '') + dateText(selectedDate) + ' 周' + WEEKDAYS[M.dayOf(selectedDate) - 1];
    $('agendaCount').textContent = pending.length ? allCourses.length + ' 项安排 · ' + pending.length + ' 项时间待确认' : courses.length ? courses.length + ' 门课程' : '自由安排';
    $('agendaPendingSection').hidden = !pending.length;
    setChildren($('agendaPending'), pending.map(course => pendingCard(course, selectedDate, false)));
    $('agenda').hidden = !courses.length && !!pending.length;
    if (!courses.length) {
      if (pending.length) { $('agenda').replaceChildren(); return; }
      const empty = node('div', 'empty-state');
      const outOfRange = (state.settings.coverageStart && selectedDate < state.settings.coverageStart) || (state.settings.coverageEnd && selectedDate > state.settings.coverageEnd);
      empty.append(node('h3', '', outOfRange ? '这一天尚未导入课程' : '这一天没有课程安排'), node('p', '', outOfRange ? '已导入范围见页面下方；新日期不会自动重复旧课表。' : '享受自由时间，也可以在这里添加一项安排。'), button('button button-outline', '添加课程', () => openEdit()));
      $('agenda').replaceChildren(empty); return;
    }
    const cards = courses.map(course => {
      const status = courseStatus(course, selectedDate), range = M.timeRange(course, state.periods), conflicts = courseConflictOn(course, selectedDate);
      const item = button('agenda-card' + (status.className === 'done' ? ' is-past' : ''), '', () => openDetail(course.id, selectedDate)); applyColor(item, course.color);
      const time = node('div', 'course-time');
      if (range.exact) time.append(node('strong', '', range.start), node('strong', '', range.end)); else time.append(node('strong', '', '晚间课程'));
      time.append(node('small', 'period', periodText(course)));
      const info = node('div', 'course-info'); info.append(node('h3', 'course-name', course.name));
      const meta = node('div', 'course-meta'); meta.append(node('span', '', course.room || '地点待补充')); if (course.teacher) meta.append(node('span', '', course.teacher)); info.append(meta);
      const tag = node('span', 'course-tag ' + status.className, conflicts.length ? '时间冲突' : status.label);
      if (conflicts.length) { tag.style.color = 'var(--danger)'; tag.title = '与 ' + conflicts.map(other => other.name).join('、') + ' 同时上课'; }
      item.append(time, node('span', 'course-line'), info, tag); return item;
    });
    setChildren($('agenda'), cards);
  }
  function renderGrid() {
    const grid = $('weekGrid'), today = chinaToday();
    const maxPeriod = Math.max(state.periods.length, ...state.courses.filter(course => !isPending(course)).flatMap(course => course.dates.some(date => date >= weekMonday && date <= M.addDays(weekMonday, 6)) ? [course.end] : []));
    grid.style.gridTemplateRows = '48px repeat(' + maxPeriod + ',76px)';
    const children = [], corner = node('div', 'grid-corner', '节次'); corner.style.gridArea = '1 / 1'; children.push(corner);
    WEEKDAYS.forEach((name, index) => {
      const date = M.addDays(weekMonday, index), head = node('div', 'grid-day' + (date === today ? ' is-today' : ''));
      head.style.gridArea = '1 / ' + (index + 2); head.append(node('span', '', '周' + name), node('small', '', Number(date.slice(5, 7)) + '/' + Number(date.slice(8)))); children.push(head);
    });
    for (let period = 1; period <= maxPeriod; period++) {
      const time = node('div', 'grid-time' + (period === 5 ? ' afternoon' : ''));
      time.style.gridArea = (period + 1) + ' / 1'; time.append(node('strong', 'period-number', period));
      time.append(node('small', 'period-time', state.periods[period - 1].start + '\n' + state.periods[period - 1].end));
      children.push(time);
      for (let day = 1; day <= 7; day++) { const slot = node('div', 'grid-slot' + (period === 5 ? ' afternoon' : '')); slot.style.gridArea = (period + 1) + ' / ' + (day + 1); slot.setAttribute('aria-hidden', 'true'); children.push(slot); }
    }
    for (let day = 1; day <= 7; day++) {
      const date = M.addDays(weekMonday, day - 1), courses = M.coursesOn(state.courses, date).filter(course => !isPending(course)), laneEnds = [], assignments = [];
      courses.forEach(course => { let lane = laneEnds.findIndex(end => end < course.start); if (lane < 0) lane = laneEnds.length; laneEnds[lane] = course.end; assignments.push({ course, lane }); });
      assignments.forEach(({ course, lane }) => {
        const conflicts = courseConflictOn(course, date), item = button('week-course' + (conflicts.length ? ' conflict' : ''), '', () => openDetail(course.id, date));
        applyColor(item, course.color); item.style.gridArea = (course.start + 1) + ' / ' + (day + 1) + ' / ' + (course.end + 2) + ' / ' + (day + 2);
        if (laneEnds.length > 1) { item.style.width = 'calc(' + (100 / laneEnds.length) + '% - 6px)'; item.style.marginLeft = 'calc(' + (lane * 100 / laneEnds.length) + '% + 3px)'; item.style.justifySelf = 'start'; }
        const label = course.name + '，' + (course.room || '地点待补充') + '，' + M.timeRange(course, state.periods).text + (conflicts.length ? '，时间冲突' : '');
        item.setAttribute('aria-label', label); item.title = label;
        item.append(node('strong', 'course-name', course.name), node('small', 'course-room', course.room || '地点待补充'));
        if (course.teacher) item.append(node('small', 'course-teacher', course.teacher));
        item.append(node('small', 'course-weeks', periodText(course)));
        children.push(item);
      });
    }
    setChildren(grid, children);
    const pending = WEEKDAYS.flatMap((_, index) => {
      const date = M.addDays(weekMonday, index);
      return M.coursesOn(state.courses, date).filter(isPending).map(course => pendingCard(course, date, true));
    });
    $('weekPendingSection').hidden = !pending.length;
    setChildren($('weekPending'), pending);
  }
  function renderSettings() {
    $('startMonday').value = state.settings.startMonday || '';
    $('totalWeeks').value = state.settings.totalWeeks;
    $('theme').value = state.settings.theme;
    document.documentElement.dataset.theme = state.settings.theme;
    $('installApp').textContent = window.matchMedia('(display-mode: standalone)').matches ? '已添加到桌面' : deferredInstall ? '安装随课' : '查看添加方法';
    const periodList = document.querySelector('.period-list');
    if (periodList) {
      const rows = state.periods.map((period, index) => { const row = node('div'); row.append(node('span', '', '第 ' + (index + 1) + ' 节'), node('strong', '', period.start + '–' + period.end)); return row; });
      periodList.replaceChildren(...rows);
    }
  }
  function renderStatus() {
    let text = storageAvailable ? '课程与修改保存在当前设备' : '当前浏览器无法保存修改，请及时导出备份';
    if (state.settings.coverageStart && state.settings.coverageEnd) text += ' · 官网读取范围 ' + dateText(state.settings.coverageStart, true) + '—' + dateText(state.settings.coverageEnd, true);
    text += ' · 只按已读取的具体日期显示';
    if (!state.settings.startMonday) text += ' · 第一周周一待确认，暂不推测教学周次';
    $('statusLine').textContent = text;
  }
  function render() {
    $('termLabel').textContent = state.settings.termLabel;
    renderHeader(); renderWeekPicker(); renderDayStrip(); renderNext(); renderAgenda(); renderGrid(); renderWeekLoad(); renderSettings(); renderStatus();
    document.querySelectorAll('[data-view]').forEach(item => { const selected = item.dataset.view === activeView; item.classList.toggle('active', selected); if (selected) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current'); });
    ['today', 'week', 'settings'].forEach(view => { $(view + 'View').hidden = view !== activeView; });
  }
  function navigateWeek(monday) { weekMonday = monday; selectedDate = M.addDays(monday, M.dayOf(selectedDate) - 1); render(); }
  function showDialog(dialog) { if (typeof dialog.showModal === 'function') dialog.showModal(); else { dialog.setAttribute('open', ''); dialog.scrollIntoView({ block: 'start' }); } }
  function closeDialog(dialog) {
    if (typeof dialog.close === 'function') {
      const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (still || !dialog.open) { dialog.close(); return; }
      dialog.classList.add('closing');
      setTimeout(() => { dialog.classList.remove('closing'); dialog.close(); }, 170);
    } else dialog.removeAttribute('open');
  }
  function armDialogCancel(dialog) {
    dialog.addEventListener('cancel', event => {
      if (dialog.classList.contains('closing')) return;
      event.preventDefault();
      closeDialog(dialog);
    });
  }
  function detailRow(label, text) { const row = node('div', 'detail-row'); row.append(node('span', 'detail-label', label), node('span', '', text)); return row; }
  function openDetail(id, date) {
    const course = state.courses.find(item => item.id === id); if (!course) return;
    detailId = id; detailDate = date;
    const target = $('courseDetail'), dates = course.dates.map(item => {
      const week = M.weekNumber(item, state.settings.startMonday);
      return dateText(item, true) + (week && week > 0 && week <= state.settings.totalWeeks ? '（第' + week + '周）' : '');
    });
    const content = [node('h2', 'detail-title', course.name), node('p', 'detail-subtitle', '星期' + WEEKDAYS[course.day - 1] + ' · ' + periodText(course)), detailRow(isPending(course) ? '时间说明' : '上课时间', M.timeRange(course, state.periods).text), detailRow('教室', course.room || '待补充'), detailRow('教师', course.teacher || '未提供'), detailRow('上课日期', dates.join('、'))];
    const conflicts = M.conflictsFor(state.courses, course);
    if (conflicts.length) { const row = detailRow('时间冲突', conflicts.map(other => other.name).join('、') + '：存在日期及节次重叠，请核实。'); row.style.color = 'var(--danger)'; content.push(row); }
    content.push(detailRow('保存方式', '编辑或删除仅影响这台设备上的私人课表。'));
    target.replaceChildren(...content); showDialog($('courseDialog'));
  }
  function syncTimeMode() {
    const form=$('courseForm'),pending=$('pendingTime').checked;
    ['confirmedStartField','confirmedEndField'].forEach(id=>{$(id).hidden=pending;});
    ['start','end'].forEach(name=>{form.elements.namedItem(name).disabled=pending;form.elements.namedItem(name).required=!pending;});
    $('timeNoteField').hidden=true;$('timeNote').disabled=false;$('timeNote').required=false;
    $('sourceTimeField').hidden=true;form.elements.namedItem('sourceTime').disabled=false;
  }
  function openEdit(course) {
    const form = $('courseForm'); form.reset(); $('formError').hidden = true;
    $('formTitle').textContent = course ? '编辑课程' : '添加课程';
    const values = course ? { ...course, start: course.start ?? '', end: course.end ?? '', weeks: course.dates.join(', '), color: M.colorHex(course.color) } : { id: '', name: '', day: M.dayOf(selectedDate), start: 1, end: 2, room: '', teacher: '', weeks: selectedDate, color: M.COLORS.teal, sourceTime: '' };
    Object.entries(values).forEach(([name, value]) => { const field = form.elements.namedItem(name); if (field && name !== 'dates') field.value = value; });
    ['start','end'].forEach(name=>{
      const select=form.elements.namedItem(name),chosen=values[name];select.replaceChildren();
      const empty=node('option','','选择节次');empty.value='';select.append(empty);
      state.periods.forEach((period,index)=>{const option=node('option','','第 '+(index+1)+' 节 · '+(name==='start'?period.start:period.end));option.value=String(index+1);select.append(option);});select.value=chosen;
    });
    const clocks=window.SuikeCourseTime.initial(course,state.periods);$('courseBegin').value=clocks.begin;$('courseFinish').value=clocks.finish;
    $('pendingTime').checked=!!course&&isPending(course);syncTimeMode();
    showDialog($('editDialog')); setTimeout(() => form.elements.namedItem('name').focus(), 30);
  }
  $('addCourse').addEventListener('click', () => openEdit());
  $('addCourseWeek').addEventListener('click', () => openEdit());
  $('prevWeek').addEventListener('click', () => navigateWeek(M.addDays(weekMonday, -7)));
  $('nextWeek').addEventListener('click', () => navigateWeek(M.addDays(weekMonday, 7)));
  $('thisWeek').addEventListener('click', () => { selectedDate = chinaToday(); weekMonday = M.mondayOf(selectedDate); render(); });
  $('weekSelect').addEventListener('change', event => navigateWeek(event.target.value));
  document.querySelectorAll('[data-view]').forEach(item => item.addEventListener('click', () => { activeView = item.dataset.view; render(); }));
  $('closeDetail').addEventListener('click', () => closeDialog($('courseDialog')));
  $('cancelEdit').addEventListener('click', () => closeDialog($('editDialog')));
  armDialogCancel($('courseDialog'));
  armDialogCancel($('editDialog'));
  $('pendingTime').addEventListener('change', syncTimeMode);
  ['courseBegin','courseFinish'].forEach(id=>$(id).addEventListener('change',()=>{
    const mapped=window.SuikeCourseTime.infer(state.periods,$('courseBegin').value,$('courseFinish').value);
    if(mapped){$('courseForm').elements.namedItem('start').value=mapped.start;$('courseForm').elements.namedItem('end').value=mapped.end;}
    if($('courseBegin').value&&$('courseFinish').value)$('pendingTime').checked=false;syncTimeMode();
  }));
  ['start','end'].forEach(name=>$('courseForm').elements.namedItem(name).addEventListener('change',()=>{
    const form=$('courseForm'),a=Number(form.elements.namedItem('start').value),b=Number(form.elements.namedItem('end').value);
    if(a&&b&&a<=b){$('courseBegin').value=state.periods[a-1].start;$('courseFinish').value=state.periods[b-1].end;}
  }));
  $('editCourse').addEventListener('click', () => { const course = state.courses.find(item => item.id === detailId); closeDialog($('courseDialog')); if (course) openEdit(course); });
  $('deleteCourse').addEventListener('click', () => {
    if (!detailId) return;
    const next = clone(state); next.courses = next.courses.filter(course => course.id !== detailId);
    closeDialog($('courseDialog')); commit(next, '已删除课程'); detailId = null;
  });
  $('courseForm').addEventListener('submit', event => {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
    try {
      const day=Number(data.get('day'));
      const timing=window.SuikeCourseTime.resolve(state.periods,$('courseBegin').value,$('courseFinish').value,Number(data.get('start'))||null,Number(data.get('end'))||null,$('pendingTime').checked,$('timeNote').value);
      const course=Object.assign({id:String(data.get('id')||'local-'+Date.now()+'-'+Math.random().toString(36).slice(2)),name:String(data.get('name')).trim(),day,room:String(data.get('room')).trim(),teacher:String(data.get('teacher')).trim(),color:String(data.get('color')),dates:M.datesFromExpression(String(data.get('weeks')),day,state.settings)},timing);
      const next = clone(state), index = next.courses.findIndex(item => item.id === course.id);
      if (index >= 0) next.courses[index] = course; else next.courses.push(course);
      M.validateState(next);
      const conflicts = M.conflictsFor(next.courses, course);
      commit(next, conflicts.length ? '已保存；存在课程时间冲突，请查看详情' : '课程已保存'); closeDialog($('editDialog'));
    } catch (error) { $('formError').textContent = error.message; $('formError').hidden = false; }
  });
  $('settingsForm').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const next = clone(state); next.settings.startMonday = $('startMonday').value || null; next.settings.totalWeeks = Number($('totalWeeks').value); next.settings.theme = $('theme').value === 'custom' ? state.settings.theme : $('theme').value;
      commit(next, '设置已保存；已有课程的具体日期保持不变');
    } catch (error) { showToast(error.message); }
  });
  $('exportData').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json;charset=utf-8' }), url = URL.createObjectURL(blob), link = node('a');
    link.href = url; link.download = '随课备份-' + chinaToday() + '.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); showToast('已导出备份，换设备时可导入');
  });
  $('restoreData').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('备份文件超过 5 MB，请检查文件');
      const next = M.applySeedUpdates(JSON.parse(await file.text()), original).state;
      commit(next, '已导入 ' + next.courses.length + ' 条课程；可撤销恢复刚才的课表');
    } catch (error) { showToast('导入失败，原课表未改动：' + error.message); }
    event.target.value = '';
  });
  $('resetData').addEventListener('click', () => commit(clone(original), '已恢复官网初始课表；可撤销'));
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event; renderSettings(); });
  window.addEventListener('appinstalled', () => { deferredInstall = null; renderSettings(); showToast('随课已添加到桌面'); });
  $('installApp').addEventListener('click', async () => {
    if (deferredInstall) { const prompt = deferredInstall; deferredInstall = null; await prompt.prompt(); await prompt.userChoice; renderSettings(); }
    else { $('installHelp').open = true; $('installHelp').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  });
  ['courseDialog', 'editDialog'].forEach(id => $(id).addEventListener('click', event => { if (event.target === $(id)) { const rect = $(id).getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog($(id)); } }));
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('./sw.js').catch(() => { /* The timetable still works without offline installation. */ });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  setInterval(() => { if (!document.hidden) { renderHeader(); if (activeView === 'today') { renderNext(); renderAgenda(); } } }, 15000);
  render();
})();
