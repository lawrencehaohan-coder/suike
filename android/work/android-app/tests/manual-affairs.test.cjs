const test=require('node:test'),assert=require('node:assert/strict');
const {boot}=require('./interaction-harness.cjs');
const by=(h,id)=>h.document.getElementById(id),field=(h,n)=>by(h,'courseForm').elements.namedItem(n);
function blank(){const s=boot().getState();s.courses=[];s.importLedger=null;s.skipLegacyImportBaseline=true;return s;}
async function open(h){await by(h,'addCourseWeek').click();await by(h,'manualTaskMode').click();}
async function times(h,a,b){by(h,'courseBegin').value=a;by(h,'courseFinish').value=b;await by(h,'courseFinish').fire('change');}
test('manual task adds just the selected date, remains clock-only even on exact period boundaries, and undo restores Settings and records',async()=>{
 const s=blank(),h=boot(s);await open(h);field(h,'name').value='班会';by(h,'manualTaskDate').value='2026-10-15';await times(h,'08:00','08:45');await by(h,'courseForm').fire('submit');
 const next=h.getState(),c=next.courses[0];assert.equal(c.timeMode,'clock');assert.equal(c.start,null);assert.equal(c.end,null);assert.equal(c.sourceTime,'08:00-08:45');assert.equal(c.day,4);assert.deepEqual(c.dates,['2026-10-15']);assert.deepEqual(next.periods,s.periods);assert.deepEqual(next.settings,s.settings);
 await h.document.querySelector('.toast-undo').click();assert.deepEqual(h.getState(),s);
});
test('manual task overlap is visible but allowed; identical one-day tasks are not added twice',async()=>{
 const s=blank();s.courses=[{id:'lesson',name:'物理',dates:['2026-10-12'],day:1,start:1,end:2,room:'',teacher:'',color:'teal'}];const h=boot(s);await open(h);field(h,'name').value='小组会议';await times(h,'08:10','08:20');assert.match(by(h,'manualTaskStatus').textContent,/物理.*时间重叠/);await by(h,'courseForm').fire('submit');assert.equal(h.getState().courses.length,2);await by(h,'courseForm').fire('submit');assert.equal(h.getState().courses.length,2);assert.match(by(h,'formError').textContent,/无需重复添加/);
});
test('invalid, reversed, incomplete and cross-day times never create an affair',async()=>{
 const h=boot(blank()),s=h.getState();await open(h);field(h,'name').value='会议';for(const [a,b] of [['23:55','00:05'],['08:10','08:10'],['','08:10'],['08:10','']]){await times(h,a,b);await by(h,'courseForm').fire('submit');assert.deepEqual(h.getState(),s);assert.equal(by(h,'formError').hidden,false);}by(h,'manualTaskDate').value='2026-02-30';await times(h,'08:10','08:20');await by(h,'courseForm').fire('submit');assert.deepEqual(h.getState(),s);
});
test('duration presets, mode switches and cancellation keep independent drafts and write no timetable data',async()=>{
 const h=boot(blank()),s=h.getState();await open(h);await times(h,'06:40','06:50');await h.document.querySelectorAll('.manual-durations')[0].children[1].click();assert.equal(by(h,'courseFinish').value,'07:10');await by(h,'manualCourseMode').click();assert.equal(by(h,'courseBegin').value,'08:00');await by(h,'manualTaskMode').click();assert.equal(by(h,'courseBegin').value,'06:40');assert.equal(by(h,'courseFinish').value,'07:10');await by(h,'cancelEdit').click();assert.deepEqual(h.getState(),s);assert.equal(h.data.has('suike.manual-affair-times.v1'),false);
});
test('successful task remembers only its clocks; changing date derives its weekday and preserves weekly grid navigation',async()=>{
 const h=boot(blank());await open(h);field(h,'name').value='团日活动';by(h,'manualTaskDate').value='2026-10-21';await times(h,'18:40','18:50');await by(h,'courseForm').fire('submit');assert.deepEqual(JSON.parse(h.data.get('suike.manual-affair-times.v1')),{begin:'18:40',finish:'18:50'});await open(h);assert.equal(by(h,'courseBegin').value,'18:40');assert.equal(by(h,'courseFinish').value,'18:50');assert.equal(by(h,'manualTaskDate').value,'2026-10-21');assert.equal(by(h,'weekGrid').querySelectorAll('.minute-time-mark').length,1);
});
test('empty Week exposes a disabled task toggle and matching action order without a task count',()=>{
 const h=boot(blank()),toggle=by(h,'weekAffairsToggle'),actions=toggle.parentElement;assert.equal(toggle.textContent,'展开本周任务');assert.equal(toggle.disabled,true);assert.equal(actions.children[0],toggle);const group=actions.querySelector('.week-affair-actions');assert.equal(group.children[0],by(h,'clearTimetable'));assert.equal(group.children[1],by(h,'addCourseWeek'));assert.equal(by(h,'weekGrid').querySelectorAll('.minute-gap').length,0);
});
test('an empty weekly cell can switch to a task with the date, start time and typed name retained',async()=>{
 const h=boot(blank());await h.document.querySelectorAll('[data-view]').find(n=>n.dataset.view==='week').click();const cell=by(h,'weekGrid').querySelectorAll('.grid-slot').find(n=>n.dataset.weekDate==='2026-10-14'&&n.dataset.weekPeriod==='3');await cell.click();by(h,'weekQuickName').value='组会';await by(h,'weekQuickTaskMode').click();h.clock.tick(200);assert.equal(field(h,'name').value,'组会');assert.equal(by(h,'manualTaskDate').value,'2026-10-14');assert.equal(by(h,'courseBegin').value,'10:00');assert.equal(by(h,'courseFinish').value,'10:10');await by(h,'courseForm').fire('submit');assert.deepEqual(h.getState().courses[0].dates,['2026-10-14']);
});
