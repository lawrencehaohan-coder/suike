const test=require('node:test'),assert=require('node:assert/strict');
const WI=require('../week-interactions-core.js'),G=require('../week-gesture.js');
const M=require('../../timetable/dist/model.js');
const W=require('../product/workspace-engine.js');
const S=require('../../portal-import/safe-merge.js');
const clone=v=>JSON.parse(JSON.stringify(v));
function validate(input){const out=M.validateState(input);if(input.productSettings)out.productSettings=clone(input.productSettings);return out;}
const deps={model:M,workspace:W,options:{validateState:validate,validateLedger:S.validateLedger}};
function course(id,day,start=1,end=2){return {id,name:id,day,start,end,room:'教学楼 101',teacher:'教师',sourceTime:'',color:'teal',dates:[M.addDays('2026-10-12',day-1),M.addDays('2026-10-19',day-1)]};}
function fixture(courses=[course('A',1),course('B',2)]){return {schemaVersion:1,settings:{startMonday:'2026-08-31',totalWeeks:26,termLabel:'秋季',coverageStart:'2026-08-31',coverageEnd:'2027-01-31',theme:'dark'},periods:clone(M.DEFAULT_PERIODS),courses,appliedUpdateIds:['manual-lab'],skipLegacyImportBaseline:true,productSettings:{reminders:{mutedCourseIds:['A'],courseOverrides:{A:{leadMinutes:20}}}}};}
function move(s,extra={}){return WI.planMove(s,{courseId:'A',date:'2026-10-12',targetDate:'2026-10-14',targetStart:3,hitPeriod:3,...extra},deps);}

test('a move splits only this week, preserves future weeks and imported baselines, and inherits reminders',()=>{
 const s=fixture();s.importLedger={version:1,source:{system:'test',term:'秋'},entries:s.courses[0].dates.map((date,i)=>({sourceOccurrenceId:'a-'+i,sourceKey:'A',week:7+i,baseline:{date,name:'A',day:1,start:1,end:2,room:'教学楼 101',teacher:'教师',sourceTime:'',timeMode:'periods',timeNote:''},association:{courseId:'A',date},tombstone:false}))};
 const before=clone(s),plan=move(s),p=plan.placements[0],edited=plan.state.courses.find(c=>c.id===p.courseId);
 assert.equal(plan.kind,'move');assert.deepEqual(s,before);assert.deepEqual(edited.dates,['2026-10-14']);assert.equal(edited.day,3);assert.equal(edited.start,3);assert.equal(edited.end,4);
 assert.deepEqual(plan.state.courses.find(c=>c.id==='A').dates,['2026-10-19']);
 assert.deepEqual(plan.state.importLedger.entries.map(e=>e.baseline),s.importLedger.entries.map(e=>e.baseline));
 assert.deepEqual(plan.state.importLedger.entries[0].association,{courseId:p.courseId,date:'2026-10-14'});
 assert.equal(plan.state.importLedger.entries[0].tombstone,false);assert.ok(plan.state.productSettings.reminders.mutedCourseIds.includes(p.courseId));
 assert.deepEqual(plan.state.productSettings.reminders.courseOverrides[p.courseId],{leadMinutes:20});
});

test('dropping anywhere inside an occupied course atomically swaps both starts and keeps future weeks',()=>{
 const s=fixture(),before=clone(s),p=move(s,{targetDate:'2026-10-13',targetStart:2,hitPeriod:2});
 assert.equal(p.kind,'swap');assert.equal(p.placements.length,2);assert.deepEqual(s,before);
 const a=p.state.courses.find(c=>c.id===p.placements[0].courseId),b=p.state.courses.find(c=>c.id===p.placements[1].courseId);
 assert.deepEqual([a.day,a.start,a.end,a.dates],[2,1,2,['2026-10-13']]);
 assert.deepEqual([b.day,b.start,b.end,b.dates],[1,1,2,['2026-10-12']]);
 assert.deepEqual(p.state.courses.find(c=>c.id==='B').dates,['2026-10-20']);
});

test('different-duration swaps retain both lengths and reject overlaps on either landing side',()=>{
 const s=fixture([course('A',1,1,2),course('B',2,3,3)]);
 const p=move(s,{targetDate:'2026-10-13',targetStart:3,hitPeriod:3});
 assert.equal(p.placements[0].end-p.placements[0].start+1,2);assert.equal(p.placements[1].end-p.placements[1].start+1,1);
 s.courses.push(course('C',2,4,4));const before=clone(s);
 assert.throws(()=>move(s,{targetDate:'2026-10-13',targetStart:3,hitPeriod:3}),{code:'CONFLICT'});assert.deepEqual(s,before);
 const reverse=fixture([course('A',1,1,1),course('B',2,3,4),course('C',1,2,2)]);
 assert.throws(()=>move(reverse,{targetDate:'2026-10-13',targetStart:3,hitPeriod:3}),{code:'CONFLICT'});
});

