// Source-level tests with explicit native mocks. These do not compile ArkUI or emulate HarmonyOS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.env.HARMONY_TYPESCRIPT || path.resolve(__dirname, '../../../harmony-tools/hvigor-6.0.6/node_modules/@ohos/hvigor/node_modules/typescript'));
const project = path.resolve(__dirname, '..');
function load(relative, native = {}) {
  const source = fs.readFileSync(path.join(project, relative), 'utf8').replace(/^import[\s\S]*?;\s*$/gm, '');
  const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
  assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, relative + ' syntax');
  const context = { exports: {}, ...native };
  vm.runInNewContext(result.outputText, context, { filename: relative });
  return context.exports;
}
const policy = load('entry/src/main/ets/domain/PortalPolicy.ts');
const registry = fs.readFileSync(path.join(project, 'entry/src/main/resources/rawfile/schools.json'), 'utf8');
const profiles = Object.fromEntries(['just', 'hhu', 'njust'].map(id => [id, policy.schoolFromRegistry(registry, id)]));
const fixtures = require('../reference/work/portal-import/tests/fixtures.cjs');
const justCapture = () => ({ source: 'just-jwglxt-table', adapterVersion: 1, term: { year: '2026-2027', semester: '1' }, rows: [{ cell: '1-1', name: '合成课程', lines: ['1-16周', '测试楼', '测试教师', '合成编号'], selected: true }], unscheduledPresent: false });
const copy = value => JSON.parse(JSON.stringify(value));

test('selected-school HTTPS policy rejects spoofed hosts, credentials, ports and other schools', () => {
  assert.equal(policy.allowedPortalUrl(profiles.just, 'https://ids.v.just.edu.cn/'), true);
  assert.equal(policy.allowedPortalUrl(profiles.just, 'HTTPS://IDS.V.JUST.EDU.CN:443/?x=1'), true);
  for (const url of ['http://ids.v.just.edu.cn/', 'https://ids.v.just.edu.cn.evil.test/', 'https://evil.test@ids.v.just.edu.cn/', 'https://ids.v.just.edu.cn:444/', 'https://ids.v.just.edu.cn:0443/', 'https://ids.v.just.edu.cn./', 'https://ids.v.just.edu.cn\\@evil.test/', 'https://ids.v.just.edu.cn/\n', 'https://my.hhu.edu.cn/', 'file:///index.html', 'javascript:alert(1)', 'https://ids%2ev%2ejust.edu.cn/']) {
    assert.equal(policy.allowedPortalUrl(profiles.just, url), false, url);
  }
});
test('capture paths require the fixed school path and a bounded WebVPN mapping token', () => {
  assert.equal(policy.capturePageUrl(profiles.just, 'https://client.v.just.edu.cn/http/a_B-123/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?x=1'), true);
  assert.equal(policy.capturePageUrl(profiles.hhu, 'https://jwxt.hhu.edu.cn/jsxsd/xskb/xskb_list.do'), true);
  for (const url of ['https://client.v.just.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html', 'https://client.v.just.edu.cn/http//jwglxt/kbcx/xskbcx_cxXskbcxIndex.html', 'https://client.v.just.edu.cn/http/a/b/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html', 'https://client.v.just.edu.cn/http/%61/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html', 'https://client.v.just.edu.cn/http/' + 'a'.repeat(257) + '/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html']) {
    assert.equal(policy.capturePageUrl(profiles.just, url), false);
  }
});
test('all bundled protocols accept their synthetic fixtures and reject school/version mismatch', () => {
  for (const [profile, capture] of [[profiles.just, justCapture()], [profiles.hhu, fixtures.hhu()], [profiles.njust, fixtures.njust()]]) {
    assert.equal(policy.parseCapture(JSON.stringify(capture), profile).source, capture.source);
    assert.equal(policy.decodeCollectorEvaluation(JSON.stringify(JSON.stringify(capture)), profile).source, capture.source);
    assert.throws(() => policy.decodeCollectorEvaluation(JSON.stringify(capture), profile));
    const wrongVersion = copy(capture); wrongVersion.adapterVersion = 2;
    assert.throws(() => policy.parseCapture(JSON.stringify(wrongVersion), profile));
  }
  assert.throws(() => policy.parseCapture(JSON.stringify(fixtures.hhu()), profiles.njust));
});
test('capture allowlists reject identity fields, nested additions, controls and oversized arrays', () => {
  const mutations = [v => { v.cookie = 'forbidden'; }, v => { v.term.studentId = 'forbidden'; }, v => { v.rows[0].password = 'forbidden'; }, v => { v.rows[0].lines[0] = 'bad\nline'; }, v => { v.rows[0].selected = 'true'; }, v => { v.rows = Array.from({ length: 501 }, () => copy(v.rows[0])); }, v => { v.rows[0].cell = '8-1'; }, v => { v.rows[0].name = '课'.repeat(81); }];
  for (const mutate of mutations) { const value = justCapture(); mutate(value); assert.throws(() => policy.parseCapture(JSON.stringify(value), profiles.just)); }
  const rows500 = justCapture(); rows500.rows = Array.from({ length: 500 }, () => copy(rows500.rows[0]));
  assert.equal(policy.parseCapture(JSON.stringify(rows500), profiles.just).rows.length, 500);
  const huge = JSON.stringify({ ...justCapture(), padding: '课'.repeat(180000) });
  assert.ok(huge.length < policy.MAX_CAPTURE_BYTES && Buffer.byteLength(huge) > policy.MAX_CAPTURE_BYTES);
  assert.throws(() => policy.parseCapture(huge, profiles.just));
  assert.equal(policy.utf8Bytes('A课😀'), Buffer.byteLength('A课😀'));
});
test('period/group contracts reject overlaps, gaps, bad clocks and unrecognized errors', () => {
  const value = fixtures.hhu(); value.periodGroups[1].start = '09:00';
  assert.throws(() => policy.parseCapture(JSON.stringify(value), profiles.hhu));
  const gap = fixtures.hhu(); gap.periodGroups[1].first = 4;
  assert.throws(() => policy.parseCapture(JSON.stringify(gap), profiles.hhu));
  const missing = fixtures.hhu(); missing.periodGroups = [];
  assert.throws(() => policy.parseCapture(JSON.stringify(missing), profiles.hhu));
  const periods = justCapture(); periods.periods = [{ period: 1, start: '08:00', end: '08:45' }, { period: 2, start: '08:30', end: '09:15' }];
  assert.throws(() => policy.parseCapture(JSON.stringify(periods), profiles.just));
  assert.throws(() => policy.parseCapture(JSON.stringify({ source: profiles.just.captureSource, adapterVersion: 1, error: 'unknown' }), profiles.just));
});

