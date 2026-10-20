const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../period-times.js'),T=require('../course-time-core.js');
const {boot}=require('./interaction-harness.cjs');
const by=(h,id)=>h.document.getElementById(id);
const table=n=>Array.from({length:n},(_,i)=>{const clock=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');return {start:clock(420+i*50),end:clock(460+i*50)};});
test('complete campus table sets the real daily count; partial rows never imply fewer periods',()=>{
 const current=table(14),rows=table(6).map((p,i)=>({period:i+1,...p}));
 assert.equal(P.preview(current,rows,{complete:true}).periods.length,6);
 assert.equal(P.preview(current,rows).periods.length,14);
 assert.throws(()=>P.preview(current,rows.slice(1),{complete:true}),e=>e.code==='PERIOD_GAP');
});
test('occupied periods prevent shrinking, including explicit-clock courses; inputs remain untouched',()=>{
 const state={periods:table(14),courses:[{id:'kept',name:'实验',start:13,end:14,timeMode:'clock',sourceTime:'18:00-18:40'}]},before=JSON.stringify(state);
 assert.throws(()=>P.applyToState(state,table(12)),e=>e.code==='PERIOD_IN_USE');assert.equal(JSON.stringify(state),before);
 assert.equal(P.applyToState({...state,courses:[]},table(6)).periods.length,6);
});
test('manual daily count and each clock persist below eight, with matching week grid and selectors',async()=>{
 const initial=boot().getState();initial.courses=[];initial.importLedger=null;initial.skipLegacyImportBaseline=true;
 const h=boot(initial);await by(h,'editDailyPeriods').click();by(h,'dailyPeriodCount').value='6';await by(h,'dailyPeriodCount').fire('change');
 assert.ok(by(h,'dailyPeriodStart6'));assert.equal(by(h,'dailyPeriodStart7'),null);await by(h,'productConfirm').click();
 assert.equal(h.getState().periods.length,6);assert.equal(by(h,'weekGrid').querySelectorAll('.grid-time').length,6);
 const again=boot(h.getState());assert.equal(again.getState().periods.length,6);await by(again,'addCourse').click();assert.equal(by(again,'courseForm').elements.namedItem('start').children.length,7);
});
test('new manual count asks for missing clocks and does not invent a timetable',async()=>{
 const initial=boot().getState();initial.courses=[];initial.periods=table(12);initial.importLedger=null;initial.skipLegacyImportBaseline=true;
 const h=boot(initial),before=h.getState();await by(h,'editDailyPeriods').click();by(h,'dailyPeriodCount').value='14';await by(h,'dailyPeriodCount').fire('change');
 assert.equal(by(h,'dailyPeriodStart13').value,'');await by(h,'productConfirm').click();assert.deepEqual(h.getState(),before);
 for(let n=13;n<=14;n++){by(h,'dailyPeriodStart'+n).value=table(14)[n-1].start;by(h,'dailyPeriodEnd'+n).value=table(14)[n-1].end;}
 await by(h,'productConfirm').click();assert.equal(h.getState().periods.length,14);assert.equal(by(h,'weekGrid').querySelectorAll('.grid-time').length,14);
 assert.equal(boot(h.getState()).getState().periods.length,14);
});
test('an explicitly saved eight-period day remains eight after restart',()=>{
 const initial=boot().getState();initial.courses=[];initial.periods=table(8);initial.importLedger=null;initial.skipLegacyImportBaseline=true;
 assert.equal(boot(initial).getState().periods.length,8);
});
test('exact period boundaries retain sections; independent clocks also work outside periods',()=>{
 const periods=table(14);assert.equal(T.resolve(periods,'00:01','00:30',1,2,false,'').timeMode,'clock');
 const r=T.resolve(periods,periods[12].start,periods[13].end,1,2,false,'');assert.equal(r.start,13);assert.equal(r.end,14);
});
test('campus metadata explicitly distinguishes a full timetable from a few clock rows',()=>{
 const parser=require('../../portal-import/teaching-parser.js'),fs=require('node:fs'),path=require('node:path');
 const capture=JSON.parse(fs.readFileSync(path.join(__dirname,'../../portal-import/teaching-fixture.json'),'utf8')),state=boot().getState();
 capture.periods=table(8).map((p,i)=>({period:i+1,...p}));capture.periodCount=8;
 const full=parser.normalizeCapture(capture,state.settings,state.periods,state.courses);assert.equal(full.periodsComplete,true);assert.equal(full.periodCount,8);
 capture.periodCount=11;assert.equal(parser.normalizeCapture(capture,state.settings,state.periods,state.courses).periodsComplete,false);
});

test('a course in sections 13-14 validates and projects into reminders using the same clocks',()=>{
 const h=boot(),state=h.getState(),W=h.context.SuikeWorkspaceEngine;state.periods=table(14);state.importLedger=null;state.skipLegacyImportBaseline=true;
 state.courses=[{id:'late',name:'晚间实验',day:1,start:13,end:14,room:'A101',teacher:'',color:'teal',sourceTime:state.periods[12].start+'-'+state.periods[13].end,dates:['2026-10-19']}];
 assert.doesNotThrow(()=>h.context.SuikeNoticeEngine.validateState(JSON.parse(JSON.stringify(state))));
 assert.equal(W.actualTime(state.courses[0],state.periods).confirmed,true);
});
