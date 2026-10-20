// Startup metadata only: never retain exception text, source URLs or timetable data.
(function () {
  'use strict';
  var phases = ['bootstrap', 'seed', 'model', 'app', 'state', 'render', 'ready'];
  var names = ['Error', 'SyntaxError', 'TypeError', 'ReferenceError', 'RangeError', 'SecurityError', 'UnknownError'];
  var kinds = ['script', 'promise', 'csp', 'resource', 'init'];
  var directives = ['default-src', 'script-src', 'script-src-elem', 'script-src-attr', 'style-src', 'style-src-elem', 'style-src-attr', 'img-src', 'font-src', 'connect-src', 'frame-src', 'child-src', 'worker-src', 'object-src', 'media-src', 'base-uri', 'form-action', 'manifest-src'];
  var boot = window.__suikeBoot = { phase: 'bootstrap', ready: false, error: null };
  function number(value) { return typeof value === 'number' && isFinite(value) ? Math.max(0, Math.min(1000000, Math.floor(value))) : 0; }
  window.__suikeBootPhase = function (phase) {
    if (!boot.ready && phases.indexOf(phase) >= 0) boot.phase = phase;
  };
  window.__suikeBootFail = function (error, kind, line, column, directive) {
    if (boot.ready) return;
    kind = kinds.indexOf(kind) >= 0 ? kind : 'script';
    if (boot.error && boot.error.kind !== 'csp' && boot.error.kind !== 'resource') return;
    var name = error && typeof error.name === 'string' ? error.name : 'UnknownError';
    boot.error = {
      kind: kind,
      name: names.indexOf(name) >= 0 ? name : 'UnknownError',
      script: boot.phase === 'seed' ? 2 : boot.phase === 'model' ? 3 : ['app', 'state', 'render'].indexOf(boot.phase) >= 0 ? 4 : 0,
      line: number(line), column: number(column),
      directive: directives.indexOf(directive) >= 0 ? directive : ''
    };
  };
  window.addEventListener('error', function (event) {
    window.__suikeBootFail(event.error, event.target === window ? 'script' : 'resource', event.lineno, event.colno);
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    window.__suikeBootFail(event.reason, 'promise');
  });
  document.addEventListener('securitypolicyviolation', function (event) {
    window.__suikeBootFail(null, 'csp', event.lineNumber, event.columnNumber, event.effectiveDirective);
  });
  window.__suikeBootReady = function () {
    var strip = document.getElementById('dayStrip');
    var grid = document.getElementById('weekGrid');
    if (!strip || strip.querySelectorAll('.day-btn').length !== 7 || !grid || grid.querySelectorAll('.grid-day').length !== 7 || grid.querySelectorAll('.grid-time').length < 1) {
      window.__suikeBootFail({ name: 'Error' }, 'init');
      return;
    }
    boot.phase = 'ready'; boot.ready = true;
    document.documentElement.dataset.suikeReady = 'true';
    try {
      if (window.SuikeNative && typeof window.SuikeNative.pageReady === 'function') window.SuikeNative.pageReady();
    } catch (_) { /* Native polling independently verifies the rendered document. */ }
  };
})();
