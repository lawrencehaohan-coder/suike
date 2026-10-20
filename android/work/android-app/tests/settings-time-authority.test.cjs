const test=require('node:test'),assert=require('node:assert/strict');
const {boot}=require('./interaction-harness.cjs');
const T=require('../course-time-core.js'),WI=require('../week-interactions-core.js');
const by=(h,id)=>h.document.getElementById(id),copy=x=>JSON.parse(JSON.stringify(x));
function fixture(){const s=boot().getState();s.importLedger=null;s.skipLegacyImportBaseline=true;s.courses=[{id:'regular-night',name:'常规晚课',day:1,start:9,end:10,room:'A101',teacher:'',color:'teal',dates:['2026-10-12'],sourceTime:'18:30-20:05'},{id:'brief-meeting',name:'团组织会议',day:1,start:null,end:null,timeMode:'clock',sourceTime:'06:40-06:50',room:'',teacher:'',color:'teal',dates:['2026-10-12']}];return s;}
async function savePeriod(h,n,begin,end){await h.document.querySelector('.period-list').children[n-1].querySelector('button').click();by(h,'periodStart').value=begin;by(h,'periodEnd').value=end;await by(h,'productConfirm').click();}
test('Settings immediately updates Today, Week, course editor and reminder clocks including stale evening imports',async()=>{
 const h=boot(fixture());await savePeriod(h,9,'19:05','19:50');const s=h.getState(),c=s.courses.find(c=>c.id==='regular-night');
 assert.equal(s.periods[8].start,'19:05');assert.match(by(h,'agenda').textContent,/19:05/);assert.match(by(h,'weekGrid').textContent,/19:05/);
 assert.equal(h.context.TimetableModel.timeRange(c,s.periods).start,'19:05');assert.equal(h.context.SuikeWorkspaceEngine.actualTime(c,s.periods).start,'19:05');assert.equal(T.initial(c,s.periods).begin,'19:05');
 const reload=boot(s);assert.match(by(reload,'agenda').textContent,/19:05/);assert.match(by(reload,'weekGrid').textContent,/19:05/);
});
test('routine late lessons without redundant source clocks are confirmed by Settings',()=>{
 const h=boot(fixture()),s=h.getState(),c={...s.courses[0],sourceTime:''};assert.equal(h.context.TimetableModel.timeRange(c,s.periods).exact,true);assert.equal(h.context.SuikeWorkspaceEngine.actualTime(c,s.periods).confirmed,true);
});
test('Settings changes preserve independent minute arrangements and use updated lesson slots for current status',async()=>{
 const h=boot(fixture());await savePeriod(h,9,'19:05','19:50');const s=h.getState(),event=s.courses.find(c=>c.id==='brief-meeting');assert.equal(event.sourceTime,'06:40-06:50');
 h.clock.setNow('2026-10-12T11:20:00Z');h.clock.tick(15000);assert.match(by(h,'nextCourse').textContent,/19:05/);assert.match(h.document.querySelector('.preview-remaining').textContent,/本节剩 30 分钟/);
 assert.equal(h.context.TimetableModel.timeSegments(s.courses[0],s.periods).length,2);
});
test('editing a single course from Today never changes the Settings period table',async()=>{
 const h=boot(fixture()),before=copy(h.getState().periods);await by(h,'agenda').querySelectorAll('button').find(n=>n.textContent.includes('常规晚课')).click();await by(h,'editCourse').click();
 by(h,'courseBegin').value='18:40';by(h,'courseFinish').value='20:00';await by(h,'courseFinish').fire('change');await by(h,'courseForm').fire('submit');
 assert.deepEqual(h.getState().periods,before);assert.equal(h.getState().courses.find(c=>c.id==='regular-night').timeMode,'clock');assert.equal(T.initial(h.getState().courses.find(c=>c.id==='regular-night'),before).begin,'18:40');
});
test('moving a course in Week only changes the occurrence and cannot rewrite Settings clocks',()=>{
 const h=boot(fixture()),s=h.getState(),before=copy(s.periods);const p=WI.planMove(s,{courseId:'regular-night',date:'2026-10-12',targetDate:'2026-10-14',targetStart:9,hitPeriod:9},{model:h.context.TimetableModel,workspace:h.context.SuikeWorkspaceEngine,options:{validateState:x=>x}});
 assert.deepEqual(copy(p.state.periods),before);assert.deepEqual(s.periods,before);
});