test('invalid positions, multiple targets and pending-time ambiguity never mutate the original',()=>{
 const s=fixture(),before=clone(s);
 assert.throws(()=>move(s,{targetStart:8,hitPeriod:8}),{code:'OUT_OF_RANGE'});
 assert.throws(()=>move(s,{targetDate:'2026-10-21'}),{code:'OUTSIDE_WEEK'});
 assert.throws(()=>move(s,{targetDate:'2026-02-30'}),{code:'DATE_INVALID'});
 assert.deepEqual(s,before);
 const many=fixture([course('A',1),course('B',2),course('C',2)]);
 assert.throws(()=>move(many,{targetDate:'2026-10-13',targetStart:1,hitPeriod:1}),{code:'MULTIPLE_TARGETS'});
 const pending=course('P',3);Object.assign(pending,{start:null,end:null,timeMode:'pending',timeNote:'时间待定'});
 assert.throws(()=>move(fixture([course('A',1),pending])),{code:'UNCONFIRMED'});
});

test('night moves preserve explicit same-period clocks or derive destination clocks, never invent missing times',()=>{
 const s=fixture([course('A',1,9,10)]);s.courses[0].sourceTime='18:30-20:05';
 let p=move(s,{targetStart:9,hitPeriod:9});assert.equal(p.state.courses.find(c=>c.id===p.placements[0].courseId).sourceTime,'18:30-20:05');
 p=move(s,{targetStart:5,hitPeriod:5});assert.equal(p.state.courses.find(c=>c.id===p.placements[0].courseId).sourceTime,'');
 const day=fixture();assert.throws(()=>move(day,{targetStart:9,hitPeriod:9}),{code:'OUT_OF_RANGE'});
 day.periods.push({start:'19:00',end:'19:45'},{start:'19:55',end:'20:40'});
 p=move(day,{targetStart:9,hitPeriod:9});assert.equal(p.state.courses.find(c=>c.id===p.placements[0].courseId).sourceTime,'19:00-20:40');
});

test('quick add requires a name, keeps optional fields optional, checks overlaps and adds only one date',()=>{
 const s=fixture(),before=clone(s),request={id:'new',date:'2026-10-14',start:3,end:4,name:'  示例物理🧪  ',room:'',teacher:''};
 const p=WI.planAdd(s,request,deps),added=p.state.courses.find(c=>c.id==='new');
 assert.deepEqual(s,before);assert.equal(added.name,'示例物理🧪');assert.deepEqual(added.dates,['2026-10-14']);assert.equal(added.day,3);assert.equal(added.room,'');assert.equal(added.teacher,'');
 assert.deepEqual(p.state.productSettings,s.productSettings);assert.deepEqual(p.state.appliedUpdateIds,s.appliedUpdateIds);
 assert.throws(()=>WI.planAdd(s,{...request,name:' '},deps),{code:'NAME_REQUIRED'});
 assert.throws(()=>WI.planAdd(s,{...request,date:'2026-10-12',start:1,end:2},deps),{code:'CONFLICT'});
 assert.throws(()=>WI.planAdd(p.state,request,deps),{code:'DUPLICATE_ID'});
 assert.equal(WI.defaultEnd(s,'2026-10-14',3),4);assert.equal(WI.defaultEnd(s,'2026-10-14',4),4);
});

function virtualGesture(){let at=0,id=0;const timers=new Map(),events=[];const gesture=G.create({schedule(fn,ms){timers.set(++id,{fn,due:at+ms});return id;},unschedule(i){timers.delete(i);},onActivate(){events.push('activate')},onMove(){events.push('move')},onDrop(){events.push('drop')},onCancel(reason){events.push(reason)}});return {gesture,events,tick(ms){at+=ms;[...timers].filter(([,t])=>t.due<=at).forEach(([i,t])=>{timers.delete(i);t.fn();});}};}
test('long press activates exactly at 500ms, then follows and drops once',()=>{
 const h=virtualGesture(),g=h.gesture;g.start({}, {x:0,y:0},1);h.tick(499);assert.equal(g.phase,'pending');assert.deepEqual(h.events,[]);
 h.tick(1);assert.equal(g.phase,'dragging');assert.deepEqual(h.events,['activate']);g.move({x:20,y:20},1);g.end({x:20,y:20},1);g.end({x:20,y:20},1);
 assert.deepEqual(h.events,['activate','move','drop']);assert.equal(g.phase,'idle');
});
test('early scrolling, short taps, cancellation and replaced presses cannot activate a stale timer',()=>{
 const h=virtualGesture(),g=h.gesture;g.start({}, {x:0,y:0},1);h.tick(200);g.move({x:0,y:9},1);h.tick(2000);assert.deepEqual(h.events,[]);
 g.start({}, {x:0,y:0},1);h.tick(499);g.end({x:0,y:0},1);h.tick(1);assert.deepEqual(h.events,[]);
 g.start({}, {x:0,y:0},1);h.tick(300);g.start({}, {x:0,y:0},2);h.tick(200);assert.equal(g.phase,'pending');h.tick(300);assert.deepEqual(h.events,['activate']);
 g.cancel('escape');assert.deepEqual(h.events,['activate','escape']);g.end({x:0,y:0},2);assert.equal(g.phase,'idle');
});
