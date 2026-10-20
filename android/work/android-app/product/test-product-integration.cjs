/* Deterministic CPU integration tests of the actual packaged HTML and event
 * handlers. These checks do not claim Android rendering or OS permission QA. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function decode(text) { return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
function dataKey(name) { return name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
class TestNode {
  constructor(tag, owner, text = '') {
    this.tagName = tag.toUpperCase(); this.ownerDocument = owner; this.parentElement = null;
    this.children = []; this.attributes = {}; this.dataset = {}; this.listeners = {};
    this.style = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } };
    this.hidden = false; this.checked = false; this.disabled = false; this._value = null;
    this.nodeType = tag === '#text' ? 3 : 1; this._text = text;
  }
  get id() { return this.attributes.id || ''; } set id(v) { this.attributes.id = String(v); }
  get className() { return this.attributes.class || ''; } set className(v) { this.attributes.class = String(v); }
  get name() { return this.attributes.name || ''; } set name(v) { this.attributes.name = String(v); }
  get type() { return this.attributes.type || ''; } set type(v) { this.attributes.type = String(v); }
  get open() { return this.getAttribute('open') !== null; } set open(v) { if (v) this.setAttribute('open', ''); else this.removeAttribute('open'); }
  get value() {
    if (this._value !== null) return this._value;
    if (this.tagName === 'SELECT') { const options = this.querySelectorAll('option'); const selected = options.find(n => n.selected) || options[0]; return selected ? selected.value : ''; }
    if (this.tagName === 'OPTION') return this.getAttribute('value') ?? this.textContent;
    if (this.tagName === 'TEXTAREA') return this.textContent;
    return this.getAttribute('value') || '';
  }
  set value(v) { this._value = String(v); }
  get classList() {
    const n = this;
    return { contains(v) { return n.className.split(/\s+/).includes(v); }, toggle(v, on) { const exists = this.contains(v); const enabled = on === undefined ? !exists : on; const a = n.className.split(/\s+/).filter(x => x && x !== v); if (enabled) a.push(v); n.className = a.join(' '); return enabled; }, add(...values) { values.forEach(v => this.toggle(v, true)); }, remove(...values) { values.forEach(v => this.toggle(v, false)); } };
  }
  get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
  set textContent(v) { this._text = String(v ?? ''); this.children.forEach(n => { n.parentElement = null; }); this.children = []; }
  get innerHTML() { return this.textContent; }
  set innerHTML(v) { if (v !== '') throw new Error('Integration harness expects DOM construction through textContent'); this.replaceChildren(); }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children.at(-1) || null; }
  get childNodes() { return this.children; }
  get parentNode() { return this.parentElement; }
  get nextSibling() { return this.parentElement ? this.parentElement.children[this.parentElement.children.indexOf(this) + 1] || null : null; }
  append(...nodes) { nodes.forEach(n => this.appendChild(n instanceof TestNode ? n : this.ownerDocument.createTextNode(String(n)))); }
  prepend(...nodes) { [...nodes].reverse().forEach(n => this.insertBefore(n instanceof TestNode ? n : this.ownerDocument.createTextNode(String(n)), this.firstChild)); }
  appendChild(n) { if (n.nodeType === 11) { [...n.children].forEach(c => this.appendChild(c)); return n; } if (n.parentElement) n.parentElement.removeChild(n); this.children.push(n); n.parentElement = this; return n; }
  removeChild(n) { const i = this.children.indexOf(n); if (i < 0) throw new Error('Missing child'); this.children.splice(i, 1); n.parentElement = null; return n; }
  replaceChildren(...nodes) { this.children.forEach(n => { n.parentElement = null; }); this.children = []; this._text = ''; this.append(...nodes); }
  insertBefore(n, before) { if (before === null) return this.appendChild(n); if (n.parentElement) n.parentElement.removeChild(n); const i = this.children.indexOf(before); if (i < 0) throw new Error('Missing insertion reference'); this.children.splice(i, 0, n); n.parentElement = this; return n; }
  remove() { if (this.parentElement) this.parentElement.removeChild(this); }
  before(n) { this.parentElement.insertBefore(n, this); }
  after(n) { this.parentElement.insertBefore(n, this.nextSibling); }
  replaceWith(n) { const parent = this.parentElement; parent.insertBefore(n, this); parent.removeChild(this); }
  insertAdjacentElement(where, n) { if (where === 'beforebegin') this.before(n); else if (where === 'afterend') this.after(n); else if (where === 'afterbegin') this.prepend(n); else this.append(n); return n; }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'value') this._value = String(v); if (k === 'checked') this.checked = true; if (k === 'selected') this.selected = true; if (k === 'disabled') this.disabled = true; if (k === 'hidden') this.hidden = true; if (k.startsWith('data-')) this.dataset[dataKey(k)] = String(v); }
  getAttribute(k) { if (k.startsWith('data-') && this.dataset[dataKey(k)] !== undefined) return this.dataset[dataKey(k)]; return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; if (k.startsWith('data-')) delete this.dataset[dataKey(k)]; if (k === 'disabled') this.disabled = false; if (k === 'hidden') this.hidden = false; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); }
  async fire(type, extra = {}) {
    let stopped = false;
    const event = { type, target: this, currentTarget: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { stopped = true; }, ...extra };
    for (let target = this; target; target = target.parentElement) {
      event.currentTarget = target;
      for (const fn of target.listeners[type] || []) await fn(event);
      if (stopped || extra.bubbles === false) break;
    }
    return event;
  }
  async click() { if (this.disabled) return; if (this.type === 'checkbox') { this.checked = !this.checked; await this.fire('change'); } return this.fire('click'); }
  matches(selector) {
    if (selector.includes(',')) return selector.split(',').some(s => this.matches(s.trim()));
    const negations = [...selector.matchAll(/:not\(([^)]+)\)/g)].map(m => m[1]);
    if (negations.some(s => this.matches(s))) return false;
    selector = selector.replace(/:not\([^)]+\)/g, '');
    if (selector.includes(':checked') && !this.checked || selector.includes(':disabled') && !this.disabled) return false;
    selector = selector.replace(/:(checked|disabled)/g, '');
    const attrs = [...selector.matchAll(/\[([\w-]+)(?:\s*=\s*["']?([^\]"']*)["']?)?\]/g)];
    if (attrs.some(m => m[2] === undefined ? this.getAttribute(m[1]) === null : this.getAttribute(m[1]) !== m[2])) return false;
    selector = selector.replace(/\[[^\]]+\]/g, '');
    const id = /#([\w-]+)/.exec(selector); if (id && this.id !== id[1]) return false;
    if ([...selector.matchAll(/\.([\w-]+)/g)].some(m => !this.classList.contains(m[1]))) return false;
    const tag = /^[\w-]+/.exec(selector); return !tag || this.tagName === tag[0].toUpperCase();
  }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(s => s.trim());
    const all = this.children.flatMap(n => [n, ...n.querySelectorAll('*')]);
    return all.filter(node => selectors.some(s => {
      const parts = s.split(/\s+(?![^\[]*\])/); if (!node.matches(parts.pop())) return false;
      let ancestor = node.parentElement;
      while (parts.length) { const expected = parts.pop(); while (ancestor && !ancestor.matches(expected)) ancestor = ancestor.parentElement; if (!ancestor) return false; ancestor = ancestor.parentElement; }
      return true;
    }));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { for (let n = this; n; n = n.parentElement) if (n.matches(selector)) return n; return null; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  get elements() { return { namedItem: name => this.querySelectorAll('input,select,textarea').find(n => n.name === name) || null }; }
  reset() { this.querySelectorAll('input,select,textarea').forEach(n => { n._value = n.getAttribute('value'); n.checked = n.getAttribute('checked') !== null; }); }
  scrollIntoView() {} focus() { this.ownerDocument.activeElement = this; } showModal() { this.open = true; } close() { this.open = false; }
  getBoundingClientRect() { return { left: 0, right: 1000, top: 0, bottom: 1000, width: 1000, height: 1000 }; }
}
function suikeTest2d() { return { fillStyle: '', font: '', textAlign: '', textBaseline: '', scale() {}, fillText() {}, fillRect() {}, getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }; } }; }
class TestDocument extends TestNode {
  constructor() { super('#document', null); this.ownerDocument = this; this.documentElement = this.createElement('html'); this.append(this.documentElement); this.body = null; this.readyState = 'complete'; }
  createElement(tag) { const node = new TestNode(tag, this); if (tag === 'canvas') node.getContext = () => suikeTest2d(); return node; }
  createElementNS(namespace, tag) { return this.createElement(tag); }
  createTextNode(text) { return new TestNode('#text', this, text); }
  createDocumentFragment() { const n = new TestNode('#fragment', this); n.nodeType = 11; return n; }
  getElementById(id) { return this.querySelector('#' + id); }
}
class TestFormData {
  constructor(form) { this.map = new Map(); form.querySelectorAll('input,select,textarea').forEach(n => { if (n.name && !n.disabled && (n.type !== 'checkbox' && n.type !== 'radio' || n.checked)) this.map.set(n.name, n.type === 'checkbox' ? n.value || 'on' : n.value); }); }
  get(name) { return this.map.get(name) ?? null; }
  has(name) { return this.map.has(name); }
  entries() { return this.map.entries(); }
}
function parseDom(html) {
  const doc = new TestDocument(), root = doc.createElement('body'), stack = [root];
  doc.body = root; doc.documentElement.append(root);
  const body = html.replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/g, '').replace(/<style(?:\s[^>]*)?>[\s\S]*?<\/style>/g, '').match(/<body(?:\s[^>]*)?>([\s\S]*?)<\/body>/)[1];
  const voidTags = new Set(['input', 'meta', 'link', 'img', 'br', 'hr', 'source']);
  for (const m of body.matchAll(/<!--[\s\S]*?-->|<\/?([\w-]+)\b([^>]*)>|([^<]+)/g)) {
    if (m[0].startsWith('<!--')) continue;
    if (m[3]) { stack.at(-1).append(doc.createTextNode(decode(m[3]))); continue; }
    const tag = m[1].toLowerCase();
    if (m[0].startsWith('</')) { while (stack.length > 1 && stack.at(-1).tagName !== tag.toUpperCase()) stack.pop(); if (stack.length > 1) stack.pop(); continue; }
    const n = doc.createElement(tag);
    for (const a of m[2].matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) n.setAttribute(a[1], decode(a[2] ?? a[3] ?? a[4] ?? ''));
    stack.at(-1).append(n); if (!voidTags.has(tag) && !m[0].endsWith('/>')) stack.push(n);
  }
  return doc;
}
function appHarness(stored, additionalStorage, checkpointBackend) {
  const html = fs.readFileSync(path.join(__dirname, '../assets/index.html'), 'utf8');
  const document = parseDom(html), data = new Map(Object.entries(additionalStorage || {})), exports = [], bridgeCalls = [];
  if (stored) data.set('suike.timetable.v1', JSON.stringify(stored));
  const native = new Proxy({}, { get(target, name) {
    if (name === 'getWorkspaceCheckpoint' || name === 'persistWorkspaceCheckpoint') {
      if (!checkpointBackend) return undefined;
      return (...args) => { bridgeCalls.push({ name: String(name), args }); return checkpointBackend[name](...args); };
    }
    if (name === 'getReminderStatus') return () => JSON.stringify({ enabled: false, notificationGranted: true, exactAlarmGranted: true });
    return (...args) => { bridgeCalls.push({ name: String(name), args }); if (name === 'exportBackup') exports.push({ name: args[0], text: args[1] }); return true; };
  } });
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [Date.parse('2026-10-12T08:00:00Z')])); } static now() { return Date.parse('2026-10-12T08:00:00Z'); } }
  const globals = { console, document, Element: TestNode, HTMLElement: TestNode, Node: TestNode, Document: TestDocument, DocumentFragment: TestNode,
    Blob, FormData: TestFormData, Intl, Date: FixedDate, Promise, navigator: { clipboard: { async readText() { return ''; } } },
    location: { href: 'https://suike.local/', origin: 'https://suike.local', protocol: 'https:' },
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {}, requestAnimationFrame(fn) { fn(); return 1; },
    localStorage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k) },
    addEventListener() {}, removeEventListener() {}, matchMedia() { return { matches: false, addListener() {} }; },
    SuikeNative: native, confirm() { return false; }, alert() {}, getComputedStyle() { return {}; }
  };
  const context = vm.createContext(globals); context.window = context; context.self = context;
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  scripts.forEach((code, i) => vm.runInContext(code, context, { timeout: 10000, filename: 'packaged-product-' + i + '.js' }));
  function evaluate(code) { return vm.runInContext(code, context, { timeout: 10000 }); }
  function json(code) { return JSON.parse(evaluate('JSON.stringify(' + code + ')')); }
  return { context, document, data, exports, bridgeCalls, evaluate, json,
    getState() { return JSON.parse(data.get('suike.timetable.v1') || JSON.stringify(context.TIMETABLE_SEED)); },
    byText(text, tag = 'button') { return document.querySelectorAll(tag).find(n => n.textContent.trim() === text); },
    byId(id) { const node = document.getElementById(id); assert.ok(node, 'Missing UI #' + id); return node; },
    put(name, value) { evaluate('globalThis[' + JSON.stringify(name) + ']=JSON.parse(' + JSON.stringify(JSON.stringify(value)) + ')'); }
  };
}

// The product-specific flow tests below run only after prepare-assets.py has
// generated the product build. Reusable harness stays in this test file so the
// production app carries no test-only hook or fake browser dependencies.
const Core = require('./product-core.js');
const Model = require('../../timetable/dist/model.js');
function fixture(withCourse = false, withLedger = false) {
  const courses = withCourse ? [{ id: 'manual-math', name: '机器人课程', day: 1, start: 1, end: 2, room: 'A101', teacher: '王老师', color: 'teal', dates: ['2026-10-19', '2026-10-26', '2026-11-02'], sourceTime: '' }] : [];
  const result = { schemaVersion: 1, settings: { startMonday: '2026-08-31', totalWeeks: 26, termLabel: '2026 秋学期', coverageStart: null, coverageEnd: null, theme: 'auto' }, periods: Model.DEFAULT_PERIODS.map(p => ({ ...p })).concat([{ start: '19:00', end: '19:45' }, { start: '19:55', end: '20:40' }]), courses, appliedUpdateIds: [], importLedger: null, skipLegacyImportBaseline: true, productSettings: Core.defaults() };
  result.productSettings.profile.major = '机器人工程';
  if (withLedger) result.importLedger = { version: 1, source: { system: 'just-jwglxt', term: '2026-2027-1' }, entries: courses[0].dates.map((date, i) => ({ sourceOccurrenceId: 'source-' + i, sourceKey: 'robot', week: 8 + i, baseline: { date, name: courses[0].name, day: 1, start: 1, end: 2, room: 'A101', teacher: '王老师', sourceTime: '', timeMode: 'periods', timeNote: '' }, association: { courseId: courses[0].id, date }, tombstone: false })) };
  return result;
}
function realState(h) { return h.json('SuikeFeatures.getState()'); }
function field(root, label) { const wrap = root.querySelectorAll('label').find(n => n.querySelector('span')?.textContent === label); assert.ok(wrap, 'Missing field ' + label); return wrap.querySelector('input,select,textarea'); }
function noticeRows(h) { return h.byId('productDialog').querySelectorAll('.teaching-row'); }
async function openPreview(h, text = '机器人实验 第9-10周周六5-6节地点示例实验楼118') {
  await h.byId('noticeImport').click();
  h.byId('noticeText').value = text;
  await h.byId('productConfirm').click();
  assert.equal(h.byId('productDialogTitle').textContent, '核对通知安排');
}
async function checkNotice(h, index) { const check = h.byId('noticeConfirm' + index); check.checked = true; await check.fire('change'); }

const WORKSPACE_KEYS = ['suike.timetable.v1', 'suike.history.v1', 'suike.semesters.v1', 'suike.workspace.transaction.v1'];
function nativeCheckpointBackend(saved = null) {
  return { saved, writes: [], fail: false,
    getWorkspaceCheckpoint() { return this.saved; },
    persistWorkspaceCheckpoint(payload) { if (this.fail) return false; this.saved = payload; this.writes.push(payload); return true; }
  };
}
function checkpointFor(state, extra = {}) {
  return JSON.stringify({ version: 1, values: Object.assign(Object.fromEntries(WORKSPACE_KEYS.map(key => [key, null])), { 'suike.timetable.v1': JSON.stringify(state) }, extra) });
}

test('actual packaged product boots with real modules, feature API and tool controls', () => {
  const h = appHarness(fixture());
  assert.equal(h.context.__suikeBoot.ready, true);
  for (const name of ['SuikeProductCore', 'SuikeWorkspaceEngine', 'SuikeNoticeEngine', 'SuikeFeatures']) assert.ok(h.context[name]);
  for (const id of ['noticeImport', 'historyList', 'semesterList', 'reminderSettings', 'setupGuide']) assert.ok(h.byId(id));
  assert.equal(h.document.getElementById('pinWidget'), null);
  assert.doesNotMatch(h.byId('productFeatures').textContent, /桌面组件|小组件/);
  assert.equal(h.bridgeCalls.filter(c => c.name === 'pageReady').length, 1);
});

test('fresh-install native flag creates an empty timetable and setup stays pending', () => {
  const h = appHarness();
  assert.equal(realState(h).courses.length, 0);
  assert.equal(realState(h).productSettings.setupCompleted, false);
  assert.equal(realState(h).skipLegacyImportBaseline, true);
  assert.equal(realState(h).importLedger, null);
  assert.equal(realState(h).productSettings.reminders.enabled, false);
});

test('pasting and generating notice preview writes nothing and confirmation is individually unchecked', async () => {
  const h = appHarness(fixture()), before = realState(h), storedBefore = new Map(h.data);
  await openPreview(h);
  assert.equal(noticeRows(h).length, 2);
  assert.equal(h.byId('noticeConfirm0').checked, false);
  assert.equal(h.byId('noticeConfirm1').checked, false);
  assert.deepEqual(realState(h), before);
  assert.deepEqual(h.data, storedBefore);
  await h.byId('productConfirm').click();
  assert.match(h.byId('productError').textContent, /勾选/);
  assert.deepEqual(realState(h), before);
});

test('notice UI imports only individually confirmed rows and repeat import creates no duplicates', async () => {
  const h = appHarness(fixture());
  await openPreview(h); await checkNotice(h, 0);
  assert.match(h.byId('noticePlanSummary').textContent, /已选 1 次：新增 1/);
  await h.byId('productConfirm').click();
  assert.equal(realState(h).courses.length, 1);
  assert.deepEqual(realState(h).courses[0].dates, ['2026-10-31']);
  const imported = realState(h);
  await openPreview(h); await checkNotice(h, 0);
  assert.match(h.byId('noticePlanSummary').textContent, /新增 0，重复 1/);
  await h.byId('productConfirm').click();
  assert.deepEqual(realState(h), imported);
  assert.equal(h.json('SuikeFeatures.listHistory()').length, 1, 'No-op reimport must not inflate history');
});

test('editing a notice row withdraws its previous explicit confirmation', async () => {
  const h = appHarness(fixture()); await openPreview(h); await checkNotice(h, 0);
  const room = field(noticeRows(h)[0], '教室'); room.value = '示例实验楼207'; await room.fire('input');
  assert.equal(h.byId('noticeConfirm0').checked, false);
  assert.match(h.byId('noticePlanSummary').textContent, /已选 0/);
  await h.byId('productConfirm').click(); assert.equal(realState(h).courses.length, 0);
  await checkNotice(h, 0); await h.byId('productConfirm').click();
  assert.equal(realState(h).courses[0].room, '示例实验楼207');
});

test('notice date edits synchronize weekday and import the edited calendar date', async () => {
  const h = appHarness(fixture()); await openPreview(h);
  const date = field(noticeRows(h)[0], '日期'); date.value = '2026-11-01'; await date.fire('input');
  await checkNotice(h, 0);
  assert.match(h.byId('noticePlanSummary').textContent, /待补全 0/);
  await h.byId('productConfirm').click();
  assert.deepEqual([realState(h).courses[0].day, realState(h).courses[0].dates], [7, ['2026-11-01']]);
});

test('notice mode can change from known periods to pending without retaining stale periods', async () => {
  const h = appHarness(fixture()); await openPreview(h);
  const row = noticeRows(h)[0], mode = field(row, '时间类型'); mode.value = 'pending'; await mode.fire('change');
  const note = field(row, '待确认说明'); note.value = '下午，实际时间待确认'; await note.fire('input');
  await checkNotice(h, 0); assert.match(h.byId('noticePlanSummary').textContent, /待补全 0/);
  await h.byId('productConfirm').click();
  const course = realState(h).courses[0];
  assert.deepEqual([course.timeMode, course.start, course.end], ['pending', null, null]);
});

test('pending notice becomes confirmed periods only after the user fills explicit periods', async () => {
  const h = appHarness(fixture()); await openPreview(h, '电工实验 第12周周四5-6节下课后(第一批)地点A101');
  const row = noticeRows(h)[0], mode = field(row, '时间类型'); mode.value = 'periods'; await mode.fire('change');
  const start = field(row, '开始节次'), end = field(row, '结束节次');
  start.value = '7'; await start.fire('input'); end.value = '8'; await end.fire('input');
  await checkNotice(h, 0); assert.match(h.byId('noticePlanSummary').textContent, /待补全 0/);
  await h.byId('productConfirm').click();
  assert.deepEqual([realState(h).courses[0].start, realState(h).courses[0].end], [7, 8]);
});

test('OCR text ingress creates a review form and never imports automatically', () => {
  const h = appHarness(fixture()), before = realState(h);
  h.put('recognized', '机器人实验 第9周周六5-6节地点A101');
  assert.equal(h.evaluate('SuikeFeatures.receiveNoticeText(recognized)'), true);
  assert.equal(h.byId('noticeText').value, '机器人实验 第9周周六5-6节地点A101');
  assert.equal(h.byId('productDialogTitle').textContent, '导入实验 / 调课通知');
  assert.deepEqual(realState(h), before);
  assert.equal(h.evaluate('SuikeFeatures.receiveNoticeText("", "NO_TEXT")'), false);
  assert.deepEqual(realState(h), before);
});

test('state changes after a notice preview invalidate its import consent', async () => {
  const h = appHarness(fixture()); await openPreview(h); await checkNotice(h, 0);
  const changed = realState(h); changed.settings.theme = 'dark'; h.put('changed', changed);
  assert.equal(h.evaluate('SuikeFeatures.commitState(changed,"修改外观")'), true);
  await h.byId('productConfirm').click();
  assert.match(h.byId('productError').textContent, /课表已改变/);
  assert.deepEqual(realState(h), changed);
});

test('packaged notice preview compares actual night clock ranges and flags missing night clocks', () => {
  const input = fixture();
  input.courses = [{ id: 'night-original', timeMode: 'clock', name: '夜间课程', day: 6, start: 9, end: 10, room: 'A101', teacher: '', color: 'teal', dates: ['2026-10-31'], sourceTime: '18:00-19:00' }];
  const h = appHarness(input);
  h.evaluate('var nightDraft=SuikeFeatures.parseNotice("另一个实验 第9周周六9-10节地点A102").drafts[0]');
  assert.equal(h.evaluate('SuikeFeatures.previewNotice([Object.assign({},nightDraft,{timeMode:"clock",sourceTime:"19:00-20:00"})]).conflicts.length'), 0);
  assert.equal(h.evaluate('SuikeFeatures.previewNotice([Object.assign({},nightDraft,{timeMode:"clock",start:10,end:10,sourceTime:"18:30-20:00"})]).conflicts[0].type'), 'clock-overlap');
  assert.equal(h.evaluate('SuikeFeatures.previewNotice([Object.assign({},nightDraft,{start:11,end:12})]).conflicts[0].type'), 'time-unresolved');
});

test('clear saves a complete historical snapshot and the actual restore dialog restores it', async () => {
  const h = appHarness(fixture(true, true)), before = realState(h);
  await h.byId('clearTimetable').click(); await h.byId('confirmClearTimetable').click();
  assert.equal(realState(h).courses.length, 0); assert.equal(realState(h).importLedger, null);
  assert.equal(h.json('SuikeFeatures.listHistory()').length, 1);
  await h.byId('historyList').click(); await h.byText('恢复这一份').click();
  assert.equal(h.byId('productDialogTitle').textContent, '确认恢复历史课表');
  await h.byId('productConfirm').click();
  assert.deepEqual(realState(h), before);
  assert.equal(h.json('SuikeFeatures.listHistory()').length, 2, 'Restoration saves the cleared timetable first');
});

for (const scope of ['one', 'future', 'all']) {
  test('actual delete dialog applies ' + scope + ' scope and preserves ledger tombstones', async () => {
    const h = appHarness(fixture(true, true));
    h.evaluate('SuikeFeatures.openOccurrenceDelete("manual-math","2026-10-26")');
    h.byId('occurrenceScope').value = scope;
    await h.byId('productConfirm').click();
    const result = realState(h), expected = scope === 'one' ? ['2026-10-19', '2026-11-02'] : scope === 'future' ? ['2026-10-19'] : [];
    assert.deepEqual(result.courses.flatMap(c => c.dates), expected);
    assert.equal(result.importLedger.entries.filter(e => e.tombstone).length, 3 - expected.length);
    assert.equal(result.productSettings.profile.major, '机器人工程');
    assert.equal(h.json('SuikeFeatures.listHistory()').length, 1);
  });
  test('actual edit dialog previews then applies ' + scope + ' scope with date and ledger remapping', async () => {
    const h = appHarness(fixture(true, true)), before = realState(h);
    h.evaluate('SuikeFeatures.openOccurrenceEdit("manual-math","2026-10-26")');
    h.byId('occurrenceScope').value = scope; await h.byId('occurrenceScope').fire('input');
    const room = field(h.byId('productDialog'), '教室'); room.value = 'B202'; await room.fire('input');
    h.byId('occurrenceTargetDate').value = '2026-10-28'; await h.byId('occurrenceTargetDate').fire('input');
    await h.byId('productConfirm').click();
    assert.deepEqual(realState(h), before, 'The first action creates a preview only');
    assert.equal(h.byId('productConfirm').textContent, '确认保存');
    await h.byId('productConfirm').click();
    const result = realState(h), moved = result.courses.find(c => c.room === 'B202');
    const expected = scope === 'one' ? ['2026-10-28'] : scope === 'future' ? ['2026-10-28', '2026-11-04'] : ['2026-10-21', '2026-10-28', '2026-11-04'];
    assert.ok(moved); assert.deepEqual(moved.dates, expected); assert.equal(moved.day, 3);
    assert.equal(result.courses.flatMap(c => c.dates).length, 3);
    assert.equal(result.importLedger.entries.filter(e => e.association.courseId === moved.id).length, expected.length);
    assert.ok(result.importLedger.entries.every(e => result.courses.some(c => c.id === e.association.courseId && c.dates.includes(e.association.date))));
  });
}

test('semester creation and switching through real dialogs retain independent full timetables', async () => {
  const h = appHarness(fixture(true, true)), before = realState(h);
  await h.byId('semesterList').click(); await h.byText('新建空白学期').click();
  h.byId('semesterMonday').value = '2027-03-01'; h.byId('semesterName').value = '2027 春学期'; h.byId('semesterWeeks').value = '20';
  await h.byId('productConfirm').click();
  const next = realState(h);
  assert.equal(next.settings.termLabel, '2027 春学期'); assert.equal(next.settings.startMonday, '2027-03-01');
  assert.equal(next.courses.length, 0); assert.equal(next.importLedger, null); assert.equal(next.skipLegacyImportBaseline, true);
  assert.equal(next.productSettings.profile.major, '机器人工程');
  assert.equal(h.json('SuikeFeatures.listSemesters()').length, 2);
  await h.byId('semesterList').click(); await h.byText('切换到此学期').click();
  assert.equal(h.byId('productDialogTitle').textContent, '确认切换学期');
  await h.byId('productConfirm').click();
  assert.deepEqual(realState(h), before);
  assert.equal(h.data.has('suike.workspace.transaction.v1'), false, 'Completed switch cleans up its recovery journal');
});

test('setup profile and reminder preferences survive ordinary edits and backups', async () => {
  const h = appHarness(fixture(true));
  await h.byId('setupGuide').click(); h.byId('setupClass').value = '2'; h.byId('setupBatch').value = '3'; h.byId('setupMajor').value = '机器人工程';
  await h.byId('productConfirm').click();
  assert.deepEqual([realState(h).productSettings.profile.classNumber, realState(h).productSettings.profile.batchNumber], [2, 3]);
  await h.byId('reminderSettings').click(); h.byId('remindersEnabled').checked = true; h.byId('reminderLead').value = '15';
  await h.byId('productConfirm').click();
  assert.deepEqual([realState(h).productSettings.reminders.enabled, realState(h).productSettings.reminders.leadMinutes], [true, 15]);
  assert.ok(h.bridgeCalls.some(c => c.name === 'requestReminderPermission'));
  const syncs = h.bridgeCalls.filter(c => c.name === 'syncFeatures');
  assert.equal(JSON.parse(syncs.at(-1).args[0]).enabled, true);
  await h.byId('exportData').click();
  assert.deepEqual(JSON.parse(h.exports.at(-1).text).productSettings, realState(h).productSettings);
});

test('fresh setup survives an immediate new VM with the pre-save WebView mirror', async () => {
  const native = nativeCheckpointBackend(), first = appHarness(undefined, undefined, native);
  const staleMirror = Object.fromEntries(first.data);
  assert.equal(realState(first).courses.length, 0);
  assert.equal(realState(first).productSettings.setupCompleted, false);
  await first.byId('setupGuide').click();
  first.byId('setupMonday').value = '2026-08-31';
  first.byId('setupMajor').value = '机器人工程';
  first.byId('setupClass').value = '1'; first.byId('setupBatch').value = '1';
  await first.byId('productConfirm').click();
  const saved = realState(first);
  assert.equal(saved.productSettings.setupCompleted, true);
  assert.deepEqual([saved.settings.startMonday, saved.productSettings.profile.major, saved.productSettings.profile.classNumber, saved.productSettings.profile.batchNumber], ['2026-08-31', '机器人工程', 1, 1]);
  assert.equal(saved.courses.length, 0); assert.equal(saved.skipLegacyImportBaseline, true);
  assert.equal(JSON.parse(JSON.parse(native.saved).values['suike.timetable.v1']).productSettings.setupCompleted, true);
  const writesBeforeRestart = native.writes.length;
  const restarted = appHarness(undefined, staleMirror, native);
  assert.deepEqual(realState(restarted), saved, 'Synchronous native checkpoint survives without any timeout or WebView storage flush');
  assert.deepEqual(JSON.parse(restarted.data.get('suike.timetable.v1')), saved);
  assert.equal(restarted.json('SuikeFeatures.listHistory()').length, 1);
  assert.equal(native.writes.length, writesBeforeRestart, 'Reading a checkpoint does not re-save it');
});

test('a Java bridge JSON null sentinel boots a blank fresh timetable and establishes a native checkpoint', () => {
  const native = nativeCheckpointBackend('null'), h = appHarness(undefined, undefined, native);
  assert.equal(h.context.__suikeBoot.ready, true);
  const saved = realState(h);
  assert.equal(saved.courses.length, 0); assert.equal(saved.skipLegacyImportBaseline, true);
  assert.equal(saved.productSettings.setupCompleted, false);
  assert.equal(native.writes.length, 1, 'Blank first-install state is confirmed synchronously before boot succeeds');
  assert.deepEqual(JSON.parse(JSON.parse(native.saved).values['suike.timetable.v1']), saved);
  const restarted = appHarness(undefined, undefined, native);
  assert.deepEqual(realState(restarted), saved);
  assert.equal(native.writes.length, 1);
});

test('an empty native timetable overrides a stale mirror that still contains old courses', () => {
  const saved = fixture(), stale = fixture(true, true);
  saved.productSettings.setupCompleted = true;
  const native = nativeCheckpointBackend(checkpointFor(saved));
  const h = appHarness(stale, { 'suike.history.v1': 'stale-history', 'unrelated.key': 'keep' }, native);
  assert.deepEqual(realState(h), saved);
  assert.equal(h.data.has('suike.history.v1'), false);
  assert.equal(h.data.get('unrelated.key'), 'keep');
  assert.equal(native.writes.length, 0);
});

for (const kind of ['malformed', 'missing-key', 'read-error', 'undefined-response']) {
  test('checkpoint ' + kind + ' stops packaged startup without overwriting any mirror value', () => {
    const original = fixture(true, true), extras = { 'suike.history.v1': 'preserve-history', 'suike.semesters.v1': 'preserve-semesters', 'unrelated.key': 'keep' };
    const native = nativeCheckpointBackend(kind === 'malformed' ? '{' : JSON.stringify({ version: 1, values: { 'suike.timetable.v1': JSON.stringify(fixture()) } }));
    if (kind === 'read-error') native.getWorkspaceCheckpoint = () => { throw Error('checkpoint read failed'); };
    if (kind === 'undefined-response') native.saved = undefined;
    const h = appHarness(original, extras, native);
    assert.equal(h.context.__suikeBoot.ready, false);
    assert.equal(h.context.__suikeBoot.error.kind, 'init', 'The native startup probe immediately sees a handled recovery failure');
    assert.deepEqual(Object.keys(h.context.__suikeBoot.error).sort(), ['column', 'directive', 'kind', 'line', 'name', 'script'], 'Diagnostics contain fixed metadata and never the exception message or stack');
    assert.equal(JSON.stringify(h.context.__suikeBoot.error).includes('checkpoint read failed'), false);
    assert.equal(h.context.SuikeFeatures, undefined);
    assert.match(h.byId('agenda').textContent, /本地保存未能恢复/);
    assert.equal(h.byId('statusLine').textContent, '未覆盖本地课表');
    assert.deepEqual(Object.fromEntries(h.data), { ...extras, 'suike.timetable.v1': JSON.stringify(original) });
    assert.equal(native.writes.length, 0);
    assert.equal(h.bridgeCalls.filter(c => c.name === 'pageReady').length, 0);
  });
}

test('a refused native checkpoint keeps the visible timetable and raw old main key', () => {
  const input = fixture(true, true), native = nativeCheckpointBackend(checkpointFor(input));
  const h = appHarness(input, undefined, native), before = realState(h), rawBefore = h.data.get('suike.timetable.v1'), savedBefore = native.saved;
  native.fail = true;
  const next = structuredClone(before); next.settings.theme = 'dark'; h.put('nextCheckpointState', next);
  assert.equal(h.evaluate('SuikeFeatures.commitState(nextCheckpointState,"修改外观")'), false);
  assert.deepEqual(realState(h), before);
  assert.equal(h.data.get('suike.timetable.v1'), rawBefore);
  assert.equal(native.saved, savedBefore);
  assert.match(h.byId('toast').textContent, /未能保存|持久化保存未完成|保存结果未能确认/);
  const attempts = h.bridgeCalls.filter(call => call.name === 'persistWorkspaceCheckpoint').length;
  native.fail = false;
  assert.equal(h.evaluate('SuikeFeatures.commitState(nextCheckpointState,"再次保存")'), false);
  assert.equal(h.bridgeCalls.filter(call => call.name === 'persistWorkspaceCheckpoint').length, attempts, 'The failed page cannot overwrite an uncertain native result on retry');
  assert.deepEqual(realState(h), before);
});

test('native state remains durable when the WebView mirror rejects all writes', () => {
  const input = fixture(), native = nativeCheckpointBackend(checkpointFor(input)), h = appHarness(input, undefined, native);
  const staleMirror = Object.fromEntries(h.data), next = realState(h); next.settings.theme = 'dark';
  h.context.localStorage.setItem = () => { throw Error('QuotaExceededError'); };
  h.context.localStorage.removeItem = () => { throw Error('QuotaExceededError'); };
  h.put('nextCheckpointState', next);
  assert.equal(h.evaluate('SuikeFeatures.commitState(nextCheckpointState,"修改外观")'), true);
  assert.deepEqual(realState(h), next);
  assert.deepEqual(Object.fromEntries(h.data), staleMirror);
  const restarted = appHarness(undefined, staleMirror, native);
  assert.deepEqual(realState(restarted), next);
  assert.deepEqual(JSON.parse(restarted.data.get('suike.timetable.v1')), next);
  assert.equal(restarted.json('SuikeFeatures.listHistory()').length, 1);
});

for (const invalidState of ['{', JSON.stringify({ schemaVersion: 1, courses: [] })]) {
  test('invalid inner checkpoint timetable stops startup before adopting or saving a baseline: ' + invalidState.slice(0, 24), () => {
    const native = nativeCheckpointBackend(checkpointFor(fixture(), { 'suike.timetable.v1': invalidState }));
    const h = appHarness(fixture(true, true), undefined, native);
    assert.equal(h.context.__suikeBoot.ready, false);
    assert.equal(h.context.SuikeFeatures, undefined);
    assert.match(h.byId('statusLine').textContent, /未覆盖本地课表|未修改任何本地数据|本地载入未完成，请重新打开后检查/);
    assert.equal(h.data.get('suike.timetable.v1'), JSON.stringify(fixture(true, true)), 'The unmodified legacy mirror remains available for manual rescue');
    assert.equal(native.writes.length, 0);
    assert.equal(JSON.parse(native.saved).values['suike.timetable.v1'], invalidState);
    assert.equal(h.bridgeCalls.filter(c => c.name === 'pageReady').length, 0);
  });
}

for (const archiveKey of ['suike.history.v1', 'suike.semesters.v1', 'suike.workspace.transaction.v1']) {
  test('invalid inner ' + archiveKey + ' stops startup and preserves all rescue mirror values', () => {
    const original = fixture(true, true), extras = { 'suike.history.v1': 'rescue-history', 'suike.semesters.v1': 'rescue-semesters', 'unrelated.key': 'keep' };
    const native = nativeCheckpointBackend(checkpointFor(fixture(), { [archiveKey]: '{' }));
    const h = appHarness(original, extras, native);
    assert.equal(h.context.__suikeBoot.ready, false);
    assert.equal(h.context.SuikeFeatures, undefined);
    assert.match(h.byId('statusLine').textContent, /未覆盖本地课表|未修改任何本地数据|本地载入未完成，请重新打开后检查/);
    assert.deepEqual(Object.fromEntries(h.data), { ...extras, 'suike.timetable.v1': JSON.stringify(original) });
    assert.equal(native.writes.length, 0);
    assert.equal(JSON.parse(native.saved).values[archiveKey], '{');
  });
}