function nativeEnvironment(options = {}) {
  let currentUrl = 'resource://RAWFILE/index.html', callingUrl = currentUrl, saved = 'null', rejectWrite = false, failExport = false;
  const messages = [], exported = [], webReplies = [], stores = new Map(), kept = [], notices = [], documentCalls = [];
  const selectedBytes = options.bytes || Buffer.from([137,80,78,71,13,10,26,10,0]);
  let todayOpened = 0;
  const webContext = { window: { SuikeDeepSeek: { receive: (id, result) => webReplies.push({ id, result }), receiveDocument: (id, result) => webReplies.push({ id, result }) }, SuikeFeatures: { nativeStatus() {}, openToday() { todayOpened++; }, receiveNoticeText: (text, error) => notices.push({ text, error }) } } };
  const controller = { getUrl: () => currentUrl, getLastJavascriptProxyCallingFrameUrl: () => callingUrl, runJavaScript: script => Promise.resolve(JSON.stringify(vm.runInNewContext(script, webContext)) || 'null') };
  const appStorage = { get: key => stores.get(key), delete: key => stores.delete(key), set: (key, value) => stores.set(key, value) };
  let pickerCalls = 0, readCalls = 0, resolveSelect;
  const picker = { DocumentSaveOptions: class {}, DocumentSelectOptions: class {}, DocumentViewPicker: class { save() { pickerCalls++; return Promise.resolve(['file://chosen']); } select() { return new Promise(resolve => { resolveSelect = resolve; }); } } };
  const hostModule = load('entry/src/main/ets/services/BridgeHost.ets', { AppStorage: appStorage, picker, promptAction: { showToast: ({ message }) => messages.push(message) } });
  const host = new hostModule.BridgeHost(controller); host.attach({ filesDir: '/sandbox', cacheDir: '/sandbox/cache' }, () => {});
  const mocks = {
    AppStorage: appStorage,
    AtomicStore: class { checkpoint() { return saved; } persistCheckpoint(value) { if (rejectWrite) return false; saved = value; return true; } },
    KeyVault: class { config() { return '{"ok":true,"configured":false}'; } save() { return '{"ok":true}'; } clear() { return '{"ok":true}'; } },
    DeepSeekService: class { cancel() {} clearAttachments() {} keep(id, parts) { kept.push({id, parts}); } start(id, action, payload, reply) { reply(id, JSON.stringify({ ok: true, result: { text: '\");globalThis.compromised=true;//' } })); return Promise.resolve(); } },
    NativeDocuments: class {
      recognizeImage(bytes, cancelled) { documentCalls.push({kind: 'ocr', bytes: Array.from(bytes), cancelled}); return options.recognizeImage ? options.recognizeImage(bytes, cancelled) : Promise.resolve('合成通知'); }
      pdfParts(bytes, cacheDir, cancelled) { documentCalls.push({kind: 'pdf', bytes: Array.from(bytes), cacheDir, cancelled}); return options.pdfParts ? options.pdfParts(bytes, cacheDir, cancelled) : Promise.resolve([{type:'text', text:'PDF 第 1 页'}, {type:'image_url', image_url:{url:'data:image/jpeg;base64,AA=='}}]); }
    },
    FeatureService: class { sync() { return true; } appearance() { return true; } refresh() { return Promise.resolve(); } status() { return '{"ok":true}'; } requestPermission() {} dispose() {} },
    util: { TextEncoder: class { encodeInto(value) { return new TextEncoder().encode(value); } }, Base64Helper: class { encodeToStringSync(bytes) { return Buffer.from(bytes).toString('base64'); } } },
    fs: { OpenMode: { CREATE: 1, WRITE_ONLY: 2, TRUNC: 4, READ_ONLY: 0 }, openSync(uri, mode) { return { fd: mode === 0 ? 8 : 7 }; }, writeSync(fd, buffer) { if (failExport) throw new Error('disk full'); const bytes = new Uint8Array(buffer), count = Math.min(3, bytes.length); exported.push(...bytes.subarray(0, count)); return count; }, statSync(fd) { return { size: fd === 8 ? selectedBytes.length : exported.length }; }, fsyncSync() {}, closeSync() {}, readSync(fd, buffer, readOptions) { readCalls++; const count = Math.min(3, readOptions.length); new Uint8Array(buffer).set(selectedBytes.subarray(readOptions.offset, readOptions.offset + count)); return count; } },
    vibrator: { startVibration: () => Promise.resolve() }, picker
  };
  const bridgeModule = load('entry/src/main/ets/services/LocalBridge.ets', mocks);
  const bridge = new bridgeModule.LocalBridge(host); bridge.initialize({ filesDir: '/sandbox' });
  return { host, bridge, hostModule, messages, exported, webReplies, webContext, stores, kept, notices, documentCalls, todayOpened: () => todayOpened, methods: bridgeModule.LOCAL_BRIDGE_METHODS, setCaller: value => { callingUrl = value; }, setDocument: value => { currentUrl = value; }, rejectWrites: () => { rejectWrite = true; }, failExport: () => { failExport = true; }, resolveSelect: value => resolveSelect(value), pickerCalls: () => pickerCalls, readCalls: () => readCalls };
}
const settled = () => new Promise(resolve => setImmediate(resolve));
test('native bridge requires both the bundled top document and bundled calling frame', () => {
  const env = nativeEnvironment();
  assert.equal(env.host.trustedCall(), true);
  env.setCaller('https://jwxt.just.edu.cn/');
  assert.throws(() => env.bridge.getDeepSeekConfig(), /LOCAL_PAGE_REQUIRED/);
  assert.throws(() => env.bridge.persistWorkspaceCheckpoint('{}'), /LOCAL_PAGE_REQUIRED/);
  env.setCaller('resource://RAWFILE/index.html'); env.setDocument('https://jwxt.just.edu.cn/');
  assert.equal(env.host.trustedCall(), false);
  for (const url of ['resource://RAWFILE/index.html.evil', 'resource://RAWFILE/index.html/other', 'https://rawfile/index.html', 'file:///index.html']) assert.equal(env.hostModule.isTrustedIndexUrl(url), false);
});
test('checkpoint writes preserve data and propagate native storage failure', () => {
  const env = nativeEnvironment();
  assert.equal(env.bridge.isFreshInstall(), true);
  const payload = '{"version":1,"values":{"course":"测试"}}';
  assert.equal(env.bridge.persistWorkspaceCheckpoint(payload), true);
  assert.equal(env.bridge.getWorkspaceCheckpoint(), payload);
  assert.equal(env.bridge.isFreshInstall(), false);
  env.rejectWrites();
  assert.equal(env.bridge.persistWorkspaceCheckpoint('different'), false);
  assert.equal(env.bridge.getWorkspaceCheckpoint(), payload);
});
test('card launches open Today once when a trusted main document is ready', async () => {
  const env = nativeEnvironment(); env.stores.set('suike.widget.launch', true);
  env.host.deliverWidgetLaunch(); assert.equal(env.todayOpened(), 0);
  env.host.pageReady(); env.host.deliverWidgetLaunch(); await settled();
  assert.equal(env.todayOpened(), 1); assert.equal(env.stores.get('suike.widget.launch'), false);
  env.host.deliverWidgetLaunch(); await settled(); assert.equal(env.todayOpened(), 1);
});
test('export accepts a picker operation, handles short writes and reports failures without a saved toast', async () => {
  const env = nativeEnvironment(), content = JSON.stringify({ course: '合成课程' });
  assert.equal(env.bridge.exportBackup('备份.json', 'invalid'), false);
  assert.equal(env.pickerCalls(), 0);
  assert.equal(env.bridge.exportBackup('备份.json', content), true);
  await settled();
  assert.equal(Buffer.from(env.exported).toString('utf8'), content);
  assert.ok(env.messages.some(message => message.includes('备份已保存')));
  const failed = nativeEnvironment(); failed.failExport();
  failed.bridge.exportBackup('备份.json', content); await settled();
  assert.ok(failed.messages.some(message => message.includes('未能保存')));
  assert.equal(failed.messages.some(message => message.includes('备份已保存')), false);
});
test('AI callback data stays data and cancelled document selection does not read or store a file', async () => {
  const env = nativeEnvironment();
  assert.equal(env.bridge.requestDeepSeek('ds-1', 'parse', '{}'), true);
  await settled();
  assert.equal(env.webContext.compromised, undefined);
  assert.equal(env.webReplies.length, 1);
  assert.match(env.webReplies[0].result.result.text, /compromised/);
  assert.equal(env.bridge.pickDeepSeekDocument('file-1'), true);
  env.bridge.cancelDeepSeekDocument(); env.resolveSelect(['file://anything.png']);
  await settled();
  assert.equal(env.readCalls(), 0);
  assert.equal(env.webReplies.length, 1);
});

