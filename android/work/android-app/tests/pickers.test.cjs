const test=require('node:test'),assert=require('node:assert/strict');
const {boot}=require('./interaction-harness.cjs');
function setup(){
  const h=boot(),prototype=Object.getPrototypeOf(h.document.body);
  prototype.dispatchEvent=function(event){this.fire(event.type,event);return true;};
  prototype.focus=function(){this.ownerDocument.activeElement=this;};
  h.context.Event=class{constructor(type,options){this.type=type;Object.assign(this,options);}preventDefault(){}};
  const panel=h.document.getElementById('suikePicker');panel.close=function(){this.removeAttribute('open');this.fire('close');};
  const by=id=>h.document.getElementById(id),trigger=id=>h.document.querySelectorAll('button').find(b=>b.dataset.pickerFor===id),choice=value=>panel.querySelectorAll('button').find(b=>b.dataset.pickerValue===value);
  return Object.assign(h,{by,panel,trigger,choice,settle(){h.clock.tick(250);}});
}
test('theme choice saves immediately from the independent display settings',async()=>{
  const h=setup(),before=h.getState();await h.trigger('theme').click();
  assert.equal(h.by('suikePickerTitle').textContent,'外观');await h.choice('dark').click();h.settle();
  assert.equal(h.by('theme').value,'dark');assert.equal(h.getState().settings.theme,'dark');assert.equal(h.trigger('theme').querySelector('span').textContent,'深色');
  await h.by('settingsForm').fire('submit');assert.equal(h.getState().settings.theme,'dark');
});
test('cancel keeps values intact, refresh follows programmatic changes and disabled fields stay unavailable',async()=>{
  const h=setup(),before=h.getState();h.by('theme').value='light';h.context.SuikePickers.refresh();await h.trigger('theme').click();
  assert.equal(h.choice('light').getAttribute('aria-selected'),'true');await h.panel.querySelector('.picker-close').click();h.settle();
  assert.equal(h.by('theme').value,'light');assert.deepEqual(h.getState(),before);
  h.by('theme').disabled=true;h.context.SuikePickers.refresh();assert.equal(h.trigger('theme').disabled,true);
  h.context.SuikePickers.open(h.by('theme'));assert.equal(h.panel.getAttribute('open'),null);
});
test('school choices still invoke the original guide update and never modify timetable courses',async()=>{
  const h=setup(),before=h.getState();await h.trigger('teachingSchool').click();await h.choice('njust').click();h.settle();
  assert.equal(h.by('teachingSchool').value,'njust');assert.match(h.trigger('teachingSchool').textContent,/南京理工/);assert.deepEqual(h.getState(),before);
});
test('calendar changes are drafts until confirmed, retain exact dates, and preserve optional clearing',async()=>{
  const h=setup(),before=h.getState();h.by('startMonday').value='2026-08-31';await h.trigger('startMonday').click();
  const day=h.panel.querySelectorAll('button').find(b=>b.dataset.pickerDate==='2026-08-24');await day.click();assert.equal(h.by('startMonday').value,'2026-08-31');
  await h.panel.querySelectorAll('button').find(b=>b.textContent==='确定').click();h.settle();assert.equal(h.by('startMonday').value,'2026-08-24');assert.deepEqual(h.getState(),before);
  await h.trigger('startMonday').click();await h.panel.querySelectorAll('button').find(b=>b.textContent==='清除').click();h.settle();assert.equal(h.by('startMonday').value,'');
});
test('date min and max constraints disable unavailable days and cancellation never saves a draft',async()=>{
  const h=setup();h.by('startMonday').value='2026-08-31';h.by('startMonday').min='2026-08-24';h.by('startMonday').max='2026-08-31';await h.trigger('startMonday').click();
  assert.equal(h.panel.querySelectorAll('button').find(b=>b.dataset.pickerDate==='2026-08-23').disabled,true);
  await h.panel.querySelectorAll('button').find(b=>b.textContent==='取消').click();h.settle();assert.equal(h.by('startMonday').value,'2026-08-31');
});
test('year and month selection changes the calendar without repeated monthly navigation',async()=>{
  const h=setup();h.by('startMonday').value='2026-08-31';await h.trigger('startMonday').click();
  await h.panel.querySelector('.picker-month-label').click();await h.panel.querySelectorAll('button').find(b=>b.getAttribute('aria-label')==='上一年').click();
  await h.panel.querySelectorAll('button').find(b=>b.dataset.pickerMonth==='12').click();
  await h.panel.querySelectorAll('button').find(b=>b.dataset.pickerDate==='2025-12-15').click();
  await h.panel.querySelectorAll('button').find(b=>b.textContent==='确定').click();h.settle();assert.equal(h.by('startMonday').value,'2025-12-15');
});
test('time selection preserves form and persistence boundaries inside the existing period editor',async()=>{
  const h=setup(),before=h.getState();await h.document.querySelector('.period-edit-row').click();h.context.SuikePickers.refresh();
  const source=h.by('periodStart'),original=source.value;await h.trigger('periodStart').click();
  await h.panel.querySelectorAll('button').find(b=>b.dataset.pickerTime==='hour-9').click();await h.panel.querySelectorAll('button').find(b=>b.dataset.pickerTime==='minute-15').click();
  assert.equal(source.value,original);await h.panel.querySelectorAll('button').find(b=>b.textContent==='确定').click();h.settle();
  assert.equal(source.value,'09:15');assert.deepEqual(h.getState(),before);assert.notEqual(h.by('productDialog').getAttribute('open'),null);
});
test('hidden segmented controls are retained and disabled options cannot be selected',async()=>{
  const h=setup();await h.trigger('theme').click();const source=h.by('theme'),before=source.value;h.context.SuikePickers.dismiss();h.settle();
  const option=source.querySelectorAll('option').find(o=>o.value==='dark');option.disabled=true;await h.trigger('theme').click();assert.equal(h.choice('dark').disabled,true);await h.choice('dark').click();assert.equal(source.value,before);
});
test('keyboard navigation starts on an enabled choice when the placeholder is disabled',async()=>{
  const h=setup(),source=h.by('theme');source.value='auto';source.querySelectorAll('option').find(o=>o.value==='auto').disabled=true;
  await h.trigger('theme').click();h.clock.tick(20);assert.equal(h.document.activeElement,h.choice('light'));
  await h.panel.querySelector('.picker-options').fire('keydown',{key:'ArrowDown',target:h.choice('light')});assert.equal(h.document.activeElement,h.choice('dark'));
  await h.document.activeElement.click();h.settle();assert.equal(source.value,'dark');
});
test('navigating to another month keeps calendar days reachable by keyboard',async()=>{
  const h=setup();h.by('startMonday').value='2026-08-31';await h.trigger('startMonday').click();
  await h.panel.querySelectorAll('button').find(b=>b.getAttribute('aria-label')==='下个月').click();
  const first=h.panel.querySelectorAll('button').find(b=>b.dataset.pickerDate==='2026-09-01');assert.equal(first.tabIndex,0);
  await h.panel.querySelector('.picker-calendar').fire('keydown',{key:'ArrowRight',target:first});
  assert.equal(h.document.activeElement.dataset.pickerDate,'2026-09-02');assert.equal(h.by('startMonday').value,'2026-08-31');
});
