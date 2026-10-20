/* CPU checks of the generated APK asset; this is not an Android/WebView test. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require(process.env.SUIKE_ESBUILD_MODULE || './tools/node_modules/esbuild');
const html = fs.readFileSync(path.join(__dirname,'assets/index.html'),'utf8');
const originalHtml = fs.readFileSync(path.join(__dirname,'../../outputs/随课_离线课表.html'),'utf8');
const capture = JSON.parse(fs.readFileSync(path.join(__dirname,'../portal-import/teaching-fixture.json'),'utf8'));
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const originalScripts = [...originalHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const appMarker = /\n\(function\(\) \{\s*"use strict";\s*const M = window\.TimetableModel;/;
const marker = appMarker.exec(scripts[4]||'');
function evaluate(context,code) {return vm.runInContext(code,context,{timeout:10000});}
function json(context,code) {return JSON.parse(evaluate(context,'JSON.stringify('+code+')'));}
function put(context,name,value) {evaluate(context,'globalThis['+JSON.stringify(name)+']=JSON.parse('+JSON.stringify(JSON.stringify(value))+')');}
function modules() {
  assert.ok(marker,'Expected compiled import modules before the app IIFE');
  const context=vm.createContext({__suikeBootPhase(){},console});
  context.window=context;
  evaluate(context,scripts[2]);evaluate(context,scripts[3]);evaluate(context,scripts[4].slice(0,marker.index));
  put(context,'capture',capture);
  evaluate(context,`
    var M=TimetableModel,S=JustSafeMerge,T=TeachingParser;
    var original=M.validateState(TIMETABLE_SEED), state=JSON.parse(JSON.stringify(original));
    function normalizeFor(s) { var n=T.normalizeCapture(capture,s.settings,s.periods,s.courses);return {source:n.source,scope:n.scope,occurrences:n.occurrences,rejectedCount:n.rejectedCount}; }
    function choicesFor(p,updates) { return p.preview.filter(i=>i.allowedActions.length).map(i=>({sourceOccurrenceId:i.sourceOccurrenceId,action:updates&&i.type==='sourceUpdate'?'acceptSource':i.type==='addition'?'add':'skip'})); }
    function apply(s,input,updates) {var p=S.planMerge(s,input,s.importLedger,{trustedLegacyBaseline:original});var r=S.commitMerge(s,input,s.importLedger,{baseFingerprint:p.baseFingerprint,choices:choicesFor(p,updates)},{trustedLegacyBaseline:original});r.state.importLedger=r.ledger;return M.validateState(r.state);}
    function meetings(s) {return s.courses.reduce((n,c)=>n+c.dates.length,0);}
    function labs(s) {return s.courses.filter(c=>c.id.indexOf('notice-')===0).reduce((n,c)=>n+c.dates.length,0);}
  `);
  return context;
}

test('generated APK keeps five scripts, exact original seed and Chrome 58 transpilation',()=>{
  assert.equal(scripts.length,5);assert.equal(scripts[2],originalScripts[0]);
  scripts.forEach((script,index)=>assert.doesNotThrow(()=>new vm.Script(script,{filename:'apk-script-'+index+'.js'})));
  // Comparing the compiler output verifies that currently generated model/app
  // contain no additional transformations needed for target Chrome 58.
  for(const index of [3,4]) {
    const again=esbuild.transformSync(scripts[index],{target:'chrome58',charset:'utf8',legalComments:'inline'}).code;
    assert.equal(again.trim(),scripts[index].trim(),'Regenerate APK asset with the Chrome 58 compiler');
  }
  const c=modules();assert.equal(evaluate(c,'typeof JustSafeMerge.commitMerge'),'function');assert.equal(evaluate(c,'typeof TeachingParser.normalizeCapture'),'function');
});

test('compiled final model strictly preserves valid importLedger and rejects preview/invalid ledgers',()=>{
  const c=modules();
  evaluate(c,'var input=normalizeFor(state);var imported=apply(state,input,false)');
  assert.equal(evaluate(c,'imported.importLedger.entries.length'),168);
  assert.equal(evaluate(c,'M.validateState(JSON.parse(JSON.stringify(imported))).importLedger.entries.length'),168);
  assert.throws(()=>evaluate(c,'var bad=JSON.parse(JSON.stringify(imported));bad.importLedger.extra=true;M.validateState(bad)'),/UNKNOWN_FIELD/);
  assert.throws(()=>evaluate(c,'var bad=JSON.parse(JSON.stringify(imported));bad.importLedger.entries[0].tombstone=true;M.validateState(bad)'),/TOMBSTONE_HAS_ASSOCIATION/);
  assert.throws(()=>evaluate(c,'var bad=JSON.parse(JSON.stringify(imported));bad.importLedger=S.planMerge(state,input,null).proposedLedger;M.validateState(bad)'),/UNKNOWN_FIELD/);
  assert.equal(evaluate(c,'M.validateState({...state,importLedger:null}).importLedger'),null);
});

test('real twenty teaching rows expand to 168 meetings with zero additions/conflicts and retain all 13 labs',()=>{
  const c=modules();
  evaluate(c,'var input=normalizeFor(state),p=S.planMerge(state,input,null,{trustedLegacyBaseline:original});var imported=apply(state,input,false)');
  const stats=json(c,'p.stats');
  assert.equal(stats.validOccurrences,168);assert.equal(stats.additions,0);assert.equal(stats.conflicts,0);assert.equal(stats.legacyBindings,168);
  // Seven Friday electrical classroom changes are real: old portal sample was
  // foreign-language 101, teaching table says teaching E-203, weeks 8..14.
  assert.equal(stats.sourceUpdates,7);
  assert.equal(evaluate(c,'meetings(imported)'),181);assert.equal(evaluate(c,'labs(imported)'),13);
  assert.deepEqual(json(c,'imported.courses'),json(c,'original.courses'));
  assert.deepEqual(json(c,'imported.periods'),json(c,'original.periods'));
  assert.ok(json(c,'p.preview.filter(i=>i.type==="sourceUpdate").map(i=>i.sourceChanges)').every(a=>a.length===1&&a[0]==='room'));
});

test('actual compiled parser and merger preserve pre-upgrade renamed/rescheduled/deleted courses',()=>{
  const c=modules();
  evaluate(c,`
    var edited=JSON.parse(JSON.stringify(state));
    var renamed=edited.courses.find(c=>c.id==='imported-001');renamed.name='我的物理课';renamed.start=3;renamed.end=4;
    var removed=edited.courses.find(c=>c.id==='imported-005');var removedDates=removed.dates.slice();
    edited.courses=edited.courses.filter(c=>c.id!=='imported-005');
    var input=normalizeFor(edited),p=S.planMerge(edited,input,null,{trustedLegacyBaseline:original});
    var result=apply(edited,input,false);
  `);
  assert.equal(evaluate(c,'p.stats.additions'),0);assert.equal(evaluate(c,'p.stats.deletedLocally'),evaluate(c,'removedDates.length'));
  assert.equal(evaluate(c,'p.stats.protectedLocal'),evaluate(c,'renamed.dates.length'));
  assert.equal(evaluate(c,'result.courses.find(c=>c.id==="imported-001").name'),'我的物理课');
  assert.equal(evaluate(c,'result.courses.some(c=>c.name==="示例物理2"&&c.start===1)'),false);
  assert.equal(evaluate(c,'result.courses.some(c=>c.id==="imported-005")'),false);
  assert.equal(evaluate(c,'labs(result)'),13);
  evaluate(c,'var again=apply(result,normalizeFor(result),false)');
  assert.deepEqual(json(c,'again'),json(c,'result'));
});

test('compiled backup, seed updates, edit round trip and undo preserve the same ledger',()=>{
  const c=modules();
  evaluate(c,`
    var imported=apply(state,normalizeFor(state),false), backup=JSON.stringify(imported);
    var restored=M.applySeedUpdates(JSON.parse(backup),original).state;
    var undo=JSON.parse(JSON.stringify(restored)), edited=JSON.parse(JSON.stringify(restored));
    edited.courses[0].name='测试编辑后的课程';edited=M.validateState(edited);
    var reverted=M.validateState(undo);
  `);
  assert.deepEqual(json(c,'restored.importLedger'),json(c,'imported.importLedger'));
  assert.deepEqual(json(c,'edited.importLedger'),json(c,'imported.importLedger'));
  assert.deepEqual(json(c,'reverted'),json(c,'restored'));
});

test('accepting only seven actual classroom changes remains idempotent and preserves other stored source times',()=>{
  const c=modules();evaluate(c,'var input=normalizeFor(state),accepted=apply(state,input,true),again=apply(accepted,normalizeFor(accepted),false)');
  assert.equal(evaluate(c,'meetings(accepted)'),181);assert.equal(evaluate(c,'labs(accepted)'),13);
  assert.deepEqual(json(c,'again'),json(c,'accepted'));
  assert.equal(evaluate(c,'S.planMerge(accepted,normalizeFor(accepted),accepted.importLedger,{trustedLegacyBaseline:original}).stats.sourceUpdates'),0);
  const expected=json(c,'original.courses.filter(c=>c.end<=8).map(c=>({name:c.name,start:c.start,end:c.end,sourceTime:c.sourceTime}))');
  assert.ok(json(c,'accepted.courses.filter(c=>c.end<=8&&c.id.indexOf("notice-")!==0)').every(c=>expected.some(e=>e.name===c.name&&e.start===c.start&&e.end===c.end&&e.sourceTime===c.sourceTime)));
});

// Small deterministic DOM/event harness. It exercises the real generated app
// logic and handlers; it deliberately does not claim layout, WebView behavior,
// navigation, CSS, accessibility or Android bridge security verification.
class TestNode {
  constructor(tag,owner,text){this.tagName=tag.toUpperCase();this.ownerDocument=owner;this.parentElement=null;this.children=[];this.attributes={};this.dataset={};this.style={setProperty(k,v){this[k]=v}};this.listeners={};this.hidden=false;this.value='';this.checked=false;this.disabled=false;this.nodeType=tag==='#text'?3:1;this._text=text||'';}
  set id(v){this.attributes.id=String(v)} get id(){return this.attributes.id||''}
  set className(v){this.attributes.class=String(v)} get className(){return this.attributes.class||''}
  get classList(){const n=this;return {toggle(v,on){let a=n.className.split(/\s+/).filter(Boolean);a=a.filter(x=>x!==v);if(on)a.push(v);n.className=a.join(' ');},contains(v){return n.className.split(/\s+/).includes(v)},add(v){this.toggle(v,true)},remove(v){this.toggle(v,false)}}}
  set textContent(v){this._text=String(v??'');this.children.forEach(c=>c.parentElement=null);this.children=[]} get textContent(){return this._text+this.children.map(c=>c.textContent).join('')}
  get firstChild(){return this.children[0]||null}
  get nextSibling(){return this.parentElement?this.parentElement.children[this.parentElement.children.indexOf(this)+1]||null:null;}
  append(...nodes){nodes.forEach(n=>this.appendChild(n instanceof TestNode?n:this.ownerDocument.createTextNode(String(n))))}
  appendChild(n){if(n.nodeType===11){[...n.children].forEach(child=>this.appendChild(child));return n}if(n.parentElement)n.parentElement.removeChild(n);this.children.push(n);n.parentElement=this;return n}
  removeChild(n){this.children=this.children.filter(c=>c!==n);n.parentElement=null;return n}
  replaceChildren(...nodes){this.children.forEach(c=>c.parentElement=null);this.children=[];this._text='';this.append(...nodes)}
  insertBefore(n,before){if(before==null)return this.appendChild(n);if(n.parentElement)n.parentElement.removeChild(n);const i=this.children.indexOf(before);if(i<0)throw new Error('Missing insertion reference');this.children.splice(i,0,n);n.parentElement=this;return n}
  remove(){if(this.parentElement)this.parentElement.removeChild(this)}
  setAttribute(k,v){this.attributes[k]=String(v);if(k==='value')this.value=String(v);if(k==='checked')this.checked=true;if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(v)}
  removeAttribute(k){delete this.attributes[k]} getAttribute(k){return this.attributes[k]??null}
  addEventListener(type,fn){(this.listeners[type]||=[]).push(fn)}
  async fire(type,extra={}){const event={target:this,currentTarget:this,preventDefault(){},...extra};for(const fn of this.listeners[type]||[])await fn(event)}
  click(){return this.fire('click')}
  matches(s){if(s.startsWith('#'))return this.id===s.slice(1);if(s.startsWith('.'))return this.className.split(/\s+/).includes(s.slice(1));if(s==='[data-view]')return this.dataset.view!==undefined;return this.tagName===s.toUpperCase()}
  querySelectorAll(s){return this.children.flatMap(c=>[...(c.matches(s)?[c]:[]),...c.querySelectorAll(s)])}
  querySelector(s){return this.querySelectorAll(s)[0]||null}
  closest(s){for(let n=this;n;n=n.parentElement)if(n.matches(s))return n;return null}
  get elements(){return {namedItem:name=>this.querySelectorAll('input').concat(this.querySelectorAll('select'),this.querySelectorAll('textarea')).find(n=>n.getAttribute('name')===name)||null}}
  reset(){this.querySelectorAll('input').concat(this.querySelectorAll('select'),this.querySelectorAll('textarea')).forEach(n=>{n.value=n.getAttribute('value')||'';n.checked=n.getAttribute('checked')!==null})}
  scrollIntoView(){} focus(){} showModal(){this.setAttribute('open','')} close(){this.removeAttribute('open')} getBoundingClientRect(){return {left:0,right:1000,top:0,bottom:1000}}
}
class TestDocument extends TestNode {
  constructor(){super('#document',null);this.ownerDocument=this;this.documentElement=this.createElement('html');this.append(this.documentElement);this.body=null;this.hidden=false}
  createElement(tag){const n=new TestNode(tag,this);if(tag==='canvas')n.getContext=()=>({fillStyle:'',font:'',textAlign:'',textBaseline:'',scale(){},fillText(){},fillRect(){},getImageData(x,y,w,h){return {data:new Uint8ClampedArray(Math.max(1,w*h*4))}}});return n}
  createElementNS(ns,tag){return this.createElement(tag)}
  getComputedStyle(){return {getPropertyValue:()=>''}}
  createTextNode(text){return new TestNode('#text',this,text)}
  createDocumentFragment(){const n=new TestNode('#fragment',this);n.nodeType=11;return n}
  getElementById(id){return this.querySelector('#'+id)}
}
class TestFormData {constructor(form){this.map=new Map();form.querySelectorAll('input').concat(form.querySelectorAll('select'),form.querySelectorAll('textarea')).forEach(n=>{const name=n.getAttribute('name');if(name&&!n.disabled&&(!(n.type==='checkbox')||n.checked))this.map.set(name,n.type==='checkbox'?'on':n.value)})}get(name){return this.map.get(name)??null}}
function parseDom() {
  const doc=new TestDocument(), stack=[doc.documentElement];
  const body=html.replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/g,'').replace(/<style(?:\s[^>]*)?>[\s\S]*?<\/style>/g,'').match(/<body(?:\s[^>]*)?>([\s\S]*?)<\/body>/)[1];
  const root=doc.createElement('body');doc.body=root;doc.documentElement.append(root);stack.push(root);
  const voidTags=new Set(['input','meta','link','img','br','hr']);
  for(const m of body.matchAll(/<!--[\s\S]*?-->|<\/?([\w-]+)\b([^>]*)>|([^<]+)/g)) {
    if(m[0].startsWith('<!--'))continue;
    if(m[3]){stack.at(-1).append(doc.createTextNode(m[3].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')));continue}
    const tag=m[1].toLowerCase();
    if(m[0].startsWith('</')){while(stack.length>2&&stack.at(-1).tagName!==tag.toUpperCase())stack.pop();if(stack.at(-1).tagName===tag.toUpperCase())stack.pop();continue}
    const n=doc.createElement(tag);
    for(const a of m[2].matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)){n.setAttribute(a[1],a[2]??a[3]??a[4]??'');if(a[1]==='type')n.type=a[2]??a[3]??a[4];if(a[1]==='hidden')n.hidden=true}
    stack.at(-1).append(n);if(!voidTags.has(tag)&&!m[0].endsWith('/>'))stack.push(n);
  }
  return doc;
}
function appHarness(stored) {
  const document=parseDom(), data=new Map(), exports=[], bridges={opens:0,ready:0};
  if(stored)data.set('suike.timetable.v1',JSON.stringify(stored));
  const context=vm.createContext({console,document,Element:TestNode,Node:TestNode,Document:TestDocument,DocumentFragment:TestNode,
    Blob,FormData:TestFormData,Intl,Date,Promise,location:{href:'https://suike.local/',origin:'https://suike.local',protocol:'https:'},navigator:{},
    setTimeout(){return 1},clearTimeout(){},setInterval(){return 1},
    requestAnimationFrame(fn){fn();return 1},clearRequestAnimationFrame(){},
    MutationObserver:class{observe(){}},
    localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)},
    addEventListener(){},matchMedia(){return {matches:false}},
    SuikeNative:{pageReady(){bridges.ready++},openTeachingPortal(){bridges.opens++;return true},exportBackup(name,text){exports.push({name,text});return true}}
  });context.window=context;
  scripts.forEach(s=>evaluate(context,s));
  const getState=()=>JSON.parse(data.get('suike.timetable.v1')||JSON.stringify(context.TIMETABLE_SEED));
  const findText=(text,tag='button')=>document.querySelectorAll(tag).find(n=>n.textContent===text);
  return {context,document,data,exports,bridges,getState,findText,receive(value=capture){put(context,'testCapture',value);return evaluate(context,'SuikeImport.receiveCapture(testCapture)')}};
}

test('real compiled app initializes import UI and cancel is a storage no-op in a deterministic DOM/event harness',async()=>{
  const h=appHarness();assert.equal(h.context.__suikeBoot.ready,true);assert.equal(h.bridges.ready,1);
  const storedBefore=new Map(h.data);
  assert.ok(h.document.getElementById('teachingImportTitle'));
  await h.findText('打开学校网页').click();assert.equal(h.bridges.opens,1);
  assert.equal(h.receive(),true);assert.ok(h.findText('确认导入所选内容'));
  assert.deepEqual(h.data,storedBefore);await h.findText('取消').click();assert.deepEqual(h.data,storedBefore);
});

test('real import UI confirms safely, native backup includes ledger, and actual undo restores the pre-import state',async()=>{
  const h=appHarness(),before=h.getState();h.receive();await h.findText('确认导入所选内容').click();
  const imported=h.getState();assert.equal(imported.importLedger.entries.length,168);assert.equal(imported.courses.flatMap(c=>c.dates).length,181);
  assert.equal(imported.courses.filter(c=>c.id.startsWith('notice-')).flatMap(c=>c.dates).length,13);
  await h.document.querySelector('.toast-undo').click();
  assert.deepEqual(h.getState(),before);
  assert.ok(h.data.has('suike.timetable.v1'),'Undo persists the restored timetable');
  assert.ok(JSON.parse(h.data.get('suike.history.v1')).snapshots.length>=2,'Undo preserves both recovery snapshots');
  assert.equal(h.getState().importLedger,undefined);
  h.receive();await h.findText('确认导入所选内容').click();assert.deepEqual(h.getState(),imported);
  await h.document.getElementById('exportData').click();assert.equal(h.exports.length,1);
  assert.deepEqual(JSON.parse(h.exports[0].text).importLedger,imported.importLedger);
});

test('actual course edit, backup restore and undo handlers retain the import ledger',async()=>{
  const h=appHarness();h.receive();await h.findText('确认导入所选内容').click();
  const imported=h.getState(), backup=JSON.stringify(imported);
  await h.document.querySelector('.week-course').click();await h.document.getElementById('editCourse').click();
  const form=h.document.getElementById('courseForm'), id=form.elements.namedItem('id').value;
  form.elements.namedItem('name').value='CPU编辑验证课程';await form.fire('submit');
  const edited=h.getState();assert.equal(edited.courses.find(c=>c.id===id).name,'CPU编辑验证课程');assert.deepEqual(edited.importLedger,imported.importLedger);
  const file=h.document.getElementById('importFile');file.files=[{size:Buffer.byteLength(backup),async text(){return backup}}];await file.fire('change');
  assert.deepEqual(h.getState(),imported);
  await h.document.querySelector('.toast-undo').click();assert.deepEqual(h.getState(),edited);
});

test('actual UI applies only the explicitly checked source classroom occurrence',async()=>{
  const h=appHarness();h.receive();
  const options=h.document.querySelectorAll('.teaching-choice');assert.equal(options.length,7);
  const first=options[0].querySelector('input');first.checked=true;await first.fire('change');
  await h.findText('确认导入所选内容').click();
  const imported=h.getState();assert.equal(imported.courses.flatMap(c=>c.dates).length,181);
  assert.equal(imported.courses.filter(c=>c.name==='示例电学1'&&c.start===3&&c.day===5&&c.room==='示例教学楼BE-203').flatMap(c=>c.dates).length,1);
  h.receive();assert.equal(h.document.querySelectorAll('.teaching-choice').length,6);
});

test('real import UI keeps user edits/deletions and source updates unchecked, then reimport remains idempotent',async()=>{
  const initial=modules(), stored=json(initial,'state');
  stored.courses.find(c=>c.id==='imported-001').name='我修改的课名';stored.courses=stored.courses.filter(c=>c.id!=='imported-005');
  const h=appHarness(stored);h.receive();
  const choices=h.document.querySelectorAll('.teaching-choice');assert.equal(choices.length,7);assert.ok(choices.every(n=>n.querySelector('input').checked===false));
  await h.findText('确认导入所选内容').click();const first=h.getState();
  assert.equal(first.courses.find(c=>c.id==='imported-001').name,'我修改的课名');assert.equal(first.courses.some(c=>c.id==='imported-005'),false);
  assert.equal(first.importLedger.entries.filter(e=>e.tombstone).length,stored.courses.find(c=>c.id==='imported-009').dates.length);
  h.receive();await h.findText('确认导入所选内容').click();assert.deepEqual(h.getState(),first);
});

test('real UI detects edits made after preview and invalid/empty captures do not write storage',async()=>{
  const h=appHarness();h.receive();
  const theme=h.document.getElementById('theme');theme.value='dark';await h.document.getElementById('settingsForm').fire('submit');
  const edited=h.getState();await h.findText('确认导入所选内容').click();assert.deepEqual(h.getState(),edited);
  assert.match(h.document.querySelector('.teaching-message').textContent,/预览后发生了变化/);
  const invalid={...capture,rows:[]};h.receive(invalid);assert.deepEqual(h.getState(),edited);assert.equal(h.document.querySelector('.teaching-preview').querySelectorAll('button').find(n=>n.textContent.includes('确认导入')).hidden,true);
});

test('first-upgrade deletion or rename of a night course is never offered as a checked new pending course',async()=>{
  for(const kind of ['delete','rename']) {
    const c=modules(), stored=json(c,'state');
    if(kind==='delete')stored.courses=stored.courses.filter(c=>c.id!=='imported-016');else stored.courses.find(c=>c.id==='imported-016').name='我改名的晚课';
    const h=appHarness(stored);h.receive();
    const selected=h.document.querySelectorAll('.teaching-choice').filter(n=>n.querySelector('input').checked);
    assert.equal(selected.length,0,kind+' must not silently offer the old night course as new');
    await h.findText('确认导入所选内容').click();
    if(kind==='delete')assert.equal(h.getState().courses.some(c=>c.name==='示例时政2'),false);
    else assert.equal(h.getState().courses.filter(c=>c.name==='我改名的晚课').length,1);
  }
});

async function clearThroughUi(h) {
  await h.document.getElementById('clearTimetable').click();
  assert.notEqual(h.document.getElementById('clearTimetableDialog').getAttribute('open'),null);
  await h.document.getElementById('confirmClearTimetable').click();
}
function meetingCount(s) {return s.courses.reduce((n,c)=>n+c.dates.length,0)}

test('fresh-import marker is strictly validated and blank backups do not receive bundled labs or date calibration',()=>{
  const c=modules();
  evaluate(c,"var blank=JSON.parse(JSON.stringify(original));blank.courses=[];blank.importLedger=null;blank.skipLegacyImportBaseline=true;blank.settings.startMonday=null;blank.appliedUpdateIds=[];var reload=M.applySeedUpdates(blank,original)");
  assert.equal(evaluate(c,'reload.state.courses.length'),0);
  assert.equal(evaluate(c,'reload.state.settings.startMonday'),null);
  assert.equal(evaluate(c,'reload.state.skipLegacyImportBaseline'),true);
  assert.equal(evaluate(c,'reload.changed'),false);
  assert.throws(()=>evaluate(c,"blank.skipLegacyImportBaseline='true';M.validateState(blank)"),/清空课表记录无效/);
});

test('week clear confirms all weeks, cancellation writes nothing, and undo restores the full imported timetable',async()=>{
  const h=appHarness();h.receive();await h.findText('确认导入所选内容').click();
  const before=h.getState(), stored=h.data.get('suike.timetable.v1');
  assert.ok(h.document.getElementById('clearTimetable').closest('#weekView'));
  await h.document.getElementById('clearTimetable').click();
  assert.match(h.document.getElementById('clearTimetableScope').textContent,/所有周次.*实验/);
  await h.document.getElementById('cancelClearTimetable').click();
  assert.equal(h.data.get('suike.timetable.v1'),stored);
  await clearThroughUi(h);
  const cleared=h.getState();assert.equal(meetingCount(cleared),0);assert.equal(cleared.importLedger,null);
  assert.deepEqual(cleared.settings,before.settings);assert.deepEqual(cleared.periods,before.periods);
  assert.equal(h.document.getElementById('clearTimetableEmpty').hidden,false);
  assert.equal(h.document.getElementById('clearTimetable').disabled,true);
  await h.findText('撤销').click();assert.deepEqual(h.getState(),before);
});

test('first clear survives backup and relaunch, then imports all 168 meetings without restoring the 13 cleared labs',async()=>{
  const h=appHarness();await clearThroughUi(h);const blank=h.getState();
  await h.document.getElementById('exportData').click();const backup=JSON.parse(h.exports[0].text);
  assert.deepEqual(backup,blank);
  const reload=appHarness(backup);assert.equal(meetingCount(reload.getState()),0);
  assert.equal(reload.document.getElementById('clearTimetableEmpty').hidden,false);
  await reload.document.getElementById('importAfterClear').click();assert.equal(reload.document.getElementById('settingsView').hidden,false);
  reload.receive();assert.match(reload.document.querySelector('.teaching-message').textContent,/新增 168，已存在 0，需核对 0/);
  await reload.findText('确认导入所选内容').click();
  const imported=reload.getState();assert.equal(meetingCount(imported),168);assert.equal(imported.importLedger.entries.length,168);
  assert.equal(imported.courses.some(c=>c.id.startsWith('notice-')),false);
  const again=appHarness(imported);again.receive();assert.match(again.document.querySelector('.teaching-message').textContent,/新增 0，已存在 168，需核对 0/);
});

test('clear discards old tombstones and pending preview, and permits a different semester to be imported',async()=>{
  const h=appHarness();h.receive();await h.findText('确认导入所选内容').click();
  h.receive();const oldConfirm=h.findText('确认导入所选内容');await clearThroughUi(h);
  assert.equal(h.document.querySelector('.teaching-preview').hidden,true);
  await oldConfirm.click();assert.equal(meetingCount(h.getState()),0);
  const future=JSON.parse(JSON.stringify(capture));future.term.year='2027-2028';
  future.rows.forEach(row=>{row.lines[3]=row.lines[3].replace('2026-2027','2027-2028');});
  h.receive(future);const monday=h.document.getElementById('teachingStartMonday');monday.value='2027-08-30';await monday.fire('change');
  await h.findText('核对导入内容').click();assert.match(h.document.querySelector('.teaching-message').textContent,/新增 168/);
  await h.findText('确认导入所选内容').click();assert.equal(h.getState().importLedger.source.term,'2027-2028-1');
});

test('individual course deletion remains protected after a fresh whole-timetable import',async()=>{
  const h=appHarness();await clearThroughUi(h);h.receive();await h.findText('确认导入所选内容').click();
  const course=h.getState().courses.find(c=>c.name==='示例物理2'&&c.day===4);
  const select=h.document.getElementById('weekSelect');select.value=evaluate(h.context,'TimetableModel.mondayOf('+JSON.stringify(course.dates[0])+')');await select.fire('change');
  const card=h.document.querySelectorAll('.week-course').find(n=>(n.getAttribute('aria-label')||'').includes(course.name)&&n.style.gridArea.includes(' / 5 /'));
  assert.ok(card);await card.click();await h.document.getElementById('deleteCourse').click();
  const after=h.getState();assert.equal(meetingCount(after),168-course.dates.length);
  h.receive();assert.match(h.document.querySelector('.teaching-message').textContent,/新增 0/);
  assert.ok(h.findText('你已删除，保留删除结果','p'));
  await h.findText('确认并记住导入记录').click();assert.equal(meetingCount(h.getState()),meetingCount(after));
});

test('failed storage write leaves all courses and the previous stored state intact',async()=>{
  const h=appHarness(), before=h.getState(), storedBefore=h.data.get('suike.timetable.v1');
  h.context.localStorage.setItem=()=>{throw new Error('QuotaExceededError')};
  await clearThroughUi(h);assert.deepEqual(h.getState(),before);
  assert.equal(h.data.get('suike.timetable.v1'),storedBefore,'A failed clear must not write the main timetable');
  assert.equal(h.document.getElementById('clearTimetableEmpty').hidden,true);
  assert.match(h.document.getElementById('toast').textContent,/未能保存，(?:原课表未改动|课表未清空)/);
});

test('a previously manually emptied timetable can explicitly reset deletion protection and import again',async()=>{
  const original=JSON.parse(evaluate(modules(),'JSON.stringify(original)'));
  original.courses=[];const h=appHarness(original);
  assert.equal(h.document.getElementById('clearTimetable').disabled,false);
  await clearThroughUi(h);h.receive();assert.match(h.document.querySelector('.teaching-message').textContent,/新增 168，已存在 0/);
});

function periodButton(h,n){return h.document.querySelectorAll('.period-edit-row').find(b=>b.dataset.period===String(n));}
test('period rows open the actual editor; cancel and invalid overlap do not write, valid save is undoable',async()=>{
  const h=appHarness(),before=h.getState();await periodButton(h,1).click();
  assert.equal(h.document.getElementById('periodStart').value,'08:00');
  await h.document.getElementById('productDialog').querySelectorAll('.button-outline').at(-1).click();assert.deepEqual(h.getState(),before);
  await periodButton(h,1).click();h.document.getElementById('periodEnd').value='09:00';
  await h.document.getElementById('productConfirm').click();assert.deepEqual(h.getState(),before);
  assert.equal(h.document.getElementById('productError').hidden,false);assert.match(h.document.getElementById('productError').textContent,/重叠/);
  h.document.getElementById('periodStart').value='08:05';h.document.getElementById('periodEnd').value='08:50';
  await h.document.getElementById('productConfirm').click();assert.deepEqual(h.getState().periods[0],{start:'08:05',end:'08:50'});
  assert.deepEqual(h.getState().courses,before.courses);assert.match(periodButton(h,1).textContent,/08:05–08:50/);
  await h.document.querySelector('.toast-undo').click();assert.deepEqual(h.getState(),before);
});
test('captured period changes are previewed without writes and confirmed together with the existing safe import',async()=>{
  const h=appHarness(),before=h.getState(),input=JSON.parse(JSON.stringify(capture));
  input.periods=[{period:1,start:'08:10',end:'08:55'},{period:2,start:'09:05',end:'09:50'}];
  assert.equal(h.receive(input),true);assert.deepEqual(h.getState(),before);
  assert.equal(h.document.getElementById('teachingImportTimes').checked,true);
  await h.document.getElementById('confirmTeachingImport').click();
  assert.deepEqual(h.getState().periods.slice(0,2),input.periods.map(({start,end})=>({start,end})));
  assert.deepEqual(h.getState().courses,before.courses);assert.equal(h.getState().importLedger.entries.length,168);
});
test('import can keep custom period times, and captures without clock metadata keep them automatically',async()=>{
  const h=appHarness(),before=h.getState(),input=JSON.parse(JSON.stringify(capture));
  input.periods=[{period:1,start:'08:05',end:'08:50'}];h.receive(input);
  const toggle=h.document.getElementById('teachingImportTimes');toggle.checked=false;await toggle.fire('change');
  await h.document.getElementById('confirmTeachingImport').click();assert.deepEqual(h.getState().periods,before.periods);
  h.receive();assert.match(h.document.getElementById('teachingPeriodPreview').textContent,/未提供明确/);
  await h.document.getElementById('confirmTeachingImport').click();assert.deepEqual(h.getState().periods,before.periods);
});
test('editing times after import preview makes the old plan stale instead of overwriting the edit',async()=>{
  const h=appHarness();h.receive();await periodButton(h,1).click();
  h.document.getElementById('periodStart').value='08:05';h.document.getElementById('periodEnd').value='08:50';await h.document.getElementById('productConfirm').click();
  const before=h.getState();await h.document.getElementById('confirmTeachingImport').click();
  assert.deepEqual(h.getState(),before);assert.match(h.document.querySelector('.teaching-message').textContent,/变化.*重新核对/);
});
test('period save failures preserve the durable state and leave the editor open with an error',async()=>{
  const h=appHarness(),before=h.getState();await periodButton(h,1).click();
  h.document.getElementById('periodStart').value='08:05';h.document.getElementById('periodEnd').value='08:50';
  h.context.localStorage.setItem=()=>{throw new Error('QuotaExceededError');};await h.document.getElementById('productConfirm').click();
  assert.deepEqual(h.getState(),before);assert.equal(h.document.getElementById('productError').hidden,false);
});

test('fresh timetable imports never borrow the bundled personal evening clock when the page has no explicit time',async()=>{
  const original=JSON.parse(evaluate(modules(),'JSON.stringify(original)'));original.courses=[];original.skipLegacyImportBaseline=true;
  const h=appHarness(original);h.receive();await h.document.getElementById('confirmTeachingImport').click();
  const night=h.getState().courses.find(c=>c.name==='示例时政2');
  assert.equal(night.timeMode,'pending');assert.equal(night.sourceTime,'');
});
