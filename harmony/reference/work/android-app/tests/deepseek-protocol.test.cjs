const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../deepseek-protocol.js'),{boot}=require('./interaction-harness.cjs');
const copy=x=>JSON.parse(JSON.stringify(x));
const scope=P.inspect({protocol:2,status:'scope',mode:'classes',basis:'表格包含多个专业和班级',candidates:[
 {id:'c1',label:'机械2401 · 机械工程',className:'机械2401',major:'机械工程',groups:[{id:'g1',label:'第1批'},{id:'g2',label:'第2批'}]},
 {id:'c2',label:'机械2402 · 机械工程',className:'机械2402',major:'机械工程',groups:[]},
 {id:'c3',label:'电气2401 · 电气工程',className:'电气2401',major:'电气工程',groups:[]}
]});
const personal=P.inspect({protocol:2,status:'scope',mode:'personal',basis:'不限定班级的老师消息',candidates:[]});
const quote='高数 机械2401 第1-16周(单周) 周三 第3-4节';
const fact={name:'高数',room:'A201',teacher:'',audience:{kind:'listed',classIds:['c1'],groupIds:[],evidence:'机械2401'},schedule:{weeks:'第1-16周(单周)',weekday:'周三',periods:'第3-4节',dates:[],clock:''},source:{location:'课表!A3:F3',quote}};
const context=()=>({scope,target:{classId:'c1',groupId:'g1'},startMonday:'2026-08-31',totalWeeks:26,periods:boot().getState().periods,hasAttachment:true});
const normalize=(facts,ctx=context())=>P.normalize({protocol:2,status:'ready',courses:facts},ctx);
test('odd/even weeks and exclusions expand locally across month/year boundaries',()=>{
 const r=normalize([fact]);assert.equal(r.courses[0].dates.length,8);assert.equal(r.courses[0].dates[0],'2026-09-02');assert.equal(r.courses[0].dates.at(-1),'2026-12-09');
 assert.deepEqual(P.weeks('1-8周（双周），除第4周',26),[2,6,8]);
 assert.deepEqual(P.weeks('1-4,6-8周',26),[1,2,3,4,6,7,8]);
 assert.deepEqual(P.weeks('第十一至第十六周',26),[11,12,13,14,15,16]);
 const ctx=context();ctx.startMonday='2026-12-28';const f=copy(fact);f.schedule.weeks='1-2周';f.schedule.weekday='周五';assert.deepEqual(normalize([f],ctx).courses[0].dates,['2027-01-01','2027-01-08']);
});
test('other majors, classes and laboratory batches are excluded before schedule validation',()=>{
 const a=copy(fact);a.audience.classIds=['c2'];a.schedule=null;
 const b=copy(fact);b.audience.classIds=['c3'];b.schedule=null;
 const c=copy(fact);c.audience.groupIds=['g2'];c.schedule=null;
 const r=normalize([fact,a,b,c]);assert.equal(r.courses.length,1);assert.equal(r.excluded,3);
});
test('unknown audiences, invented identities and unproved shared courses cannot pass',()=>{
 for(const a of [{kind:'unknown',classIds:[],groupIds:[],evidence:'无法读清'},{kind:'listed',classIds:['invented'],groupIds:[],evidence:'未知班'},{kind:'shared',classIds:[],groupIds:[],evidence:'公共课'}]){
  const f=copy(fact);f.audience=a;assert.throws(()=>normalize([f]));
 }
 const f=copy(fact);f.audience={kind:'shared',classIds:[],groupIds:[],evidence:'全体班级'};assert.equal(normalize([f]).courses.length,1);
});
test('a laboratory restriction cannot silently become a class-wide course',()=>{
 const f=copy(fact);f.audience.evidence='机械2401 第2批';assert.throws(()=>normalize([f]),{code:'SCOPE_UNCERTAIN'});
 f.audience.groupIds=['g2'];assert.throws(()=>normalize([f]),{code:'SCOPE_EMPTY'});
});
test('remembered identities match exact class, major and group, never a generic class number',()=>{
 assert.equal(P.remembered(scope,{classNumber:1}),null);
 assert.deepEqual(P.remembered(scope,{className:'机械2401',major:'机械工程',group:'第1批'}),{classId:'c1',groupId:'g1'});
 assert.equal(P.remembered(scope,{className:'机械2401',major:'电气工程',group:'第1批'}),null);
 assert.equal(P.remembered(scope,{className:'机械2401',major:'机械工程',group:'第3批'}),null);
});
test('scope protocol rejects duplicated IDs and personal mode carrying class candidates',()=>{
 const s=copy(scope);s.candidates[1].id='c1';assert.throws(()=>P.inspect(s));
 assert.throws(()=>P.inspect({...scope,mode:'personal'}));
 assert.throws(()=>P.inspect({...personal,protocol:1}));
});
test('wrong weekday, AI-calculated dates and out-of-term dates are blocked',()=>{
 for(const changes of [{dates:['2026-09-03']},{dates:['2026-09-02']},{weeks:'',dates:['2027-09-01']}]){
  const f=copy(fact);Object.assign(f.schedule,changes);assert.throws(()=>normalize([f]));
 }
 const f=copy(fact);f.schedule.weeks='';f.schedule.dates=['2026-10-14'];assert.deepEqual(normalize([f]).courses[0].dates,['2026-10-14']);
});
test('time ranges must match configured periods, including exact clock-only input',()=>{
 const ctx=context(),f=copy(fact);f.schedule.periods='';f.schedule.clock=ctx.periods[2].start+'-'+ctx.periods[3].end;
 assert.equal(normalize([f],ctx).courses[0].start,null);assert.equal(normalize([f],ctx).courses[0].timeMode,'clock');
 f.schedule.periods='1-2';assert.throws(()=>normalize([f],ctx),{code:'TIME_MISMATCH'});
 f.schedule.clock='';f.schedule.periods='1,3';assert.throws(()=>normalize([f],ctx),{code:'PERIOD_INVALID'});
});
test('source quotes for pasted messages must occur in the actual input',()=>{
 const f=copy(fact);f.audience={kind:'personal',classIds:[],groupIds:[],evidence:'老师通知'};
 const ctx={...context(),scope:personal,target:null,hasAttachment:false,sourceText:quote};assert.equal(normalize([f],ctx).courses.length,1);
 ctx.sourceText='另一条不相关通知';assert.throws(()=>normalize([f],ctx),{code:'SOURCE_INVALID'});
 ctx.sourceText=quote;f.name='编造的课程名称';assert.throws(()=>normalize([f],ctx),{code:'SOURCE_INVALID'});
});
async function setup(){
 const h=boot(),requests=[];Object.assign(h.context.SuikeNative,{getDeepSeekConfig:()=>JSON.stringify({ok:true,configured:true,model:'deepseek-flash'}),requestDeepSeek:(id,action,raw)=>{requests.push({id,action,payload:JSON.parse(raw)});return true;},cancelDeepSeek(){},clearDeepSeekAttachments(){}});
 const by=id=>h.document.getElementById(id);await by('deepSeekEntry').click();by('deepSeekCourseText').value=quote;
 const receive=result=>h.context.SuikeDeepSeek.receive(requests.at(-1).id,{ok:true,result:copy(result)});
 return Object.assign(h,{by,requests,receive});
}
test('class and group choices precede extraction; scope confirmation itself does not write state',async()=>{
 const h=await setup(),before=h.getState();await h.by('deepSeekParse').click();assert.equal(h.requests[0].payload.stage,'inspect');
 h.receive(scope);assert.equal(h.requests.length,1);assert.equal(h.by('deepSeekQuestions').hidden,false);assert.deepEqual(h.getState(),before);
 h.by('deepSeekClassSelect').value='c1';await h.by('deepSeekClassSelect').fire('change');h.by('deepSeekGroupSelect').value='g1';
 await h.by('deepSeekQuestions').fire('submit');assert.equal(h.requests.at(-1).payload.stage,'extract');assert.equal(h.requests.at(-1).payload.target.classId,'c1');assert.deepEqual(h.getState(),before);
 const other=copy(fact);other.audience.classIds=['c2'];h.receive({protocol:2,status:'ready',courses:[fact,other]});assert.equal(h.by('deepSeekPreviewList').querySelectorAll('input').length,1);assert.deepEqual(h.getState(),before);
 await h.by('deepSeekConfirm').click();assert.equal(h.getState().productSettings.aiIdentity.className,'机械2401');assert.equal(h.getState().courses.length,before.courses.length+1);
 await h.document.querySelector('.toast-undo').click();assert.deepEqual(h.getState(),before);
});
test('valid remembered class bypasses repeated questions and can be changed before importing',async()=>{
 const h=await setup(),next=h.getState();next.productSettings=h.context.SuikeProductCore.settings(next);next.productSettings.aiIdentity={major:'机械工程',className:'机械2401',group:'第1批'};
 h.context.SuikeFeatures.commitState(next,'test fixture');await h.by('deepSeekParse').click();h.receive(scope);
 assert.equal(h.requests.at(-1).payload.stage,'extract');assert.equal(h.requests.at(-1).payload.target.groupId,'g1');
 h.receive({protocol:2,status:'ready',courses:[fact]});await h.by('deepSeekChangeScope').click();assert.equal(h.by('deepSeekPreview').hidden,true);assert.equal(h.by('deepSeekQuestions').hidden,false);
});
test('invalid facts are sent back for repair, capped at two attempts without speculative imports',async()=>{
 const h=await setup(),before=h.getState();await h.by('deepSeekParse').click();h.receive(personal);
 const f=copy(fact);f.audience={kind:'personal',classIds:[],groupIds:[],evidence:'老师通知'};f.schedule.weeks='';f.schedule.dates=['2026-02-30'];
 for(let i=0;i<3;i++)h.receive({protocol:2,status:'ready',courses:[f]});
 assert.equal(h.requests.length,4);assert.equal(h.by('deepSeekPreview').hidden,true);assert.deepEqual(h.getState(),before);assert.match(h.by('deepSeekStatus').textContent,/日期不存在/);
});
