'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('./workspace-storage.js');
const W = require('./workspace-engine.js');
const M = require('../../timetable/dist/model.js');
const esbuild = require(process.env.SUIKE_ESBUILD_MODULE || '../tools/node_modules/esbuild');
const STATE = 'suike.timetable.v1', HISTORY = 'suike.history.v1';
function values(overrides = {}) { return Object.assign(Object.fromEntries(E.KEYS.map(key => [key, null])), overrides); }
function checkpoint(overrides = {}) { return JSON.stringify({ version: 1, values: values(overrides) }); }
function mirror(initial = {}) {
  const data = new Map(Object.entries(initial)), writes = [];
  return { data, writes, getItem(key) { return data.get(key) ?? null; }, setItem(key, value) { writes.push(['set', key, String(value)]); data.set(key, String(value)); }, removeItem(key) { writes.push(['remove', key]); data.delete(key); } };
}
function backend(saved = null) {
  return { saved, calls: [], getWorkspaceCheckpoint() { return this.saved; }, persistWorkspaceCheckpoint(text) { this.calls.push(text); this.saved = text; return true; } };
}
function throwsCode(action, code) { assert.throws(action, error => error.code === code); }

test('absent or incomplete checkpoint bridge preserves the exact legacy storage adapter', () => {
  const storage = mirror({ other: 'unrelated' });
  assert.equal(E.createStorage(storage, null), storage);
  assert.equal(E.createStorage(storage, {}), storage);
  assert.equal(E.createStorage(storage, { getWorkspaceCheckpoint() { throw Error('must not call'); } }), storage);
  assert.equal(E.createStorage(storage, { persistWorkspaceCheckpoint() { throw Error('must not call'); } }), storage);
  assert.deepEqual(storage.writes, []);
});

test('a native checkpoint wins over stale WebView mirrors and refreshes all four keys', () => {
  const storage = mirror({ [STATE]: 'old', [HISTORY]: 'old-history', unrelated: 'keep' });
  const native = backend(checkpoint({ [STATE]: 'new', [HISTORY]: 'new-history' }));
  const durable = E.createStorage(storage, native);
  assert.equal(durable.durable, true);
  assert.equal(durable.getItem(STATE), 'new');
  assert.equal(storage.getItem(STATE), 'old', 'Creation leaves mirrors available for rescue until the caller validates the checkpoint contents');
  assert.deepEqual(storage.writes, []);
  durable.hydrateMirror();
  assert.equal(storage.getItem(STATE), 'new');
  assert.equal(storage.getItem(HISTORY), 'new-history');
  assert.equal(storage.getItem('unrelated'), 'keep');
  assert.equal(native.calls.length, 0, 'Restoration reads do not rewrite native state');
  storage.data.set(STATE, 'external-stale-edit');
  assert.equal(durable.getItem(STATE), 'new', 'Authoritative cache cannot be replaced by a late mirror update');
});

test('no existing native checkpoint migrates the four legacy values without importing unrelated keys', () => {
  const storage = mirror({ [STATE]: 'legacy', extra: 'ignored' }), native = backend(null);
  const durable = E.createStorage(storage, native);
  assert.equal(durable.getItem(STATE), 'legacy');
  durable.setItem(HISTORY, 'history');
  assert.deepEqual(JSON.parse(native.saved), { version: 1, values: values({ [STATE]: 'legacy', [HISTORY]: 'history' }) });
  assert.equal(storage.getItem('extra'), 'ignored');
});

test('first migration persists even a same-value write before later writes become idempotent', () => {
  const storage = mirror({ [STATE]: 'legacy' }), native = backend(null), durable = E.createStorage(storage, native);
  assert.equal(native.calls.length, 0, 'Creating the adapter does not persist unvalidated legacy JSON');
  durable.setItem(STATE, 'legacy');
  assert.equal(native.calls.length, 1);
  assert.deepEqual(JSON.parse(native.saved), { version: 1, values: values({ [STATE]: 'legacy' }) });
  durable.setItem(STATE, 'legacy'); durable.removeItem(HISTORY);
  assert.equal(native.calls.length, 1);
});

test('the explicit JSON null bridge sentinel migrates old values and persists a same-value first write', () => {
  const storage = mirror({ [STATE]: 'legacy', [HISTORY]: 'legacy-history', extra: 'keep' });
  const native = backend('null'), durable = E.createStorage(storage, native);
  assert.equal(durable.getItem(STATE), 'legacy'); assert.equal(durable.getItem(HISTORY), 'legacy-history');
  assert.equal(native.calls.length, 0); assert.deepEqual(storage.writes, []);
  durable.setItem(STATE, 'legacy');
  assert.equal(native.calls.length, 1);
  assert.deepEqual(JSON.parse(native.saved), { version: 1, values: values({ [STATE]: 'legacy', [HISTORY]: 'legacy-history' }) });
  assert.equal(storage.getItem('extra'), 'keep');
  durable.setItem(STATE, 'legacy'); assert.equal(native.calls.length, 1);
});

