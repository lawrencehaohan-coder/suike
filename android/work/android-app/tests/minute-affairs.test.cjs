const test=require('node:test'),assert=require('node:assert/strict');
const Axis=require('../minute-axis.js'),T=require('../course-time-core.js'),P=require('../deepseek-protocol.js'),AI=require('../deepseek-core.js');
const {boot}=require('./interaction-harness.cjs');
const copy=x=>JSON.parse(JSON.stringify(x)),by=(h,id)=>h.document.getElementById(id);
const date='2026-10-12';
function event(id,a,b){return {id,name:id,dates:[date],day:1,start:null,end:null,timeMode:'clock',sourceTime:a+'-'+b,room:'',teacher:'',color:'teal'};}
function fixture(){const s=boot().getState();s.courses=[event('早会','06:40','06:50'),event('课间','08:45','08:55'),event('午会','12:00','12:10'),event('课内','08:10','08:20')];s.importLedger=null;s.skipLegacyImportBaseline=true;return s;}
test('minute arrangements validate, restore, sort by actual clocks and leave teaching periods unchanged',()=>{
 const s=fixture(),h=boot(s),M=h.context.TimetableModel;
 assert.deepEqual(h.getState().periods,s.periods);assert.equal(h.getState().courses[0].start,null);
 assert.deepEqual(Array.from(M.coursesOn(s.courses,date,s.periods),c=>c.name),['早会','课内','课间','午会']);
 assert.deepEqual(boot(h.getState()).getState().courses,s.courses);
 assert.equal(T.resolve(s.periods,'06:40','06:50',1,2,false,'').timeMode,'clock');
 assert.equal(T.resolve(s.periods,'06:40','06:50',1,2,false,'').start,null);
 assert.throws(()=>M.validateState({...s,courses:[{...s.courses[0],sourceTime:''}]}));
 assert.throws(()=>M.validateState({...s,courses:[{...s.courses[0],end:2}]}));
});
test('clock-only schedule works before, between and after periods; contradictions remain rejected',()=>{
 const periods=fixture().periods;
 for(const clock of ['06:40-06:50','08:45-08:55','12:00-12:10','22:40-22:50'])assert.deepEqual(P.periods('',periods,clock),{start:null,end:null,sourceTime:clock,timeMode:'clock'});
 assert.throws(()=>P.periods('3-4',periods,'06:40-06:50'),{code:'TIME_MISMATCH'});
 for(const clock of ['6:40-6:50','23:55-00:05','08:00-08:00','24:00-24:10'])assert.throws(()=>P.periods('',periods,clock));
 const draft=AI.normalize({status:'ready',courses:[event('早会','06:40','06:50')]},periods);assert.equal(draft.courses[0].timeMode,'clock');
});
test('display axis gives ten minutes exactly ten minutes of space and preserves every 76px period',()=>{
 const s=fixture(),before=copy(s.periods),axis=Axis.create(s.periods,s.courses),p=axis.place(s.courses[0]);
 assert.ok(Math.abs(p.height-76*10/45)<1e-8);assert.equal(axis.periodRow(1).height,76);assert.equal(axis.periodRow(5).height,76);
 assert.equal(axis.rows.find(r=>r.start===390).period,null);assert.ok(axis.rows.some(r=>r.start===700&&r.end===840&&!r.period));
 assert.deepEqual(s.periods,before);const empty=Axis.create(s.periods,[]);assert.equal(empty.rows.length,s.periods.length);
 const late=Axis.create(s.periods,[event('夜间','23:50','23:59')]);assert.ok(late.place(event('夜间','23:50','23:59')).height>0);
 const crossing=event('跨节','08:40','09:00'),crossAxis=Axis.create(s.periods,[crossing]);assert.ok(Math.abs(crossAxis.place(crossing).height-76*20/45)<1e-8);
});
test('overlap checks use minutes, touching edges do not conflict and layout lanes remain separate',()=>{
 const h=boot(fixture()),s=h.getState(),M=h.context.TimetableModel;
 const a=event('a','06:40','06:50'),b=event('b','06:50','07:00'),c=event('c','06:45','06:55');
 assert.equal(M.conflictsFor([a,b],a,s.periods).length,0);assert.equal(M.conflictsFor([a,c],a,s.periods).length,1);
 const lesson={...a,id:'lesson',timeMode:'periods',sourceTime:'',start:1,end:1};assert.equal(M.conflictsFor([lesson,s.courses[3]],lesson,s.periods).length,1);
 const lanes=Axis.lanes([{top:0,bottom:10},{top:5,bottom:15},{top:15,bottom:20}]);assert.equal(lanes[0].lanes,2);assert.notEqual(lanes[0].lane,lanes[1].lane);assert.equal(lanes[2].lanes,1);
});
test('Today stays compact, Week defaults to horizontal indicators, period drag targets stay correct',()=>{
 const h=boot(fixture()),s=h.getState(),grid=by(h,'weekGrid'),blocks=grid.querySelectorAll('.minute-arrangement');
 assert.equal(blocks.length,0);assert.equal(by(h,'agenda').querySelectorAll('.agenda-minute').length,4);
 assert.equal(grid.querySelectorAll('.grid-time').length,s.periods.length);assert.equal(grid.querySelectorAll('.minute-time-mark').length,4);
 assert.equal(grid.querySelector('.grid-slot').dataset.weekPeriod,'1');assert.equal(grid.querySelector('.grid-slot').style.gridArea.split('/')[0].trim(),'2');
 assert.ok(!grid.textContent.includes('null'));assert.equal(h.document.querySelectorAll('.minute-day-list').length,1);
});
test('manual clock-only input saves without period selection, undo restores everything, reminders use exact minutes',async()=>{
 const s=fixture();s.courses=[];const h=boot(s),before=h.getState();await by(h,'addCourse').click();
 const form=by(h,'courseForm');form.elements.namedItem('name').value='团组织会议';by(h,'courseBegin').value='06:40';by(h,'courseFinish').value='06:50';await by(h,'courseFinish').fire('change');
 assert.equal(form.elements.namedItem('start').required,false);await form.fire('submit');
 const now=h.getState(),c=now.courses[0];assert.equal(c.timeMode,'clock');assert.equal(c.start,null);assert.deepEqual(now.periods,before.periods);
 const payload=h.context.SuikeProductCore.nativePayload(now,Date.parse(date+'T00:00:00+08:00'),h.context.TimetableModel);
 assert.equal(payload.occurrences.length,1);assert.equal(payload.occurrences[0].endMillis-payload.occurrences[0].startMillis,600000);
 await h.document.querySelector('.toast-undo').click();assert.deepEqual(h.getState(),before);
});
test('DeepSeek clock-only facts preview and confirm atomically with original evidence and unchanged periods',async()=>{
 const s=fixture();s.courses=[];const h=boot(s),requests=[],raw='2026年10月12日06:40-06:50团组织会议';
 Object.assign(h.context.SuikeNative,{getDeepSeekConfig:()=>JSON.stringify({ok:true,configured:true,model:'deepseek-flash'}),requestDeepSeek:(id,action,text)=>{requests.push({id,payload:JSON.parse(text)});return true;},cancelDeepSeek(){},clearDeepSeekAttachments(){}});
 await by(h,'deepSeekEntry').click();by(h,'deepSeekCourseText').value=raw;await by(h,'deepSeekParse').click();const first=requests.at(-1);assert.equal(first.payload.context.program.clockOnlyArrangements,true);
 h.context.SuikeDeepSeek.receive(first.id,{ok:true,result:{protocol:2,status:'scope',mode:'personal',basis:'个人通知',candidates:[]}});
 const extract=requests.at(-1);h.context.SuikeDeepSeek.receive(extract.id,{ok:true,result:{protocol:2,status:'ready',courses:[{name:'团组织会议',room:'',teacher:'',audience:{kind:'personal',classIds:[],groupIds:[],evidence:raw},schedule:{dates:[date],weekday:'周一',weeks:'',periods:'',clock:'06:40-06:50'},source:{location:'老师消息',quote:raw}}]}});
 assert.equal(h.getState().courses.length,0);assert.ok(by(h,'deepSeekPreview').textContent.includes('06:40'));assert.ok(!by(h,'deepSeekPreview').textContent.includes('null'));
 await by(h,'deepSeekConfirm').click();assert.equal(h.getState().courses[0].sourceTime,'06:40-06:50');assert.equal(h.getState().courses[0].start,null);assert.deepEqual(h.getState().periods,s.periods);
 await h.document.querySelector('.toast-undo').click();assert.equal(h.getState().courses.length,0);
});

