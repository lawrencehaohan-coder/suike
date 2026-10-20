const test=require('node:test'),assert=require('node:assert/strict');
const {boot,evaluate,html}=require('./interaction-harness.cjs');
const status=h=>JSON.parse(evaluate(h.context,'JSON.stringify(SuikeWeekInteractionsUI.snapshot())'));
const clone=v=>JSON.parse(JSON.stringify(v));
async function week(){const h=boot();await h.document.querySelectorAll('[data-view]').find(el=>el.dataset.view==='week').click();geometry(h);return h;}
function geometry(h){
 const box=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
 h.document.getElementById('weekGrid').querySelectorAll('.grid-slot').forEach(el=>{const a=el.style.gridArea.split('/').map(Number);el.getBoundingClientRect=()=>box(32+(a[1]-2)*48,48+(a[0]-2)*76,48,76);});
 h.document.getElementById('weekGrid').querySelectorAll('.week-course').forEach(el=>{const a=el.style.gridArea.split('/').map(Number);el.getBoundingClientRect=()=>box(33+(a[1]-2)*48,50+(a[0]-2)*76,46,(a[2]-a[0])*76-4);});
}
const courseAt=(h,date,start)=>h.document.getElementById('weekGrid').querySelectorAll('.week-course').find(el=>el.dataset.weekDate===date&&Number(el.style.gridArea.split('/')[0])-1===start);
const slotAt=(h,date,period)=>h.document.getElementById('weekGrid').querySelectorAll('.grid-slot').find(el=>el.dataset.weekDate===date&&Number(el.dataset.weekPeriod)===period);
const pointer=(target,x,y)=>({target,clientX:x,clientY:y,button:0,pointerId:1,pointerType:'mouse'});
async function start(h,el){await h.document.getElementById('weekGrid').fire('pointerdown',pointer(el,56,70));}

test('existing course detail removes only the irrelevant storage explanation',async()=>{
 const h=await week(),el=courseAt(h,'2026-10-12',1);await el.click();
 const text=h.document.getElementById('courseDetail').textContent;
 assert.equal(text.includes('保存方式'),false);assert.equal(text.includes('编辑或删除仅影响这台设备'),false);
 assert.ok(text.includes('上课时间'));assert.ok(text.includes('教室'));assert.ok(text.includes('教师'));assert.ok(text.includes('调课 / 按次修改'));
});

test('empty-slot add pre-fills the day and period, validates the name, adds once and can undo',async()=>{
 const h=await week(),before=h.getState(),slot=slotAt(h,'2026-10-14',3);await slot.click();
 assert.equal(h.document.getElementById('weekQuickEnd').value,'4');
 const confirm=h.document.getElementById('productConfirm');await confirm.click();
 assert.match(h.document.getElementById('productError').textContent,/请填写课程名称/);assert.deepEqual(h.getState(),before);
 h.document.getElementById('weekQuickName').value='测试课程🧪';h.document.getElementById('weekQuickRoom').value='实验楼 207';h.document.getElementById('weekQuickTeacher').value='李老师';
 await confirm.click();await confirm.click();const after=h.getState(),added=after.courses.find(c=>c.name==='测试课程🧪');
 assert.deepEqual(added.dates,['2026-10-14']);assert.deepEqual([added.day,added.start,added.end,added.room,added.teacher],[3,3,4,'实验楼 207','李老师']);
 assert.equal(after.courses.length,before.courses.length+1);
 await h.document.querySelector('.toast-undo').click();assert.deepEqual(h.getState(),before);
});