test('screenshot cancellation suppresses picker reads and late OCR callbacks', async () => {
  const cancelledPicker = nativeEnvironment();
  assert.equal(cancelledPicker.bridge.chooseNoticeScreenshot(), true);
  cancelledPicker.bridge.cancelNoticeScreenshot(); cancelledPicker.resolveSelect(['file://notice.png']);
  await settled();
  assert.equal(cancelledPicker.readCalls(), 0); assert.equal(cancelledPicker.notices.length, 0);
  let resolveOcr;
  const active = nativeEnvironment({recognizeImage: () => new Promise(resolve => { resolveOcr = resolve; })});
  active.bridge.chooseNoticeScreenshot(); active.resolveSelect(['file://notice.png']); await settled();
  assert.equal(active.documentCalls.length, 1);
  active.bridge.cancelNoticeScreenshot(); resolveOcr('迟到的合成通知'); await settled();
  assert.equal(active.documentCalls[0].cancelled(), true); assert.equal(active.notices.length, 0);
  const success = nativeEnvironment(); success.bridge.chooseNoticeScreenshot(); success.resolveSelect(['file://notice.png']); await settled();
  assert.deepEqual(JSON.parse(JSON.stringify(success.notices)), [{text:'合成通知', error:'none'}]);
});

test('PDF pages enter the existing AI attachment path without committing courses or auto-sending', async () => {
  const env = nativeEnvironment({bytes: Buffer.from('%PDF-1.7\n synthetic fixture')});
  assert.equal(env.bridge.pickDeepSeekDocument('pdf-1'), true); env.resolveSelect(['file://课表.pdf']); await settled();
  assert.equal(env.documentCalls[0].kind, 'pdf'); assert.equal(env.documentCalls[0].cacheDir, '/sandbox/cache');
  assert.equal(env.kept.length, 1); assert.equal(env.kept[0].parts.length, 2);
  assert.equal(env.webReplies.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(env.webReplies[0])), {id:'pdf-1', result:{name:'课表.pdf', attachmentId:'pdf-1', error:'none'}});
  assert.equal(env.bridge.getWorkspaceCheckpoint(), 'null');
  let resolvePdf;
  const cancelled = nativeEnvironment({bytes:Buffer.from('%PDF-1.7\n fixture'), pdfParts: () => new Promise(resolve => { resolvePdf = resolve; })});
  cancelled.bridge.pickDeepSeekDocument('pdf-cancel'); cancelled.resolveSelect(['file://课表.pdf']); await settled();
  cancelled.bridge.cancelDeepSeekDocument(); resolvePdf([{type:'text',text:'迟到页'}]); await settled();
  assert.equal(cancelled.kept.length, 0); assert.equal(cancelled.webReplies.length, 0);
});