test('a current minute affair has a working progress bar and never shows null period labels',()=>{
 const s=fixture();s.courses=[event('进行中事务','10:20','10:30')];const h=boot(s),card=by(h,'nextCourse').querySelector('.now-card');
 assert.ok(card);assert.ok(!card.textContent.includes('null'));assert.ok(card.textContent.includes('进行中'));
 const bar=card.querySelector('.nc-progress');assert.equal(bar.getAttribute('aria-valuenow'),'30');
});

test('campus reimport preserves independent affairs and detects edits to an imported course changed to clock-only',()=>{
 const S=require('../../portal-import/safe-merge.js'),M=require('../../timetable/dist/model.js');
 const state=fixture(),date=state.courses[0].dates[0],normal={...state.courses[0],id:'portal',name:'校园课程',timeMode:'periods',sourceTime:'',start:1,end:2};state.courses.push(normal);
 const input={source:{system:'just-jwglxt',term:'minute-test'},scope:{from:date,to:date,complete:true},occurrences:[{sourceOccurrenceId:'portal-one',sourceKey:'portal-course',week:M.weekNumber(date,state.settings.startMonday),date,name:normal.name,day:1,start:1,end:2,room:'',teacher:'',sourceTime:'',timeMode:'periods',timeNote:''}]};
 const plan=S.planMerge(state,input,null),saved=S.commitMerge(state,input,null,{planToken:plan.planToken,choices:[]});
 assert.equal(saved.state.courses.length,5);assert.equal(saved.state.courses.find(c=>c.name==='早会').sourceTime,'06:40-06:50');
 const edited=copy(saved.state);Object.assign(edited.courses.find(c=>c.id==='portal'),{start:null,end:null,timeMode:'clock',sourceTime:'06:50-07:00'});
 const next=S.planMerge(edited,input,saved.ledger);assert.equal(next.preview[0].type,'protectedLocal');
 const confirmed=S.commitMerge(edited,input,saved.ledger,{planToken:next.planToken,choices:[]});assert.deepEqual(confirmed.state.courses,edited.courses);
});

