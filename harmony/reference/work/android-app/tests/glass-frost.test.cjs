const test=require('node:test'),assert=require('node:assert/strict');
const {boot,html}=require('./interaction-harness.cjs');
const KEY='suike.appearance.v1';
// The CPU DOM has no CustomEvent/dispatchEvent; record the events the preference emits.
function harness(storage){
  const h=boot(undefined,storage),events=[];
  h.context.CustomEvent=class{constructor(type,init){this.type=type;this.detail=init&&init.detail;}};
  h.document.dispatchEvent=event=>{events.push(event);return true;};
  return Object.assign(h,{events,A:h.context.SuikeAppearance,row:h.document.getElementById('glassFrostRow'),
    range:h.document.getElementById('glassFrost'),value:h.document.getElementById('glassFrostValue'),reset:h.document.getElementById('glassFrostReset')});
}
test('frost starts clear and its slider stays hidden in the classic appearance',()=>{
  const h=harness();
  assert.equal(h.A.isEnabled(),false);assert.equal(h.A.getFrost(),0);assert.equal(h.row.hidden,true);
  assert.equal(h.document.documentElement.style['--lg-frost'],'0.00');
  assert.equal(h.value.textContent,'清透');assert.equal(h.reset.disabled,true);
  assert.equal(h.data.has(KEY),false,'startup does not write a preference');
});
test('dragging previews frost without writing; release saves once alongside the glass switch',async()=>{
  const h=harness();h.A.setEnabled(true);assert.equal(h.row.hidden,false);
  const before=h.data.get(KEY);
  h.range.value='35';await h.range.fire('input');
  assert.equal(h.A.getFrost(),35);assert.equal(h.document.documentElement.style['--lg-frost'],'0.35');
  assert.equal(h.range.style['--lg-range'],'35%');assert.equal(h.value.textContent,'35%');
  assert.equal(h.data.get(KEY),before,'dragging does not write storage');
  await h.range.fire('change');
  assert.deepEqual(JSON.parse(h.data.get(KEY)),{version:1,glassEnabled:true,frost:35});
  assert.equal(h.events.filter(e=>e.type==='suike-glass-frost').length,1,'release at the same value emits nothing new');
  assert.equal(h.events.filter(e=>e.type==='suike-glass-frost')[0].detail.frost,35);
});
test('frost values are clamped and rounded to whole percent',()=>{
  const h=harness();h.A.setEnabled(true);
  assert.equal(h.A.setFrost(140),100);assert.equal(h.value.textContent,'磨砂');
  assert.equal(h.A.setFrost(-3),0);assert.equal(h.A.setFrost('42.6'),43);assert.equal(h.A.setFrost('heavy'),0);
  assert.equal(h.reset.disabled,true);
});
test('a saved frost level survives restart, glass off keeps it, and reset returns to clear',async()=>{
  const h=harness({[KEY]:JSON.stringify({version:1,glassEnabled:true,frost:60})});
  assert.equal(h.A.isEnabled(),true);assert.equal(h.A.getFrost(),60);assert.equal(h.range.value,'60');
  assert.equal(h.document.documentElement.style['--lg-frost'],'0.60');assert.equal(h.reset.disabled,false);
  h.A.setEnabled(false);assert.equal(h.row.hidden,true);
  assert.deepEqual(JSON.parse(h.data.get(KEY)),{version:1,glassEnabled:false,frost:60});
  h.A.setEnabled(true);await h.reset.click();
  assert.equal(h.A.getFrost(),0);assert.deepEqual(JSON.parse(h.data.get(KEY)),{version:1,glassEnabled:true,frost:0});
});
test('older preferences without frost and unreadable values fall back to clear glass',()=>{
  assert.equal(harness({[KEY]:JSON.stringify({version:1,glassEnabled:true})}).A.getFrost(),0);
  assert.equal(harness({[KEY]:JSON.stringify({version:1,glassEnabled:true,frost:'heavy'})}).A.getFrost(),0);
  assert.equal(harness({[KEY]:'{"version":1,"glassEnabled":true,"frost":1e999}'}).A.getFrost(),0);
  assert.equal(harness({[KEY]:'not json'}).A.isEnabled(),false);
});
test('the frost curve: 0 is fully clear glass, tint comes first, blur only past halfway',()=>{
  const h=harness(),L=value=>h.A.frostLevels(value);
  assert.deepEqual(JSON.parse(JSON.stringify(L(0))),{f:0,tint:0,navBlur:.65,sheetTint:.55,sheetBlur:10,edge:0,halo:1});
  assert.equal(L(50).navBlur,.65,'tab bar centre stays clear through the lower half');assert.ok(L(50).tint>.3&&L(50).tint<.5);
  assert.ok(L(75).navBlur>.65&&L(75).navBlur<15.65);
  assert.deepEqual(JSON.parse(JSON.stringify(L(100))),{f:1,tint:.92,navBlur:15.65,sheetTint:.92,sheetBlur:44,edge:1,halo:0});
  h.A.setFrost(100);assert.equal(h.document.documentElement.style['--lg-nav-blur'],'15.65px');
  assert.equal(h.document.documentElement.style['--lg-tint'],'0.92');assert.equal(h.document.documentElement.style['--lg-edge-opacity'],'1');
});
test('the shipped stylesheet reads every glass blur, tint and fade from the frost variables',()=>{
  const css=html.slice(html.indexOf('<style id="suikeLiquidStyles"'));
  assert.match(css,/--lg-tint:0; --lg-nav-blur:\.65px/,'stylesheet defaults are the clear end');
  assert.match(css,/backdrop-filter:blur\(var\(--lg-nav-blur\)\)/);
  assert.match(css,/backdrop-filter:blur\(var\(--lg-sheet-blur\)\)/);
  assert.match(css,/--lg-glass:rgba\(255,255,255,var\(--lg-tint\)\)/);
  assert.match(css,/opacity:var\(--lg-edge-opacity\)/);
  assert.match(html,/blur\("\s*\+\s*\+blur\.toFixed\(2\)\s*\+\s*"px\) url\(#"/);
});

test('custom backgrounds do not impose a hidden frost floor',()=>{
 const h=harness();h.document.documentElement.dataset.appearance='custom';h.A.setFrost(0);
 assert.equal(h.document.documentElement.style['--lg-nav-blur'],'0.65px');
 assert.equal(h.document.documentElement.style['--lg-sheet-blur'],'0.8px');
 h.A.setFrost(100);assert.equal(h.document.documentElement.style['--lg-sheet-blur'],'44px');
});


test('switching appearance changes only the custom frost endpoint',()=>{
 const h=harness();h.A.setFrost(0);
 assert.equal(h.A.frostLevels().sheetBlur,10);assert.equal(h.A.frostLevels().sheetTint,.55);
 h.document.documentElement.dataset.appearance='custom';h.A.setFrost(0);
 assert.equal(h.A.frostLevels().sheetBlur,.8);assert.equal(h.A.frostLevels().sheetTint,.06);
 h.document.documentElement.dataset.appearance='standard';h.A.setFrost(0);
 assert.equal(h.document.documentElement.style['--lg-sheet-blur'],'10px');
});