test('destroyed or untrusted documents discard pending file results before reading', async () => {
  for (const retire of [env => env.bridge.dispose(), env => env.host.deactivate(), env => env.setDocument('https://jwxt.just.edu.cn/')]) {
    const env = nativeEnvironment(); env.bridge.pickDeepSeekDocument('file-retired'); retire(env); env.resolveSelect(['file://notice.png']); await settled();
    assert.equal(env.readCalls(), 0); assert.equal(env.kept.length, 0); assert.equal(env.webReplies.length, 0);
    const notice = nativeEnvironment(); notice.bridge.chooseNoticeScreenshot(); retire(notice); notice.resolveSelect(['file://notice.png']); await settled();
    assert.equal(notice.readCalls(), 0); assert.equal(notice.notices.length, 0);
  }
});

test('system JSON restore picker returns one selected URI only to the active local document', async () => {
  const env = nativeEnvironment(); let selected;
  env.host.selectBackupInput(uris => { selected = uris; }); env.resolveSelect(['file://backup.json','file://other.json']); await settled();
  assert.deepEqual(Array.from(selected), ['file://backup.json']); assert.equal(env.bridge.getWorkspaceCheckpoint(), 'null');
  env.host.selectBackupInput(uris => { selected = uris; }); env.host.deactivate(); env.resolveSelect(['file://backup.json']); await settled();
  assert.deepEqual(Array.from(selected), []);
});