test('clock-only facts deduplicate an existing period course by actual time, not period anchors',()=>{
 const state=fixture();state.courses=[{...state.courses[0],id:'existing',name:'已导入课程',timeMode:'periods',start:1,end:2,sourceTime:'08:30-10:00'}];
 const draft={...state.courses[0],id:undefined,start:null,end:null,timeMode:'clock',sourceTime:state.periods[0].start+'-'+state.periods[1].end};
 const plan=AI.plan(state,[draft],'ai-check');assert.equal(plan.added,0);assert.equal(plan.duplicates,1);assert.equal(plan.next.courses.length,1);
});

test('a meeting during a two-period course break is not a classroom conflict and gets its own live progress',()=>{
 const state=fixture(),meeting=event('课间会议','08:45','08:55'),lesson={...meeting,id:'double',name:'连堂课程',timeMode:'periods',start:1,end:2,sourceTime:''};state.courses=[lesson,meeting];
 const h=boot(state),M=h.context.TimetableModel,W=h.context.SuikeWorkspaceEngine;assert.equal(M.conflictsFor(state.courses,meeting,state.periods).length,0);
 assert.equal(W.detectConflicts({...state,courses:[lesson]},meeting).conflicts.length,0);
 h.clock.setNow('2026-10-12T00:50:00Z');h.clock.tick(60000);
 const card=by(h,'nextCourse').querySelector('.now-card');assert.ok(card.textContent.includes('课间会议'));assert.ok(!card.textContent.includes('课间休息'));
 assert.ok(Number(card.querySelector('.nc-progress').getAttribute('aria-valuenow'))>=50);
 const overlap=event('重叠会议','08:40','08:50');assert.equal(M.conflictsFor([lesson,overlap],overlap,state.periods).length,1);
});

