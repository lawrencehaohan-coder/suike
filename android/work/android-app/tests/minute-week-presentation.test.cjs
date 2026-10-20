const test=require('node:test'),assert=require('node:assert/strict');
const Axis=require('../minute-axis.js');const {boot}=require('./interaction-harness.cjs');
const date='2026-10-12',by=(h,id)=>h.document.getElementById(id),copy=x=>JSON.parse(JSON.stringify(x));
const event=(id,a,b,day=1)=>({id,name:id,day,start:null,end:null,timeMode:'clock',sourceTime:a+'-'+b,dates:[day===1?date:'2026-10-13'],room:'F104',teacher:'',color:'teal'});
const lesson=(start=9,end=10)=>({id:'lesson',name:'示例时政',day:1,start,end,sourceTime:'',dates:[date],room:'A101',teacher:'',color:'teal'});
function fixture(events=[event('团日活动','18:40','18:50')],regular=[lesson()]){const s=boot().getState();s.courses=regular.concat(events);s.importLedger=null;s.skipLegacyImportBaseline=true;return s;}

test('folded gaps add zero height, teaching rows keep their Settings height, and event positions stay ordered',()=>{
 const s=fixture([event('早会','00:01','00:02'),event('课间','08:46','08:50'),event('团日','18:40','18:50'),event('夜间','23:50','23:59')]),before=copy(s.periods),a=Axis.create(s.periods,s.courses,{collapsed:true});
 assert.equal(a.rows.length,s.periods.length);assert.equal(a.height,s.periods.length*76);assert.ok(a.rows.filter(r=>r.period).every(r=>r.height===76));assert.deepEqual(s.periods,before);
 for(const c of s.courses.filter(c=>c.timeMode==='clock')){const p=a.place(c);assert.ok(p.top>=0&&p.height>=0&&p.top+p.height<=a.height+.001);}
 const positions=s.courses.filter(c=>c.timeMode==='clock').map(c=>a.place(c).top);assert.deepEqual(positions,positions.slice().sort((a,b)=>a-b));
});
test('default Week has only horizontal indicators; the button expands course-style cards in their time positions without changing state',async()=>{
 const h=boot(fixture()),grid=by(h,'weekGrid'),before=h.getState();assert.equal(by(h,'weekAffairsToggle').getAttribute('aria-expanded'),'false');assert.equal(grid.querySelectorAll('.minute-task-card').length,0);assert.equal(grid.querySelectorAll('.minute-time-mark').length,1);assert.equal(grid.querySelectorAll('.minute-gap-entry').length,0);
 await by(h,'weekAffairsToggle').click();const card=grid.querySelector('.minute-task-card');assert.ok(card.classList.contains('week-course'));assert.ok(card.textContent.includes('团日活动'));assert.ok(card.textContent.includes('18:40'));assert.ok(card.textContent.includes('18:50'));assert.equal(card.style.height,'64px');assert.equal(grid.querySelectorAll('.minute-time-mark').length,0);assert.equal(by(h,'weekAffairsToggle').getAttribute('aria-expanded'),'true');
 const a=Axis.create(before.periods,before.courses,{expanded:true}),placement=Axis.cardPlacement(a,before.courses[1]);assert.equal(Number(card.style.top.slice(0,-2)),48+placement.top);assert.equal(grid.querySelectorAll('.minute-day-cards').length,0);
 await card.click();assert.match(by(h,'courseDetail').textContent,/团日活动/);assert.deepEqual(h.getState(),before);
});
test('one-minute and long affairs have readable bounded cards, with blank early and late hours compressed',()=>{
 const s=fixture([event('短会','06:40','06:41'),event('长会','20:45','23:55')],[]),a=Axis.create(s.periods,s.courses,{expanded:true}),short=Axis.cardPlacement(a,s.courses[0]),long=Axis.cardPlacement(a,s.courses[1]);
 assert.equal(short.height,64);assert.equal(long.height,160);assert.ok(a.height<1200);assert.ok(short.top>=0&&long.top+long.height<=a.height+.001);assert.ok(a.rows.filter(r=>r.period).every(r=>r.height===76));
});
test('a real overlap retains a warning, while an affair between two teaching periods does not become a false conflict',async()=>{
 const h=boot(fixture([event('课内会议','08:10','08:20'),event('课间会','08:45','08:55')],[lesson(1,2)])),grid=by(h,'weekGrid');assert.equal(grid.querySelectorAll('.minute-time-mark').filter(el=>el.classList.contains('has-conflict')).length,1);assert.equal(grid.querySelector('.week-course').style.width,'');
 await grid.querySelector('.minute-day-list').click();const rows=by(h,'minuteListDialog').querySelectorAll('.minute-event-row');assert.equal(rows.length,2);assert.ok(rows[0].textContent.includes('时间重叠'));assert.ok(!rows[1].textContent.includes('时间重叠'));
 await by(h,'minuteListDialog').close();await by(h,'weekAffairsToggle').click();assert.ok(grid.querySelectorAll('.minute-task-card').every(card=>Number(card.style.height.slice(0,-2))>=64));
});
test('dense tasks merge only their visual entry and preserve every name and exact time in the daily list',async()=>{
 const s=fixture([event('一','18:00','18:10'),event('二','18:10','18:20'),event('三','18:05','18:15'),event('四','18:40','18:50',2)],[]),h=boot(s),grid=by(h,'weekGrid');assert.equal(grid.querySelectorAll('.minute-time-mark').length,2);assert.equal(grid.querySelector('.minute-time-mark').dataset.minuteCount,'3');
 await by(h,'weekAffairsToggle').click();const grouped=grid.querySelector('.minute-task-card');assert.equal(grouped.dataset.minuteCount,'3');assert.ok(grouped.textContent.includes('3项事务'));await grouped.click();assert.equal(by(h,'minuteListDialog').querySelectorAll('.minute-event-row').length,3);for(const name of ['一','二','三'])assert.ok(by(h,'minuteListDialog').textContent.includes(name));
});
test('collapse, rerender and weekly navigation do not edit Settings or course records, and a new week starts folded',async()=>{
 const h=boot(fixture()),before=h.getState();await by(h,'weekAffairsToggle').click();await by(h,'weekAffairsToggle').click();assert.equal(by(h,'weekGrid').querySelectorAll('.minute-task-card').length,0);assert.equal(by(h,'weekGrid').querySelectorAll('.minute-time-mark').length,1);assert.deepEqual(h.getState(),before);
 await by(h,'weekAffairsToggle').click();await by(h,'nextWeek').click();assert.equal(by(h,'weekGrid').querySelectorAll('.minute-time-mark').length,0);assert.equal(by(h,'weekAffairsToggle').disabled,true);await by(h,'prevWeek').click();assert.equal(by(h,'weekAffairsToggle').getAttribute('aria-expanded'),'false');assert.deepEqual(h.getState().periods,before.periods);
});
test('the same recurring task appears once per matching date and empty weekdays gain no phantom cards',async()=>{
 const c=event('重复','18:40','18:50');c.dates.push('2026-10-19');const h=boot(fixture([c],[]));assert.equal(by(h,'weekAffairsToggle').textContent,'展开本周任务');await by(h,'weekAffairsToggle').click();assert.equal(by(h,'weekGrid').querySelectorAll('.minute-task-card').length,1);await by(h,'nextWeek').click();assert.equal(by(h,'weekAffairsToggle').getAttribute('aria-expanded'),'false');assert.equal(by(h,'weekGrid').querySelectorAll('.minute-time-mark').length,1);
});
test('dragging a lower lesson across a folded lunch break retains its held Settings period offset',async()=>{
 const s=fixture([event('午会','12:00','12:10')],[lesson(4,5)]),h=boot(s);await h.document.querySelectorAll('[data-view]').find(n=>n.dataset.view==='week').click();const grid=by(h,'weekGrid'),axis=Axis.create(s.periods,s.courses,{collapsed:true});
 const box=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});grid.querySelectorAll('.grid-slot').forEach(el=>{const r=axis.periodRow(Number(el.dataset.weekPeriod)),day=h.context.TimetableModel.dayOf(el.dataset.weekDate);el.getBoundingClientRect=()=>box(32+(day-1)*48,48+r.y,48,76);});
 const course=grid.querySelector('.week-course'),first=axis.periodRow(4),last=axis.periodRow(5);course.getBoundingClientRect=()=>box(33,50+first.y,46,last.y+last.height-first.y-4);
 const point=(target,x,y)=>({target,clientX:x,clientY:y,button:0,pointerId:9,pointerType:'mouse'});await grid.fire('pointerdown',point(course,56,48+last.y+20));h.clock.tick(500);await h.document.fire('pointermove',point(course,104,48+axis.periodRow(8).y+20));h.clock.tick(16);await h.document.fire('pointerup',point(course,104,48+axis.periodRow(8).y+20));
 const moved=h.getState().courses.find(c=>c.name==='示例时政'&&c.day===2);assert.ok(moved);assert.equal(moved.start,7);assert.equal(moved.end,8);assert.deepEqual(h.getState().periods,s.periods);
});


test('narrow-screen course and task overlaps keep a full-column readable group and every original record',async()=>{
 const h=boot(fixture([event('课内会','08:10','08:20'),event('课间会','08:45','08:55')],[lesson(1,2)])),before=h.getState();await by(h,'weekAffairsToggle').click();const group=by(h,'weekGrid').querySelector('.minute-course-group');assert.ok(group);assert.ok(group.textContent.includes('示例时政'));assert.equal(group.dataset.minuteCount,'2');assert.ok(!group.style.width);await group.click();const rows=by(h,'minuteListDialog').querySelectorAll('.minute-event-row');assert.equal(rows.length,3);assert.ok(rows.some(row=>row.dataset.minuteCourseId==='lesson'));assert.deepEqual(h.getState(),before);
});

