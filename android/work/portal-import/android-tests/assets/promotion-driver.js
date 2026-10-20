/* Instrumentation only. Never bundled in the user APK. */
(function(){
  var nativeDate=window.Date,base,origin,nativeBridge;
  function clock(iso){
    base=nativeDate.parse(iso);origin=performance.now();
    class TestDate extends nativeDate {
      constructor(...args){super(...(args.length?args:[TestDate.now()]));}
      static now(){return base+performance.now()-origin;}
    }
    window.Date=TestDate;
    document.getElementById('thisWeek').click();document.querySelector('[data-view="today"]').click();
  }
  function theme(value){document.getElementById('theme').value=value;document.getElementById('settingsForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));document.querySelector('[data-view="today"]').click();}
  function dashboard(){
    var graph=document.getElementById('weekLoad'),bar=document.querySelector('.preview-pixel-progress'),current=document.querySelector('.preview-pip-current'),remaining=document.querySelector('.preview-remaining');
    return {graphInHeader:graph.parentElement===document.querySelector('.app-header'),blocks:Array.from(graph.querySelectorAll('.preview-load-stack')).map(function(n){return n.children.length;}),graphHidden:graph.hidden,
      rightHeaderEmpty:['headWeek','headPeriod','headPhase'].every(function(id){return document.getElementById(id).textContent==='';}),
      progressCells:bar?bar.children.length:0,filled:bar?bar.querySelectorAll('.is-filled').length:0,ink:bar?getComputedStyle(bar.querySelector('.is-filled')).backgroundColor:'',
      currentGreen:current?getComputedStyle(current).backgroundColor:'',breathe:current?getComputedStyle(current).animationDuration:'',remaining:remaining?remaining.textContent:'',
      theme:document.documentElement.dataset.theme,overflow:document.documentElement.scrollWidth>innerWidth,
      clock:document.getElementById('clock').textContent,holdMs:SuikeWeekInteractionsUI.holdMs,hasNativeHaptic:typeof SuikeNative.weekLongPressHaptic==='function',noDemo:!document.getElementById('pixelPreviewProgress')&&!window.__suikePixelPreview};
  }
  function week(){document.querySelector('[data-view="week"]').click();document.getElementById('thisWeek').click();window.scrollTo(0,0);}
  function quickAdd(){
    week();var slot=Array.from(document.querySelectorAll('.wk-empty-slot')).find(function(n){return n.dataset.weekDate==='2026-10-14'&&n.dataset.weekPeriod==='3';});
    if(!slot)throw Error('QUICK_SLOT_MISSING');slot.click();
    var end=document.getElementById('weekQuickEnd');if(end.value!=='4')throw Error('QUICK_DEFAULT_LENGTH');
    document.getElementById('weekQuickName').value='安卓快速新增测试';document.getElementById('weekQuickRoom').value='测试实验室';document.getElementById('weekQuickTeacher').value='测试教师';document.getElementById('productConfirm').click();return true;
  }
  function points(){
    week();var grid=document.getElementById('weekGrid').getBoundingClientRect();if(grid.top>120)window.scrollTo(0,window.scrollY+grid.top-120);var cards=Array.from(document.querySelectorAll('.week-course'));
    var source=cards.find(function(n){return n.dataset.weekDate==='2026-10-12'&&n.style.gridArea.split('/')[0].trim()==='2';});
    var target=cards.find(function(n){return n.dataset.weekDate==='2026-10-13'&&n.style.gridArea.split('/')[0].trim()==='4';});
    if(!source||!target)throw Error('DRAG_COURSES_MISSING');
    var a=source.getBoundingClientRect(),b=target.getBoundingClientRect(),nav=document.querySelector('.bottom-nav').getBoundingClientRect();
    window.__qaDragBefore=window.__suikeQA.state();window.__qaDragIds={source:source.dataset.weekCourseId,target:target.dataset.weekCourseId};
    return {sx:a.left+a.width/2,sy:a.top+28,tx:b.left+b.width/2,ty:b.top+28,width:innerWidth,height:innerHeight,navTop:nav.top};
  }
  function wrapHaptic(){nativeBridge=window.SuikeNative;window.__qaHapticCalls=0;window.SuikeNative={weekLongPressHaptic:function(){window.__qaHapticCalls++;nativeBridge.weekLongPressHaptic();}};return true;}
  function restore(){if(nativeBridge)window.SuikeNative=nativeBridge;window.Date=nativeDate;return true;}
  function exchange(){
    var old=window.__qaDragBefore,ids=window.__qaDragIds,s=window.__suikeQA.state(),a=old.courses.find(function(c){return c.id===ids.source;}),b=old.courses.find(function(c){return c.id===ids.target;});
    return {sourceMoved:s.courses.some(function(c){return c.name===a.name&&c.dates.includes('2026-10-13')&&c.start===3&&c.end===4;}),
      targetMoved:s.courses.some(function(c){return c.name===b.name&&c.dates.includes('2026-10-12')&&c.start===1&&c.end===2;}),
      futureSourceKept:s.courses.some(function(c){return c.name===a.name&&c.dates.includes('2026-10-19')&&c.start===1;}),
      futureTargetKept:s.courses.some(function(c){return c.name===b.name&&c.dates.includes('2026-10-20')&&c.start===3;}),
      meetings:s.courses.reduce(function(n,c){return n+c.dates.length;},0),phase:SuikeWeekInteractionsUI.snapshot().phase,ghost:!!document.querySelector('.wk-drag-ghost'),dialog:document.getElementById('courseDialog').open,hapticCalls:window.__qaHapticCalls};
  }
  window.__qaPromotion={clock:clock,theme:theme,dashboard:dashboard,week:week,quickAdd:quickAdd,points:points,wrapHaptic:wrapHaptic,restore:restore,exchange:exchange};
})();
