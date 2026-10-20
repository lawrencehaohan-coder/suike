const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../school-adapters.js'),J=require('../teaching-parser.js'),X=require('../adapters/jsxsd/parser.js'),S=require('../safe-merge.js'),M=require('../../timetable/dist/model.js');
const fixtures=require('./fixtures.cjs'),legacy=require('../teaching-fixture.json');
const {boot,evaluate,put}=require('./app-harness.cjs');
const settings={startMonday:'2026-08-31',totalWeeks:26},clone=v=>JSON.parse(JSON.stringify(v));
test('the catalog selects three fixed adapters and rejects unknown schools and mismatched captures',()=>{
  assert.equal(A.defaultSchool,'just');assert.deepEqual(A.list().map(p=>p.id),['just','hhu','njust']);
  assert.throws(()=>A.get('https://evil.invalid'),{code:'UNKNOWN_SCHOOL'});
  assert.throws(()=>A.normalize('njust',fixtures.hhu(),settings,[]),{code:'CAPTURE_SCHOOL_MISMATCH'});
  assert.equal(A.get('njust').status,'trial');
});
test('JUST dispatch yields the unchanged legacy normalizer output and identifiers',()=>{
  const seed=boot().getState();assert.deepEqual(A.normalize('just',legacy,seed.settings,seed.periods,seed.courses),J.normalizeCapture(legacy,seed.settings,seed.periods,seed.courses));
});
test('HHU retains twelve small sections and infers only a unique validated clock solution',()=>{
  const out=A.normalize('hhu',fixtures.hhu(),settings,[]);assert.equal(out.occurrences.length,27);assert.equal(out.periods.length,12);assert.equal(out.periods[5].start,'14:00');assert.equal(out.periods[11].end,'20:55');
  assert.equal(out.occurrences.filter(c=>c.end===12).length,3);assert.equal(out.clockInference,true);
  const bad=fixtures.hhu();bad.periodGroups[1].end='12:16';assert.throws(()=>A.normalize('hhu',bad,settings,[]),{code:'PERIOD_TIMES_AMBIGUOUS'});
  bad.periodGroups=[];assert.throws(()=>A.normalize('hhu',bad,settings,[]),{code:'PERIOD_GROUPS_INVALID'});
});
test('NJUST has its own source and leaves absent clock metadata absent, with unresolved evening times pending',()=>{
  const out=A.normalize('njust',fixtures.njust(),settings,[]);assert.equal(out.source.system,'njust-jsxsd');assert.equal(out.occurrences.length,27);assert.deepEqual(out.periods,[]);assert.equal(out.requiresManualTimes,true);
  const late=out.occurrences.filter(c=>c.name==='合成晚课');assert.ok(late.every(c=>c.timeMode==='pending'&&c.start===null&&c.sourceTime===''));
  assert.ok(out.occurrences.every(c=>c.sourceOccurrenceId.startsWith('njust-pattern-')));
});
test('week and section lists never widen disjoint sections; source identities ignore room/teacher edits',()=>{
  assert.deepEqual(X.parsePattern('1-5(单周),8-12(双周)[3-4-5节]',26),{start:3,end:5,weeks:[1,3,5,8,10,12]});
  assert.throws(()=>X.parsePattern('1-16(周)[1-2-5节]',26),{code:'SECTIONS_NONCONTIGUOUS'});
  const capture=fixtures.hhu(),a=A.normalize('hhu',capture,settings,[]);capture.rows[0].teacher='更新教师';capture.rows[0].room='更新教室';const b=A.normalize('hhu',capture,settings,[]);
  assert.deepEqual(a.occurrences.map(c=>c.sourceOccurrenceId),b.occurrences.map(c=>c.sourceOccurrenceId));
});
function incoming(n){return {source:n.source,scope:n.scope,occurrences:n.occurrences,rejectedCount:n.rejectedCount};}
function merge(state,normalized,ledger){const input=incoming(normalized),plan=S.planMerge(state,input,ledger);const choices=plan.preview.filter(row=>row.allowedActions.length).map(row=>({sourceOccurrenceId:row.sourceOccurrenceId,action:row.type==='addition'?'add':'skip'}));return S.commitMerge(state,input,ledger,{baseFingerprint:plan.baseFingerprint,choices});}
test('source-specific comparison never strips the JUST campus prefix from another school',()=>{
  const seed=boot().getState();seed.courses=[];seed.importLedger=null;const n=A.normalize('njust',fixtures.njust(),settings,seed.periods);n.occurrences[0].room='张家港 测试教室';
  const result=merge(seed,n,null);assert.ok(result.state.courses.some(c=>c.room==='张家港 测试教室'));
});
async function empty(school){const seed=boot().getState();seed.courses=[];seed.importLedger=null;seed.skipLegacyImportBaseline=true;const h=boot(seed),select=h.document.getElementById('teachingSchool');select.value=school;await select.fire('change');return h;}
function receive(h,data){put(h.context,'captureForTest',data);return evaluate(h.context,'SuikeImport.receiveCapture(captureForTest)');}
test('generated HHU UI imports, reimports and restores twelve sections without duplicating dates',async()=>{
  const h=await empty('hhu');assert.equal(receive(h,fixtures.hhu()),true);assert.ok(h.document.getElementById('schoolClockInference'));
  await h.document.getElementById('confirmTeachingImport').click();const after=h.getState();assert.equal(after.periods.length,12);assert.equal(after.courses.reduce((n,c)=>n+c.dates.length,0),27);assert.equal(h.document.querySelectorAll('.period-edit-row').length,12);
  receive(h,fixtures.hhu());await h.document.getElementById('confirmTeachingImport').click();assert.deepEqual(h.getState(),after);
  const reload=boot(after);assert.equal(reload.document.getElementById('teachingSchool').value,'hhu');assert.equal(reload.context.__suikeBoot.ready,true);
});
test('NJUST confirmation requires checking local clocks, preserves manual labs, and reimports idempotently',async()=>{
  const h=await empty('njust');const before=h.getState();before.courses=[{id:'manual-test-lab',name:'手工实验',room:'自定教室',teacher:'',day:6,start:5,end:6,dates:['2026-10-17'],color:'teal',sourceTime:''}];const edited=boot(before),select=edited.document.getElementById('teachingSchool');select.value='njust';await select.fire('change');receive(edited,fixtures.njust());
  await edited.document.getElementById('confirmTeachingImport').click();assert.deepEqual(edited.getState(),before);
  const check=edited.document.getElementById('schoolManualTimes');check.checked=true;await check.fire('change');await edited.document.getElementById('confirmTeachingImport').click();const imported=edited.getState();assert.equal(imported.importLedger.source.system,'njust-jsxsd');assert.ok(imported.courses.some(c=>c.id==='manual-test-lab'));
  receive(edited,fixtures.njust());const second=edited.document.getElementById('schoolManualTimes');second.checked=true;await second.fire('change');await edited.document.getElementById('confirmTeachingImport').click();assert.deepEqual(edited.getState(),imported);
});
test('school switching clears a pending preview and never imports a mismatched or different-school ledger',async()=>{
  const h=await empty('hhu');receive(h,fixtures.hhu());const select=h.document.getElementById('teachingSchool');select.value='njust';await select.fire('change');assert.equal(h.document.getElementById('teachingImportPreview').hidden,true);assert.equal(receive(h,fixtures.hhu()),false);
  const legacyApp=boot();const pick=legacyApp.document.getElementById('teachingSchool');pick.value='hhu';await pick.fire('change');const before=legacyApp.getState();receive(legacyApp,fixtures.hhu());assert.match(legacyApp.document.querySelector('.teaching-message').textContent,/已有其他学校/);assert.deepEqual(legacyApp.getState(),before);
});
test('HHU ledger passes workspace validation and protects manual moves, deletions and custom lines',()=>{
  const h=boot(),state=h.getState();state.courses=[];state.importLedger=null;state.skipLegacyImportBaseline=true;
  const n=A.normalize('hhu',fixtures.hhu(),settings,[]),first=merge(state,n,null);first.state.importLedger=first.ledger;first.state.periods=n.periods.map(({start,end})=>({start,end}));
  const manual=clone(first.state),course=manual.courses[0];course.name='人工改名';course.color='#8065ad';course.start=6;course.end=7;const deleted=manual.courses[1];manual.courses=manual.courses.filter(c=>c.id!==deleted.id);
  const second=merge(manual,n,first.ledger);assert.ok(second.state.courses.some(c=>c.name==='人工改名'&&c.color==='#8065ad'&&c.start===6));assert.equal(second.state.courses.some(c=>c.id===deleted.id),false);
  const W=require('../../android-app/product/workspace-engine.js');const normalized=W.normalizeState({...second.state,importLedger:second.ledger},M.validateState,S.validateLedger);assert.equal(normalized.periods.length,12);
});
