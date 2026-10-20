const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, 'boot-guard.js'), 'utf8');
function run(rendered) {
  const listeners = {}, dom = { dataset: {} };
  const count = selector => ({ length: rendered ? (selector === '.grid-time' ? 8 : 7) : 0 });
  let notifications = 0;
  const context = {
    document: { documentElement: dom, getElementById: () => ({ querySelectorAll: count }), addEventListener: (name, fn) => listeners[name] = fn },
    addEventListener: (name, fn) => listeners[name] = fn,
    SuikeNative: { pageReady: () => notifications++ }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return { context, listeners, notifications: () => notifications };
}
const ready = run(true);
ready.context.__suikeBootPhase('render');
ready.context.__suikeBootReady();
assert.equal(ready.context.__suikeBoot.ready, true);
assert.equal(ready.context.document.documentElement.dataset.suikeReady, 'true');
assert.equal(ready.notifications(), 1);
const empty = run(false);
empty.context.__suikeBootReady();
assert.equal(empty.context.__suikeBoot.ready, false);
assert.equal(empty.context.__suikeBoot.error.kind, 'init');
assert.equal(empty.notifications(), 0);
const failed = run(true);
failed.context.__suikeBootPhase('app');
failed.context.__suikeBootFail({ name: 'TypeError', message: 'PRIVATE_COURSE', stack: 'PRIVATE_BACKUP' }, 'script', 123, 45, 'PRIVATE_URL');
const safe = JSON.stringify(failed.context.__suikeBoot);
assert.equal(safe.includes('PRIVATE_'), false);
assert.equal(failed.context.__suikeBoot.error.name, 'TypeError');
assert.equal(failed.context.__suikeBoot.error.script, 4);
assert.equal(failed.context.__suikeBoot.error.line, 123);
failed.context.__suikeBootPhase('PRIVATE_COURSE');
assert.equal(failed.context.__suikeBoot.phase, 'app');
const csp = run(true);
csp.listeners.securitypolicyviolation({ effectiveDirective: 'script-src-elem', lineNumber: 32, columnNumber: 8, blockedURI: 'PRIVATE_URL', sample: 'PRIVATE_BACKUP' });
assert.equal(csp.context.__suikeBoot.error.directive, 'script-src-elem');
assert.equal(JSON.stringify(csp.context.__suikeBoot).includes('PRIVATE_'), false);
csp.context.__suikeBootFail({ name: 'ReferenceError' }, 'script', 42);
assert.equal(csp.context.__suikeBoot.error.name, 'ReferenceError');
console.log('Boot protocol verifies rendered structure, rejects missing UI, and excludes private exception text/URLs.');