test('native persistence must acknowledge success before the cache or mirror is adopted', () => {
  const storage = mirror({ [STATE]: 'before' }), native = backend(checkpoint({ [STATE]: 'before' }));
  let durable = E.createStorage(storage, native); storage.writes.length = 0;
  const order = [];
  native.persistWorkspaceCheckpoint = text => {
    order.push('native'); assert.equal(durable.getItem(STATE), 'before'); assert.equal(storage.getItem(STATE), 'before');
    native.saved = text; return true;
  };
  const oldSet = storage.setItem.bind(storage); storage.setItem = (...args) => { order.push('mirror'); oldSet(...args); };
  durable.setItem(STATE, 'after');
  assert.deepEqual(order, ['native', 'mirror']);
  assert.equal(durable.getItem(STATE), 'after'); assert.equal(storage.getItem(STATE), 'after');
  assert.equal(JSON.parse(native.saved).values[STATE], 'after');
});

test('duplicate sets and absent removals do not produce durable writes', () => {
  const storage = mirror(), native = backend(checkpoint({ [STATE]: 'same' })), durable = E.createStorage(storage, native);
  storage.writes.length = 0; durable.setItem(STATE, 'same'); durable.removeItem(HISTORY);
  assert.equal(native.calls.length, 0); assert.deepEqual(storage.writes, []);
});

test('removal persists an explicit null while setItem follows string conversion semantics', () => {
  const native = backend(checkpoint({ [STATE]: 'old' })), durable = E.createStorage(mirror(), native);
  durable.removeItem(STATE); assert.equal(durable.getItem(STATE), null); assert.equal(JSON.parse(native.saved).values[STATE], null);
  durable.setItem(STATE, 42); assert.equal(durable.getItem(STATE), '42');
  durable.setItem(STATE, null); assert.equal(durable.getItem(STATE), 'null');
});

test('false, missing or string acknowledgements cannot change cache, native snapshot or mirror', () => {
  for (const response of [false, undefined, null, 'true', 1]) {
    const initial = checkpoint({ [STATE]: 'before' }), storage = mirror({ [STATE]: 'before' }), native = backend(initial);
    const durable = E.createStorage(storage, native); storage.writes.length = 0;
    let calls = 0; native.persistWorkspaceCheckpoint = () => { calls++; return response; };
    throwsCode(() => durable.setItem(STATE, 'after'), 'CHECKPOINT_WRITE_FAILED');
    assert.throws(() => durable.removeItem(STATE));
    assert.equal(calls, 1, 'A failed acknowledgement freezes writes until the page is reloaded');
    assert.equal(durable.getItem(STATE), 'before'); assert.equal(native.saved, initial);
    assert.equal(storage.getItem(STATE), 'before'); assert.deepEqual(storage.writes, []);
  }
});

test('a native write exception never adopts the proposed value', () => {
  const storage = mirror({ [STATE]: 'old' }), native = backend(checkpoint({ [STATE]: 'old' }));
  const durable = E.createStorage(storage, native); storage.writes.length = 0;
  let calls = 0; native.persistWorkspaceCheckpoint = () => { calls++; throw new Error('native IO failure'); };
  assert.throws(() => durable.setItem(STATE, 'new'));
  assert.throws(() => durable.setItem(STATE, 'another'));
  assert.equal(calls, 1, 'The native bridge is not called again after an uncertain IO result');
  assert.equal(durable.getItem(STATE), 'old'); assert.equal(storage.getItem(STATE), 'old'); assert.deepEqual(storage.writes, []);
});

test('an uncertain native acknowledgement cannot later overwrite a state that actually reached disk', () => {
  const storage = mirror({ [STATE]: 'old' }), native = backend(checkpoint({ [STATE]: 'old' })), durable = E.createStorage(storage, native);
  let calls = 0; native.persistWorkspaceCheckpoint = text => { calls++; native.saved = text; return false; };
  assert.throws(() => durable.setItem(STATE, 'reached-disk'));
  assert.equal(durable.getItem(STATE), 'old'); assert.equal(storage.getItem(STATE), 'old');
  assert.throws(() => durable.setItem(STATE, 'must-not-overwrite'));
  assert.equal(calls, 1);
  const restarted = E.createStorage(storage, native);
  assert.equal(restarted.getItem(STATE), 'reached-disk');
});

