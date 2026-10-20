const test=require('node:test'),assert=require('node:assert/strict');
const {boot}=require('./interaction-harness.cjs');
function setup(storage){const h=boot(undefined,storage),calls=[];h.context.SuikeNative.syncWidgetAppearance=(...values)=>{calls.push(values);return true;};return Object.assign(h,{calls});}
test('saved app glass/frost preferences sync to the widget without changing courses',()=>{
 const h=setup({'suike.appearance.v1':JSON.stringify({version:1,glassEnabled:true,frost:65})}),before=h.getState();h.clock.tick(200);
 assert.deepEqual(h.calls[0],[true,65,false]);assert.deepEqual(h.getState(),before);
 h.context.SuikeWidgetAppearance.sync();assert.equal(h.calls.length,1);
});
test('glass switch and frost changes share a debounced native update; disabling preserves frost',async()=>{
 const h=setup();h.clock.tick(200);
 h.context.CustomEvent=class{constructor(type,init){this.type=type;this.detail=init.detail;}};
 h.document.dispatchEvent=e=>{(h.document.listeners[e.type]||[]).forEach(fn=>fn(e));return true;};
 h.context.SuikeAppearance.setEnabled(true);h.context.SuikeAppearance.setFrost(25,true);h.context.SuikeAppearance.setFrost(70,true);
 assert.equal(h.calls.length,1);h.clock.tick(200);assert.deepEqual(h.calls.at(-1),[true,70,false]);
 h.context.SuikeAppearance.setEnabled(false);h.clock.tick(200);assert.deepEqual(h.calls.at(-1),[false,70,false]);
});
test('reduced motion propagates and a rejected update can be retried',()=>{
 const h=setup();h.context.matchMedia=()=>({matches:true});h.context.SuikeNative.syncWidgetAppearance=()=>false;h.clock.tick(200);
 h.context.SuikeNative.syncWidgetAppearance=(...v)=>{h.calls.push(v);return true;};h.context.SuikeWidgetAppearance.sync();assert.deepEqual(h.calls.at(-1),[false,0,true]);
});
test('widget appearance entry opens the existing app controls',async()=>{
 const h=setup();h.context.SuikeNative.requestPinWidget=()=>true;h.context.SuikeFeatures.openReminders();
 await h.document.getElementById('widgetAppearanceSettings').click();
 assert.equal(h.document.getElementById('settingsDisplayDetails').open,true);
 assert.equal(h.document.querySelectorAll('#glassEnabled').length,1);
 assert.ok(!h.document.getElementById('productDialog').open);
 assert.ok(h.document.getElementById('pinWidgetWide'));assert.ok(h.document.getElementById('pinWidgetCompact'));
});
