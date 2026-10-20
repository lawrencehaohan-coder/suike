const test=require('node:test'),assert=require('node:assert/strict');
const {boot,html,evaluate}=require('./interaction-harness.cjs');
function pixels(h){const p=h.document.querySelector('.preview-pixel-progress');return {ratio:Number(p.dataset.previewRatio),total:p.children.length,filled:p.querySelectorAll('.is-filled').length};}
test('the shipping asset contains every promoted feature and excludes all demo controls and clock overrides',()=>{
  const h=boot();assert.equal(h.context.__suikeBoot.ready,true);assert.equal(typeof h.context.SuikeWeekInteractionsUI.snapshot,'function');
  assert.equal(h.context.SuikeAppearance.isEnabled(),false);assert.equal(h.document.getElementById('glassEnabled').checked,false);
  assert.ok(h.document.querySelector('.preview-header-load'));assert.ok(h.document.querySelector('.preview-pixel-progress'));
  assert.equal(h.document.querySelector('.preview-pixel-clock'),null);
  for(const text of ['pixelPreviewProgress','pixelPreviewLight','__suikePixelPreview','let previewMinute','selectedDate = previewDate'])assert.equal(html.includes(text),false);
  assert.ok([...h.data.keys()].every(key=>!key.startsWith('suike.preview.')));
});
test('live time and the stored theme survive startup instead of being forced to the preview defaults',()=>{
  const initial=boot().getState();initial.settings.theme='light';const h=boot(initial);assert.equal(h.getState().settings.theme,'light');
  h.clock.setNow('2026-10-12T03:00:00Z');h.clock.tick(15000);assert.match(h.document.querySelector('.preview-remaining').textContent,/本节剩 40 分钟/);
});
test('status dots update from current to completed on the ordinary application timer',()=>{
  const h=boot(),pips=()=>h.document.getElementById('dayStrip').children[0].querySelectorAll('i').map(n=>n.className);
  assert.ok(pips().includes('preview-pip-current'));h.clock.setNow('2026-10-12T03:47:00Z');h.clock.tick(15000);
  assert.equal(pips().includes('preview-pip-current'),false);assert.equal(pips().filter(name=>name==='preview-pip-done').length,2);
});
test('TODAY has one pixel WEEK LOAD in its header while other views retain their header information',async()=>{
  const h=boot(),graph=h.document.getElementById('weekLoad');assert.equal(graph.parentElement,h.document.querySelector('.app-header'));
  assert.deepEqual(graph.querySelectorAll('.preview-load-stack').map(n=>n.children.length),[4,3,3,3,1,0,1]);assert.equal(h.document.querySelectorAll('.wl-bar').length,0);
  for(const id of ['headWeek','headPeriod','headPhase'])assert.equal(h.document.getElementById(id).textContent,'');
  await h.document.querySelectorAll('[data-view]').find(n=>n.dataset.view==='week').click();assert.equal(graph.hidden,true);assert.match(h.document.getElementById('headWeek').textContent,/W07/);
});
test('monochrome square progress and the NOW countdown follow real lesson and break boundaries',()=>{
  const h=boot();assert.equal(pixels(h).ratio,.23);assert.equal(pixels(h).filled,Math.floor(.23*pixels(h).total/2)*2);assert.match(h.document.querySelector('.preview-remaining').textContent,/本节剩 22 分钟/);
  h.clock.setNow('2026-10-12T02:47:00Z');h.clock.tick(15000);assert.match(h.document.querySelector('.preview-remaining').textContent,/课间休息 8 分钟/);
  h.clock.setNow('2026-10-12T03:39:00Z');h.clock.tick(15000);assert.equal(pixels(h).ratio,.99);assert.match(h.document.querySelector('.preview-remaining').textContent,/本节剩 1 分钟/);
  assert.match(html,/--preview-pixel-ink:#000/);assert.match(html,/--preview-pixel-ink:#fff/);assert.match(html,/prefers-reduced-motion:reduce/);
});
test('a separately agreed evening clock uses its own remaining time instead of the school period gap',()=>{
  const initial=boot().getState();initial.courses=[{id:'special-evening',timeMode:'clock',name:'约定晚课',room:'',teacher:'',day:1,start:9,end:10,dates:['2026-10-12'],color:'teal',sourceTime:'18:30-20:05'}];initial.importLedger=null;initial.skipLegacyImportBaseline=true;
  const h=boot(initial);h.clock.setNow('2026-10-12T10:45:00Z');h.clock.tick(15000);
  assert.match(h.document.querySelector('.preview-remaining').textContent,/剩 80 分钟/);assert.equal(h.document.querySelector('.preview-remaining').textContent.includes('休息'),false);
});
test('drag activation calls the native haptic bridge once at the 500ms hold threshold',async()=>{
  const h=boot();let count=0;h.context.SuikeNative.weekLongPressHaptic=()=>count++;
  await h.document.querySelectorAll('[data-view]').find(n=>n.dataset.view==='week').click();const course=h.document.getElementById('weekGrid').querySelector('.week-course');
  await h.document.getElementById('weekGrid').fire('pointerdown',{target:course,clientX:12,clientY:12,button:0,pointerId:2,pointerType:'mouse'});
  h.clock.tick(499);assert.equal(count,0);h.clock.tick(1);assert.equal(count,1);await h.document.fire('pointercancel',{pointerType:'mouse'});assert.equal(h.context.SuikeWeekInteractionsUI.snapshot().phase,'idle');
});
