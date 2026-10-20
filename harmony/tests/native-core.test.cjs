// Native API behavior mocks; real SDK compilation and device checks are separate.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.env.HARMONY_TYPESCRIPT || path.resolve(__dirname, '../../../harmony-tools/hvigor-6.0.6/node_modules/@ohos/hvigor/node_modules/typescript'));
function load(file, mocks = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^import[\s\S]*?;\s*$/gm, '');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } });
  const context = { exports: {}, ...mocks };
  vm.runInNewContext(compiled.outputText, context, { filename: file });
  return context.exports;
}
const rules = load('entry/src/main/ets/domain/Rules.ts');
const checkpoint = () => JSON.stringify({ version: 1, values: Object.fromEntries(rules.WORKSPACE_KEYS.map(key => [key, key === 'suike.timetable.v1' ? '{"title":"合成课表"}' : null])) });
function disk() {
  const files = new Map(), handles = new Map(); let serial = 0, fail = '', closes = 0;
  const native = {
    OpenMode: { CREATE: 1, READ_WRITE: 2, TRUNC: 4 },
    accessSync: p => files.has(p),
    statSync: p => ({ size: files.get(typeof p === 'number' ? handles.get(p).path : p).length }),
    readTextSync: p => files.get(p).toString('utf8'),
    openSync(p) { files.set(p, Buffer.alloc(0)); handles.set(++serial, { path: p, offset: 0 }); return { fd: serial }; },
    writeSync(fd, data) { if (fail === 'write') throw new Error('DISK_FULL'); if (fail === 'zero') return 0; const h = handles.get(fd), bytes = Buffer.from(data), n = Math.min(7, bytes.length); files.set(h.path, Buffer.concat([files.get(h.path), bytes.subarray(0, n)])); h.offset += n; return n; },
    fsyncSync() { if (fail === 'sync') throw new Error('SYNC_FAILED'); },
    closeSync(fd) { closes++; handles.delete(fd); if (fail === 'close') throw new Error('CLOSE_FAILED'); },
    renameSync(from, to) { if (fail === 'rename') throw new Error('RENAME_FAILED'); files.set(to, files.get(from)); files.delete(from); },
    unlinkSync: p => files.delete(p)
  };
  const util = { TextEncoder: class { encodeInto(text) { return new TextEncoder().encode(text); } } };
  const { AtomicStore } = load('entry/src/main/ets/services/AtomicStore.ets', { fs: native, util, validCheckpoint: rules.validCheckpoint });
  return { store: new AtomicStore('/sandbox'), files, fail: value => { fail = value; }, closes: () => closes };
}
test('atomic checkpoint validates the complete workspace, handles short writes, and keeps UTF-8 intact', () => {
  const d = disk(), text = checkpoint();
  assert.equal(d.store.checkpoint(), 'null');
  assert.equal(d.store.persistCheckpoint(text), true);
  assert.equal(d.store.checkpoint(), text);
  assert.equal(d.files.has('/sandbox/workspace.json.pending'), false);
  for (const bad of ['null', '{}', '{"version":1,"values":{}}', text.replace('"version":1', '"version":2'), text.replace('null', '42')]) assert.equal(d.store.persistCheckpoint(bad), false);
  assert.equal(d.store.checkpoint(), text);
  assert.throws(() => d.store.read('../outside.json'), /STORE_NAME_INVALID/);
});
test('disk, fsync, close, and rename failures never replace the prior checkpoint or leak pending files', () => {
  for (const failure of ['write', 'zero', 'sync', 'close', 'rename']) {
    const d = disk(), original = checkpoint(); assert.equal(d.store.persistCheckpoint(original), true);
    d.fail(failure); assert.equal(d.store.persistCheckpoint(original.replace('合成', '修改')), false, failure);
    assert.equal(d.store.checkpoint(), original, failure);
    assert.equal(d.files.has('/sandbox/workspace.json.pending'), false, failure);
  }
});
test('invalid or oversized persisted checkpoint fails closed without erasing it', () => {
  const d = disk(); d.files.set('/sandbox/workspace.json', Buffer.from('{broken'));
  assert.throws(() => d.store.checkpoint(), /CHECKPOINT_INVALID/);
  assert.equal(d.files.get('/sandbox/workspace.json').toString(), '{broken');
  d.files.set('/sandbox/workspace.json', Buffer.alloc(12 * 1024 * 1024 + 1));
  assert.throws(() => d.store.checkpoint(), /STORE_TOO_LARGE/);
  assert.equal(d.store.write('large.json', '课'.repeat(5 * 1024 * 1024)), false);
});
function network() {
  const calls = [], replies = []; let resolveRequest, destroyed = 0;
  const http = { RequestMethod: { GET: 'GET', POST: 'POST' }, HttpDataType: { STRING: 'STRING' }, createHttp: () => ({ request(url, options) { calls.push({ url, options }); return new Promise(resolve => { resolveRequest = resolve; }); }, destroy() { destroyed++; } }) };
  const { DeepSeekService } = load('entry/src/main/ets/services/DeepSeekService.ets', { http, COURSE_PROMPT: 'synthetic prompt', PROGRAM_CONTRACT: 'synthetic program rules' });
  const service = new DeepSeekService({ key: () => 'synthetic-test-key', model: () => 'test-model' });
  return { service, calls, replies, reply: (id, text) => replies.push({ id, result: JSON.parse(text) }), finish: (status, data) => resolveRequest({ responseCode: status, result: JSON.stringify(data) }), destroyed: () => destroyed };
}
const input = () => JSON.stringify({ protocol: 2, stage: 'inspect', text: '合成通知', attachmentId: '', context: { startMonday: '2026-08-31', totalWeeks: 20, periods: [] }, answers: [], scope: null, target: null, injectedUrl: 'https://example.invalid', injectedKey: 'not-forwarded' });
test('AI requests use a fixed endpoint, strip unexpected input, and expose only defined failure codes', async () => {
  const n = network(), pending = n.service.start('req-1', 'parse', input(), n.reply);
  assert.equal(n.calls[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(n.calls[0].options.header.Authorization, 'Bearer synthetic-test-key');
  const body = JSON.parse(n.calls[0].options.extraData), content = JSON.parse(body.messages[1].content);
  assert.equal(body.messages[0].content,'synthetic promptsynthetic program rules');
  assert.equal(content.injectedUrl, undefined); assert.equal(content.injectedKey, undefined);
  n.finish(401, { error: 'do not expose raw response' }); await pending;
  assert.deepEqual(n.replies[0].result, { ok: false, code: 'AUTH' }); assert.equal(n.destroyed(), 1);
});
test('cancellation drops stale AI responses and malformed/truncated results are never accepted', async () => {
  const cancelled = network(), pending = cancelled.service.start('req-2', 'parse', input(), cancelled.reply);
  cancelled.service.cancel(); cancelled.finish(200, { choices: [{ finish_reason: 'stop', message: { content: '{"courses":[]}' } }] });
  await pending; assert.equal(cancelled.replies.length, 0);
  for (const choice of [{ finish_reason: 'length', message: { content: '{}' } }, { finish_reason: 'stop', message: { content: 'invalid-json' } }]) {
    const n = network(), p = n.service.start('req-3', 'parse', input(), n.reply); n.finish(200, { choices: [choice] }); await p;
    assert.equal(n.replies[0].result.ok, false); assert.equal(n.replies[0].result.result, undefined);
  }
});
test('expired or invalid attachments and invalid input do not issue network requests', async () => {
  const n = network();
  assert.throws(() => n.service.keep('bad/id', [{ type: 'text', text: 'synthetic' }]), /ATTACHMENT_INVALID/);
  assert.throws(() => n.service.keep('safe-id', [{ type: 'image_url', image_url: { url: 'https://example.invalid/a.png' } }]), /ATTACHMENT_INVALID/);
  const p = JSON.parse(input()); p.attachmentId = 'expired';
  await n.service.start('req-4', 'parse', JSON.stringify(p), n.reply);
  assert.equal(n.replies[0].result.code, 'ATTACHMENT_EXPIRED'); assert.equal(n.calls.length, 0);
  p.attachmentId = ''; p.context.totalWeeks = 0;
  await n.service.start('req-5', 'parse', JSON.stringify(p), n.reply);
  assert.equal(n.replies[1].result.code, 'TEXT_INVALID'); assert.equal(n.calls.length, 0);
});
