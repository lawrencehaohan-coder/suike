const fs = require('node:fs');
const path = require('node:path');
const esbuild = require(process.env.SUIKE_ESBUILD_MODULE || './tools/node_modules/esbuild');
const root = __dirname;
const file = path.join(root, 'assets', 'index.html');
let html = fs.readFileSync(file, 'utf8');
let count = 0;
html = html.replace(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g, (whole, source) => {
  count++;
  if (count === 1) return whole; // Preserve the seed exactly.
  source = "window.__suikeBootPhase('" + (count === 2 ? 'model' : 'app') + "');\n" + source;
  if (count === 3) {
    const ending = '  render();\n})();';
    if (source.split(ending).length !== 2) throw new Error('App boot marker changed');
    source = source.replace(ending, "  window.__suikeBootPhase('render');\n  render();\n  window.__suikeBootReady();\n})();");
    const stateStart = "  try {\n    if (!M)";
    const stateError = "  } catch (error) {\n    $('agenda').textContent";
    if (source.split(stateStart).length !== 2 || source.split(stateError).length !== 2) throw new Error('App initialization contract changed');
    source = source.replace(stateStart, "  window.__suikeBootPhase('state');\n" + stateStart);
    source = source.replace(stateError, "  } catch (error) {\n    window.__suikeBootFail(error, 'init');\n    $('agenda').textContent");
  }
  const result = esbuild.transformSync(source, { target: 'chrome58', charset: 'utf8', legalComments: 'inline' });
  return '<script>\n' + result.code + '</script>';
});
if (count !== 3) throw new Error('Expected exactly three inline scripts');
const polyfills = fs.readFileSync(path.join(root, 'polyfills.js'), 'utf8');
html = html.replace('<script>', '<script>\n' + polyfills + "\nwindow.__suikeBootPhase('seed');\n</script>\n<script>");
const bootGuard = fs.readFileSync(path.join(root, 'boot-guard.js'), 'utf8');
if (!html.includes('<meta charset="utf-8">')) throw new Error('Missing early UTF-8 declaration');
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<script>\n' + bootGuard + '\n</script>');
html = html.replace('<style>', '<style>/* Android WebView CSS compatibility */\n.bottom-nav{width:100%;max-width:1000px}dialog{width:calc(100% - 32px);max-width:480px;max-height:calc(100vh - 48px)}\n');
fs.writeFileSync(file, html, 'utf8');
console.log('APK JS compiled for Chrome 58; startup handshake and private diagnostics added; seed unchanged.');