test('closing or replacing the notice dialog prevents a late OCR result from reopening it', () => {
  const html = fs.readFileSync(path.join(project, 'entry/src/main/resources/rawfile/index.html'), 'utf8');
  const receive = html.slice(html.indexOf('    receiveNoticeText: (text, error) => {'), html.indexOf('    getState: () => clone(state),')).trim().replace(/^receiveNoticeText:\s*/, '').replace(/,$/,'');
  const cancel = html.slice(html.indexOf('  function cancelPendingNoticeScreenshot() {'), html.indexOf('  function productOpen(title, action, options) {'));
  const closing = html.slice(html.indexOf('  function closeDialog(dialog) {'), html.indexOf('  function armDialogCancel(dialog) {'));
  let opened = 0, cancelled = 0;
  const field = {value:''}, dialog = {id:'productDialog', open:true, contains: value => value === field, classList:{contains: () => false, add() {}, remove() {}}, close() {this.open=false;}};
  const ctx = {productDialog:dialog, noticeTextField:field, nativeCall: name => {assert.equal(name,'cancelNoticeScreenshot');cancelled++;}, showToast() {}, openNoticeImport() {opened++;}, window:{matchMedia:()=>({matches:true})}, setTimeout};
  const run = vm.runInNewContext(cancel + closing + ';({receive:' + receive + ',closeDialog,cancelPendingNoticeScreenshot})', ctx);
  assert.equal(run.receive('可用通知','none'), true); assert.equal(field.value,'可用通知');
  run.closeDialog(dialog); assert.equal(cancelled,1); assert.equal(run.receive('迟到通知','none'), false); assert.equal(opened,0);
  dialog.open=true; ctx.noticeTextField=field; run.cancelPendingNoticeScreenshot();
  assert.equal(run.receive('切换工具后的通知','none'), false); assert.equal(opened,0);
});

test('portal cleanup and late page callbacks never mutate retired ArkUI state', () => {
  let source = fs.readFileSync(path.join(project, 'entry/src/main/ets/pages/Portal.ets'), 'utf8');
  source = source.slice(0, source.indexOf('  build() {')) + '}\n';
  source = source.replace(/^import[\s\S]*?;\s*$/gm,'').replace(/^@Entry\s*$/gm,'').replace(/^@Component\s*$/gm,'').replace(/struct Portal/, 'export class Portal').replace(/@State\s*/g,'');
  const result = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}});
  const context = {exports:{}, clearTimeout(){}, webview:{WebviewController:class {stop() {}}}};
  vm.runInNewContext(result.outputText, context);
  const portal = new context.exports.Portal(); portal.aboutToDisappear();
  for (const name of ['status','busy','canRead','originLabel']) Object.defineProperty(portal,name,{set(){throw new Error('retired state write: '+name);},get(){return false;},configurable:true});
  assert.doesNotThrow(()=>{portal.cancelCapture();portal.pageStarted('https://invalid.test/');portal.pageFinished('https://invalid.test/');portal.reopenEntry();portal.rejectNavigation();});
  assert.equal(portal.allowNavigation('https://invalid.test/'), false);
});