test('mirror quota failure cannot undo a successful native commit, and a new VM restores it', () => {
  const storage = mirror({ [STATE]: 'old' }), native = backend(checkpoint({ [STATE]: 'old' }));
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  storage.removeItem = () => { throw new Error('QuotaExceededError'); };
  const durable = E.createStorage(storage, native); durable.setItem(STATE, 'new');
  assert.equal(durable.getItem(STATE), 'new'); assert.equal(storage.getItem(STATE), 'old');
  assert.equal(JSON.parse(native.saved).values[STATE], 'new');
  const restarted = E.createStorage(storage, native); assert.equal(restarted.getItem(STATE), 'new');
  durable.removeItem(STATE); assert.equal(durable.getItem(STATE), null); assert.equal(JSON.parse(native.saved).values[STATE], null);
});

test('corrupted checkpoint envelopes fail closed before any legacy mirror key changes', () => {
  const malformed = [undefined, '', 'true', '[]', '{}', '{', JSON.stringify({ version: 2, values: values() }),
    JSON.stringify({ version: '1', values: values() }), JSON.stringify({ version: 1, values: [] }),
    JSON.stringify({ version: 1, values: { [STATE]: 'new' } }), JSON.stringify({ version: 1, values: values({ extra: 'unknown' }) }),
    JSON.stringify({ version: 1, values: values({ [STATE]: 0 }) }), JSON.stringify({ version: 1, values: values(), extra: true })];
  for (const saved of malformed) {
    const storage = mirror({ [STATE]: 'old', [HISTORY]: 'old-history', unrelated: 'keep' }), native = backend(saved);
    native.saved = saved;
    const before = [...storage.data];
    throwsCode(() => E.createStorage(storage, native), 'CHECKPOINT_INVALID');
    assert.deepEqual([...storage.data], before); assert.deepEqual(storage.writes, []); assert.equal(native.calls.length, 0);
  }
});

test('native read errors do not fall back to and rewrite legacy data', () => {
  const storage = mirror({ [STATE]: 'old' }), native = backend();
  native.getWorkspaceCheckpoint = () => { throw new Error('AtomicFile read failure'); };
  assert.throws(() => E.createStorage(storage, native), /AtomicFile read failure/);
  assert.equal(storage.getItem(STATE), 'old'); assert.deepEqual(storage.writes, []); assert.equal(native.calls.length, 0);
});

test('unknown keys cannot enter native checkpoint state', () => {
  const storage = mirror(), native = backend(checkpoint()), durable = E.createStorage(storage, native);
  storage.writes.length = 0;
  for (const key of ['unknown', '__proto__', 'constructor', '', STATE + ' ']) {
    throwsCode(() => durable.getItem(key), 'CHECKPOINT_KEY_INVALID');
    throwsCode(() => durable.setItem(key, 'bad'), 'CHECKPOINT_KEY_INVALID');
    throwsCode(() => durable.removeItem(key), 'CHECKPOINT_KEY_INVALID');
  }
  assert.equal(native.calls.length, 0); assert.deepEqual(storage.writes, []);
});

test('workspace history is durable before main state, and failed main write keeps the old course state', () => {
  const before = { schemaVersion: 1, settings: { startMonday: '2026-08-31', totalWeeks: 26, termLabel: '测试', theme: 'auto' }, periods: M.DEFAULT_PERIODS, courses: [], appliedUpdateIds: [] };
  const native = backend(checkpoint({ [STATE]: JSON.stringify(before) })), durable = E.createStorage(mirror(), native);
  const store = W.createWorkspaceStore({ storage: durable, validateState: M.validateState });
  const next = structuredClone(before); next.settings.termLabel = '修改后';
  const persist = native.persistWorkspaceCheckpoint.bind(native); let count = 0;
  native.persistWorkspaceCheckpoint = text => { count++; return count === 2 ? false : persist(text); };
  assert.throws(() => store.commit(before, next, '修改名称'));
  assert.equal(JSON.parse(durable.getItem(STATE)).settings.termLabel, '测试');
  assert.equal(JSON.parse(JSON.parse(native.saved).values[STATE]).settings.termLabel, '测试');
  assert.equal(JSON.parse(JSON.parse(native.saved).values[HISTORY]).snapshots.length, 1, 'Pre-change recovery snapshot survives the rejected main write');
});

test('UMD checkpoint adapter compiles to Chrome 58 and restores native state without DOM', () => {
  const compiled = esbuild.transformSync(fs.readFileSync(require.resolve('./workspace-storage.js'), 'utf8'), { target: 'chrome58', charset: 'utf8' }).code;
  const context = {}; vm.runInNewContext(compiled, context);
  const storage = mirror({ [STATE]: 'old' }), native = backend(checkpoint({ [STATE]: 'new' }));
  assert.equal(context.SuikeWorkspaceStorage.createStorage(storage, native).getItem(STATE), 'new');
});
