const test=require('node:test'),assert=require('node:assert/strict');
const T=require('../course-time-core.js'),P=require('../period-times.js');
const {boot}=require('./interaction-harness.cjs');
const copy=x=>JSON.parse(JSON.stringify(x));
const by=(h,id)=>h.document.getElementById(id);
test('a pending evening course becomes confirmed when both clocks are entered, including reminders and conflict validation',async()=>{
 const initial=boot().getState(),date='2026-10-12';initial.courses=[{id:'pending-lab',name:'实验',room:'A101',teacher:'',day:1,start:null,end:null,timeMode:'pending',timeNote:'19:00开始，结束时间待确认',sourceTime:'',dates:[date],color:'teal'}];initial.importLedger=null;initial.skipLegacyImportBaseline=true;
 const h=boot(initial),before=h.getState();await by(h,'agendaPending').querySelector('button').click();await by(h,'editCourse').click();
 assert.equal(by(h,'courseBegin').value,'19:00');assert.equal(by(h,'courseFinish').value,'');
 by(h,'courseFinish').value='20:05';await by(h,'courseFinish').fire('change');assert.equal(by(h,'pendingTime').checked,false);
 await by(h,'courseForm').fire('submit');const course=h.getState().courses[0];assert.equal(course.timeMode,'clock');assert.equal(course.sourceTime,'19:00-20:05');assert.equal(course.timeNote,undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(h.context.TimetableModel.timeRange(course,h.getState().periods))),{start:'19:00',end:'20:05',text:'19:00–20:05',exact:true});
 assert.equal(h.context.SuikeWorkspaceEngine.actualTime(course,h.getState().periods).confirmed,true);
 assert.equal(h.getState().courses.length,1);assert.equal(h.getState().courses[0].dates[0],date);
 await h.document.querySelector('.toast-undo').click();assert.deepEqual(h.getState(),before);
});
test('pending notes cannot masquerade as a confirmed time and invalid clocks never save',()=>{
 const periods=boot().getState().periods;
 assert.equal(T.resolve(periods,'19:00','',null,null,true,'').timeMode,'pending');
 for(const [a,b] of [['19:00','18:00'],['25:00','26:00'],['19:00','']])assert.throws(()=>T.resolve(periods,a,b,9,10,false,''));
 assert.equal(T.resolve(periods,'08:15','09:20',1,2,false,'').timeMode,'clock');
});
test('legacy daytime portal evidence keeps personal periods, while newly explicit clocks are honored',()=>{
 const h=boot(),state=h.getState(),course=state.courses.find(c=>c.end<=8&&c.sourceTime);
 assert.ok(course);const old=h.context.TimetableModel.timeRange(course,state.periods);assert.equal(old.start,state.periods[course.start-1].start);
 const explicit={...course,timeMode:'clock',sourceTime:'08:15-09:20'};assert.equal(h.context.TimetableModel.timeRange(explicit,state.periods).start,'08:15');
});
test('adding periods 11 and 12 refreshes the grid and course selectors and survives a state round trip',async()=>{
 const h=boot(),original=h.getState();
 for(const [number,a,b] of [[11,'20:50','21:35'],[12,'21:45','22:30']]){
  await by(h,'addPeriod').click();by(h,'periodStart').value=a;by(h,'periodEnd').value=b;await by(h,'productConfirm').click();assert.equal(h.getState().periods.length,number);
 }
 assert.equal(by(h,'weekGrid').querySelectorAll('.grid-time').length,12);assert.equal(by(h,'addPeriod').disabled,false);
 await by(h,'addCourse').click();assert.equal(by(h,'courseForm').elements.namedItem('start').children.length,13);
 const again=boot(h.getState());assert.equal(again.getState().periods[11].end,'22:30');assert.equal(again.document.querySelector('.period-list').children.length,12);
 assert.equal(h.getState().courses.length,original.courses.length);assert.equal(h.document.querySelector('.period-list').textContent.includes('晚课完整时段'),false);
 assert.equal(P.preview(h.getState().periods,[{period:13,start:'22:40',end:'23:25'}]).periods.length,13);
});
test('new periods reject overlap without changing the existing table',async()=>{
 const h=boot(),before=h.getState();await by(h,'addPeriod').click();by(h,'periodStart').value='20:00';by(h,'periodEnd').value='20:45';await by(h,'productConfirm').click();assert.deepEqual(h.getState(),before);assert.match(by(h,'productError').textContent,/重叠/);
});
test('display and media controls live outside the semester form, with the bottom icons preserved',()=>{
 const h=boot();assert.equal(by(h,'theme').closest('#settingsForm'),null);assert.equal(by(h,'glassEnabled').closest('#displaySettings'),by(h,'displaySettings'));assert.ok(by(h,'chooseWallpaperVideo'));assert.ok(by(h,'chooseWallpaperImage'));
 assert.equal(h.document.querySelectorAll('[data-view]').length,3);
});
test('dialogue follow-ups retain original evidence, request a new inspection and never write before confirmation',async()=>{
 const h=boot(),requests=[];Object.assign(h.context.SuikeNative,{getDeepSeekConfig:()=>JSON.stringify({ok:true,configured:true,model:'deepseek-flash'}),requestDeepSeek:(id,action,raw)=>{requests.push({id,action,payload:JSON.parse(raw)});return true;},cancelDeepSeek(){},clearDeepSeekAttachments(){}});
 await by(h,'deepSeekEntry').click();const before=h.getState();by(h,'deepSeekCourseText').value='老师通知：下周安排物理实验';await by(h,'deepSeekParse').click();
 const first=requests.at(-1);h.context.SuikeDeepSeek.receive(first.id,{ok:true,result:{protocol:2,status:'message',message:'可以，请补充老师通知中的具体日期和时间。'}});
 assert.equal(by(h,'deepSeekCourseText').value,'');assert.ok(by(h,'deepSeekChat').textContent.includes('具体日期和时间'));
 by(h,'deepSeekCourseText').value='10月19日，19:00到20:05，我是机械2401班';await by(h,'deepSeekParse').click();const next=requests.at(-1).payload;
 assert.equal(next.text,first.payload.text);assert.equal(next.answers[0].answer,'10月19日，19:00到20:05，我是机械2401班');assert.equal(next.stage,'inspect');assert.equal(next.context.program.maxPeriods,h.getState().periods.length);assert.equal(next.context.conversation.length,3);assert.deepEqual(h.getState(),before);
 await by(h,'deepSeekNewChat').click();assert.equal(by(h,'deepSeekChat').querySelectorAll('.ai-bubble').length,0);assert.deepEqual(h.getState(),before);
});