test('500ms mouse long-press swaps occurrences, suppresses the release click and undoes both together',async()=>{
 const h=await week(),before=clone(h.getState()),el=courseAt(h,'2026-10-12',1),id=el.dataset.weekCourseId,target=courseAt(h,'2026-10-13',3),otherId=target.dataset.weekCourseId;
 const vibrations=[];h.context.navigator.vibrate=ms=>{vibrations.push(ms);return true;};
 await start(h,el);h.clock.tick(499);assert.equal(status(h).phase,'pending');assert.deepEqual(vibrations,[]);assert.equal(h.document.querySelector('.wk-drag-ghost'),null);
 h.clock.tick(1);assert.equal(status(h).phase,'dragging');assert.deepEqual(vibrations,[25]);assert.ok(el.classList.contains('wk-drag-source'));
 await h.document.fire('pointermove',pointer(el,104,220));h.clock.tick(16);
 assert.match(h.document.querySelector('.wk-drag-message').textContent,/交换/);
 await h.document.fire('pointerup',pointer(el,104,220));const after=h.getState();
 assert.equal(status(h).phase,'idle');assert.equal(h.document.querySelector('.wk-drag-ghost'),null);
 const original=before.courses.find(c=>c.id===id),other=before.courses.find(c=>c.id===otherId);
 assert.ok(after.courses.some(c=>c.name===original.name&&c.dates.includes('2026-10-13')&&c.start===3));
 assert.ok(after.courses.some(c=>c.name===other.name&&c.dates.includes('2026-10-12')&&c.start===1));
 await courseAt(h,'2026-10-13',3).click();assert.equal(h.document.getElementById('courseDialog').getAttribute('open'),null);
 await h.document.querySelector('.toast-undo').click();assert.deepEqual(h.getState(),before);
});

test('touch scrolling before the hold threshold stays normal; active touch cancellation restores the unchanged schedule',async()=>{
 const h=await week(),before=h.getState(),el=courseAt(h,'2026-10-12',1),grid=h.document.getElementById('weekGrid');
 const touch=(x,y)=>({identifier:7,clientX:x,clientY:y});let prevented=0;
 await grid.fire('touchstart',{target:el,touches:[touch(56,70)]});h.clock.tick(200);
 await h.document.fire('touchmove',{touches:[touch(56,90)],cancelable:true,preventDefault(){prevented++;}});h.clock.tick(1000);
 assert.equal(status(h).phase,'idle');assert.equal(prevented,0);assert.deepEqual(h.getState(),before);
 await grid.fire('touchstart',{target:el,touches:[touch(56,70)]});h.clock.tick(500);assert.equal(status(h).phase,'dragging');
 await h.document.fire('touchmove',{touches:[touch(152,220)],cancelable:true,preventDefault(){prevented++;}});assert.equal(prevented,1);
 await h.document.fire('touchcancel');assert.equal(status(h).phase,'idle');assert.equal(h.document.querySelector('.wk-drag-ghost'),null);assert.deepEqual(h.getState(),before);
});

test('storage failure during a drop keeps the schedule and releases all dragging UI',async()=>{
 const h=await week(),before=h.getState(),el=courseAt(h,'2026-10-12',1);
 const setItem=h.context.localStorage.setItem;h.context.localStorage.setItem=(key,value)=>{if(key==='suike.timetable.v1')throw Error('quota');return setItem(key,value);};
 await start(h,el);h.clock.tick(500);await h.document.fire('pointerup',pointer(el,152,220));
 assert.deepEqual(h.getState(),before);assert.equal(status(h).phase,'idle');assert.equal(h.document.querySelector('.wk-drag-ghost'),null);
 assert.match(h.document.getElementById('toast').textContent,/未能保存/);
});

test('drop and swap run short transform animations; reduced motion has a nonanimated path',async()=>{
 const h=await week(),animations=[],originalCreate=h.document.createElement;
 function install(element){
   element.animate=(frames,options)=>{
     const listeners={};animations.push({frames,options});
     const id=h.context.setTimeout(()=>listeners.finish&&listeners.finish(),options.duration);
     return {addEventListener(type,fn){listeners[type]=fn;},cancel(){h.context.clearTimeout(id);if(listeners.cancel)listeners.cancel();}};
   };
 }
 const visit=el=>{install(el);el.children.forEach(visit);};visit(h.document);
 h.document.createElement=function(tag){const el=originalCreate.call(this,tag);install(el);return el;};
 const el=courseAt(h,'2026-10-12',1);await start(h,el);h.clock.tick(500);await h.document.fire('pointerup',pointer(el,104,220));
 assert.deepEqual(animations.map(a=>a.options.duration),[160,240,240,260]);assert.ok(animations.every(a=>a.frames.every(f=>f.transform)));
 assert.ok(h.document.querySelector('.wk-drag-ghost'));h.clock.tick(260);assert.equal(h.document.querySelector('.wk-drag-ghost'),null);assert.equal(h.document.querySelector('.wk-landing'),null);
 assert.match(html,/@media\(prefers-reduced-motion:reduce\)/);assert.match(html,/touch-action:pan-y/);
});
