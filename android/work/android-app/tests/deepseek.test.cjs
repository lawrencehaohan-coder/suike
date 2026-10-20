const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../deepseek-core.js');
const {boot}=require('./interaction-harness.cjs');
const copy=x=>JSON.parse(JSON.stringify(x));
const course={name:'新增物理实验',dates:['2026-10-19'],start:3,end:4,sourceTime:'',room:'实验楼203',teacher:''};
const ready={status:'ready',courses:[course],notes:['教师未提供。']};
const clarify={status:'clarify',questions:[{id:'date',question:'具体哪天上课？',choices:[]},{id:'section',question:'第几节上课？',choices:[]}]};
async function setup(){
  const h=boot(),requests=[],files=[];let configured=false;
  Object.assign(h.context.SuikeNative,{
    getDeepSeekConfig:()=>JSON.stringify({ok:true,configured,model:'deepseek-flash'}),
    saveDeepSeekConfig:()=>{configured=true;return JSON.stringify({ok:true,configured,model:'deepseek-flash'});},
    clearDeepSeekConfig:()=>{configured=false;return JSON.stringify({ok:true,configured,model:'deepseek-flash'});},
    requestDeepSeek:(id,action,raw)=>{requests.push({id,action,payload:JSON.parse(raw)});return true;},cancelDeepSeek(){},
    pickDeepSeekDocument:id=>{files.push(id);return true;},cancelDeepSeekDocument(){},clearDeepSeekAttachments(){}
  });
  const by=id=>h.document.getElementById(id);
  by('deepSeekApiKey').value='sk-test-fixture-not-real-123456';
  await by('deepSeekSave').click();
  by('deepSeekCourseText').value='新增物理实验，日期和节次待确认';
  const receive=result=>{
    if(result.status==='ready'){
      if(requests.at(-1).payload.stage==='inspect')h.context.SuikeDeepSeek.receive(requests.at(-1).id,{ok:true,result:{protocol:2,status:'scope',mode:'personal',basis:'老师消息',candidates:[]}});
      result={protocol:2,status:'ready',courses:result.courses.map(c=>({name:c.name,room:c.room,teacher:c.teacher,audience:{kind:'personal',classIds:[],groupIds:[],evidence:'老师消息'},schedule:{weeks:'',weekday:'',periods:c.start+'-'+c.end,dates:c.dates,clock:c.sourceTime},source:{location:'文字消息',quote:requests.at(-1).payload.text.slice(0,160)}}))};
    }
    return h.context.SuikeDeepSeek.receive(requests.at(-1).id,{ok:true,action:'parse',result:copy(result)});
  };
  return Object.assign(h,{by,requests,files,receive});
}
test('ambiguous schedules produce questions, never speculative courses',()=>{
  const result=C.normalize(clarify,boot().getState().periods);assert.equal(result.status,'clarify');assert.equal(result.courses,undefined);
  assert.throws(()=>C.normalize({...clarify,courses:[course]},boot().getState().periods),{code:'QUESTIONS_INVALID'});
});
test('impossible dates, missing sections and mixed weekdays cannot enter a preview',()=>{
  const periods=boot().getState().periods;
  for(const bad of [{...course,dates:['2026-02-30']},{...course,start:null},{...course,dates:['2026-10-19','2026-10-20']}])
    assert.throws(()=>C.normalize({status:'ready',courses:[bad]},periods));
});
test('duplicate meetings are skipped without deleting imported courses or ledger metadata',()=>{
  const state=boot().getState(),normalized=C.normalize(ready,state.periods).courses;
  const first=C.plan(state,normalized,'ai-test'),second=C.plan(first.next,normalized,'ai-retry');
  assert.equal(first.added,1);assert.equal(second.added,0);assert.equal(second.duplicates,1);
  assert.deepEqual(first.next.courses.slice(0,state.courses.length),state.courses);
  assert.deepEqual(second.next,first.next);
});
test('key drafts are cleared after saving and never appear in web storage or timetable exports',async()=>{
  const h=await setup();assert.equal(h.by('deepSeekApiKey').value,'');
  assert.ok([...h.data.values()].every(v=>!v.includes('sk-test-fixture')));
  assert.ok(!JSON.stringify(h.getState()).includes('sk-test-fixture'));
});
test('clarification, answer submission and preview are storage no-ops; confirmation is atomic and undoable',async()=>{
  const h=await setup(),before=h.getState();
  await h.by('deepSeekParse').click();assert.equal(h.requests.length,1);
  assert.equal(h.receive(clarify),true);assert.deepEqual(h.getState(),before);assert.equal(h.by('deepSeekQuestions').hidden,false);
  const inputs=h.by('deepSeekQuestions').querySelectorAll('input');inputs[0].value='2026-10-19';inputs[1].value='第3-4节';
  await h.by('deepSeekQuestions').fire('submit');assert.equal(h.requests[1].payload.answers.length,2);
  assert.ok(!JSON.stringify(h.requests[1].payload).includes('sk-test-fixture'));
  assert.equal(h.requests[1].payload.context.periods.length,before.periods.length);
  assert.equal(h.requests[1].payload.context.courses,undefined);
  assert.equal(h.receive(ready),true);assert.deepEqual(h.getState(),before);assert.equal(h.by('deepSeekPreview').hidden,false);
  await h.by('deepSeekConfirm').click();
  assert.equal(h.getState().courses.length,before.courses.length+1);
  await h.document.querySelector('.toast-undo').click();assert.deepEqual(h.getState(),before);
});
test('cancelled responses, request errors and edited input never change the timetable',async()=>{
  const h=await setup(),before=h.getState();
  await h.by('deepSeekParse').click();const id=h.requests.at(-1).id;await h.by('deepSeekCancel').click();
  assert.equal(h.context.SuikeDeepSeek.receive(id,{ok:true,result:ready}),false);assert.deepEqual(h.getState(),before);
  await h.by('deepSeekParse').click();assert.equal(h.context.SuikeDeepSeek.receive(h.requests.at(-1).id,{ok:false,code:'BALANCE'}),false);
  assert.match(h.by('deepSeekStatus').textContent,/余额不足/);assert.deepEqual(h.getState(),before);
  await h.by('deepSeekParse').click();const editedId=h.requests.at(-1).id;h.by('deepSeekCourseText').value='修改后的通知';
  await h.by('deepSeekCourseText').fire('input');assert.equal(h.context.SuikeDeepSeek.receive(editedId,{ok:true,result:ready}),false);
});
test('a changed timetable blocks both an in-flight draft and a stale confirmation',async()=>{
  const h=await setup();await h.by('deepSeekParse').click();h.receive(ready);
  h.by('termLabel').value='外部变更';const settings=h.document.getElementById('settingsForm');
  h.by('startMonday').value='2026-08-31';h.by('totalWeeks').value='26';h.by('theme').value='light';
  await settings.fire('submit');const changed=h.getState();
  await h.by('deepSeekConfirm').click();assert.deepEqual(h.getState(),changed);
  assert.match(h.by('deepSeekStatus').textContent,/发生变化/);
});
test('requests time out cleanly and unselected draft rows cannot be imported',async()=>{
  const h=await setup(),before=h.getState();await h.by('deepSeekParse').click();h.clock.tick(96000);
  assert.match(h.by('deepSeekStatus').textContent,/超时/);assert.equal(h.by('deepSeekParse').disabled,false);assert.deepEqual(h.getState(),before);
  await h.by('deepSeekParse').click();h.receive(ready);h.by('deepSeekPreviewList').querySelector('input').checked=false;
  await h.by('deepSeekConfirm').click();assert.deepEqual(h.getState(),before);assert.match(h.by('deepSeekStatus').textContent,/至少选择/);
});
test('Settings contains only the small entry; the full form opens in its own page',async()=>{
  const h=await setup();
  assert.equal(h.by('deepSeekSettings').parentElement.tagName,'DIALOG');
  assert.equal(h.by('deepSeekEntry').closest('#settingsView'),h.by('settingsView'));
  assert.ok(!h.by('settingsView').textContent.includes('课程助手'));
  assert.ok(!h.by('settingsView').textContent.includes('先问清楚'));
  await h.by('deepSeekEntry').click();assert.equal(h.by('deepSeekDialog').getAttribute('open'),'');
});
test('file reads stay local until parse; visual attachment identity survives clarification',async()=>{
  const h=await setup(),before=h.getState(),message=h.by('deepSeekCourseText').value;await h.by('deepSeekFile').click();
  assert.equal(h.requests.length,0);
  assert.equal(h.context.SuikeDeepSeek.receiveDocument(h.files.at(-1),{text:'2026年10月19日 第3-4节 物理实验',error:'none',name:'实验通知.pdf',attachmentId:'fixture-attachment'}),true);
  assert.deepEqual(h.getState(),before);assert.equal(h.requests.length,0);
  assert.equal(h.by('deepSeekCourseText').value,message);
  await h.by('deepSeekParse').click();
  assert.equal(h.requests.at(-1).payload.attachmentId,'fixture-attachment');
  assert.ok(![...h.data.values()].some(s=>s.includes('fixture-attachment')));
  h.receive(clarify);
  const answers=h.by('deepSeekQuestions').querySelectorAll('input');answers[0].value='2026-10-19';answers[1].value='第3-4节';
  await h.by('deepSeekQuestions').fire('submit');
  assert.equal(h.requests.at(-1).payload.attachmentId,'fixture-attachment');
  assert.deepEqual(h.getState(),before);
});
test('an attachment alone starts parsing and imported text never replaces the teacher message',async()=>{
  const h=await setup(),before=h.getState();h.by('deepSeekCourseText').value='';await h.by('deepSeekFile').click();
  h.context.SuikeDeepSeek.receiveDocument(h.files.at(-1),{text:'OCR text must not enter the editor',error:'none',name:'课表.xlsx',attachmentId:'structured-workbook'});
  assert.equal(h.by('deepSeekCourseText').value,'');assert.equal(h.by('deepSeekFile').disabled,false);
  await h.by('deepSeekParse').click();assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].payload.text,'');assert.equal(h.requests[0].payload.attachmentId,'structured-workbook');
  assert.equal(h.by('deepSeekStatus').textContent.includes('粘贴课程'),false);assert.deepEqual(h.getState(),before);
});
test('removing an attachment retains pasted teacher instructions and cancels stale parse replies',async()=>{
  const h=await setup(),message='老师通知：下周实验时间待确认\n请按附件安排。';h.by('deepSeekCourseText').value=message;
  await h.by('deepSeekFile').click();h.context.SuikeDeepSeek.receiveDocument(h.files.at(-1),{text:'',error:'none',name:'通知.png',attachmentId:'original-image'});
  await h.by('deepSeekParse').click();const id=h.requests.at(-1).id;
  const detach=h.document.querySelectorAll('button').find(b=>b.textContent==='移除附件');await detach.click();
  assert.ok(h.by('deepSeekChat').textContent.includes(message));assert.equal(h.context.SuikeDeepSeek.receive(id,{ok:true,result:ready}),false);
  await h.by('deepSeekParse').click();assert.equal(h.requests.at(-1).payload.attachmentId,'');assert.equal(h.requests.at(-1).payload.text,message);
});
test('cancelled file selection and stale file callbacks preserve the current course text',async()=>{
  const h=await setup(),original=h.by('deepSeekCourseText').value;
  await h.by('deepSeekFile').click();const id=h.files.at(-1);
  h.context.SuikeDeepSeek.receiveDocument(id,{text:'',error:'CANCELLED'});assert.equal(h.by('deepSeekCourseText').value,original);
  await h.by('deepSeekFile').click();const stale=h.files.at(-1);await h.by('deepSeekCancel').click();
  assert.equal(h.context.SuikeDeepSeek.receiveDocument(stale,{text:'stale',error:'none'}),false);
  assert.equal(h.by('deepSeekCourseText').value,original);
});
