  // All changes share the existing workspace transaction and undo.
  (function installWeekInteractions(){
    const WI=window.SuikeWeekInteractions,grid=$('weekGrid');
    const deps=()=>({model:M,workspace:Workspace,options:productOptions()});
    const reduced=()=>window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const xy=event=>({x:event.clientX,y:event.clientY});
    const scrollTop=()=>window.scrollY||document.documentElement.scrollTop||0;
    const scrollLeft=()=>window.scrollX||0;
    const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width||r.right-r.left,height:r.height||r.bottom-r.top,right:r.right,bottom:r.bottom};};
    let drag=null,frame=null,scrollFrame=null,suppressClickUntil=0,settling=[];
    const live=node('div','wk-drag-message');live.hidden=true;live.setAttribute('role','status');live.setAttribute('aria-live','polite');document.body.append(live);
    function haptic(){try{if(window.SuikeNative&&typeof SuikeNative.weekLongPressHaptic==='function')SuikeNative.weekLongPressHaptic();else if(navigator.vibrate)navigator.vibrate(25);}catch(_){} }
    function motion(element,frames,ms,done){
      if(!element||reduced()||typeof element.animate!=='function'){if(done)done();return;}
      const animation=element.animate(frames,{duration:ms,easing:'cubic-bezier(.22,1,.36,1)'});settling.push(animation);
      const finish=()=>{settling=settling.filter(a=>a!==animation);if(done)done();};
      animation.addEventListener('finish',finish,{once:true});animation.addEventListener('cancel',finish,{once:true});
    }
    function stopSettling(){settling.slice().forEach(a=>a.cancel());settling=[];}
    function locateCourse(id,date){return Array.from(grid.querySelectorAll('.week-course')).find(el=>el.dataset.weekCourseId===id&&el.dataset.weekDate===date);}
    function clearMarks(){grid.querySelectorAll('.wk-drop-target').forEach(el=>el.classList.remove('wk-drop-target'));grid.querySelectorAll('.wk-drop-invalid').forEach(el=>el.classList.remove('wk-drop-invalid'));}
    function cancelFrames(){if(frame!==null&&window.cancelAnimationFrame)cancelAnimationFrame(frame);if(scrollFrame!==null&&window.cancelAnimationFrame)cancelAnimationFrame(scrollFrame);frame=null;scrollFrame=null;}
    function releaseVisual(current){
      cancelFrames();clearMarks();document.documentElement.classList.remove('wk-dragging');live.hidden=true;
      if(current)current.source.classList.remove('wk-drag-source');
    }
    function ghostPosition(current,point){
      current.left=point.x-current.offsetX;current.top=point.y-current.offsetY;
      current.ghost.style.transform='translate3d('+current.left+'px,'+current.top+'px,0)';
    }
    function settleGhost(current,destination){
      const target=destination||rect(current.source);
      current.source.classList.add('wk-landing');current.ghost.firstChild.style.transform='scale(1)';
      motion(current.ghost.firstChild,[{transform:'scale(1.03)'},{transform:'scale(1)'}],220);
      motion(current.ghost,[{transform:'translate3d('+current.left+'px,'+current.top+'px,0)'},{transform:'translate3d('+target.left+'px,'+target.top+'px,0)'}],220,()=>{current.ghost.remove();current.source.classList.remove('wk-landing');});
    }
    function cancelDrag(reason){
      const current=drag;drag=null;releaseVisual(current);if(!current)return;
      suppressClickUntil=Date.now()+500;
      if(reason==='escape'||reason==='cancel'||reason==='outside')settleGhost(current);
      else current.ghost.remove();
    }
    function slotAt(point){
      if(!drag)return null;
      if(window.innerHeight&&(point.y<0||point.y>=window.innerHeight||point.x<0||point.x>=window.innerWidth))return null;
      if(drag.navBounds&&point.y>=drag.navBounds.top&&point.y<drag.navBounds.bottom)return null;
      const x=point.x+scrollLeft(),y=point.y+scrollTop();
      return drag.slots.find(slot=>x>=slot.box.left&&x<slot.box.right&&y>=slot.box.top&&y<slot.box.bottom)||null;
    }
    function targetAt(point){
      const slot=slotAt(point);if(!slot)return null;
      const start=slot.period-drag.rowOffset,key=slot.date+':'+slot.period+':'+start;
      if(drag.target&&drag.target.key===key)return drag.target;
      try{return {key,slot,plan:WI.planMove(state,{courseId:drag.courseId,date:drag.date,targetDate:slot.date,targetStart:start,hitPeriod:slot.period},deps())};}
      catch(error){return {key,slot,error};}
    }
    function markTarget(target){
      clearMarks();
      if(!target){live.textContent='移到课表内松手 · 只调整本周这一次';return;}
      if(target.error){target.slot.el.classList.add('wk-drop-invalid');live.textContent=target.error.message;return;}
      const plan=target.plan;
      if(plan.kind==='noop'){live.textContent='松手保留原位 · 拖到其他时段移动';return;}
      const first=plan.placements[0];
      if(plan.kind==='swap'){
        const other=locateCourse(plan.targetCourseId,first.date);if(other)other.classList.add('wk-drop-target');
        live.textContent='松手交换两门课程 · 只调整本周这一次';
      }else{
        drag.slots.filter(s=>s.date===first.date&&s.period>=first.start&&s.period<=first.end).forEach(s=>s.el.classList.add('wk-drop-target'));
        live.textContent='移到周'+WEEKDAYS[M.dayOf(first.date)-1]+'第 '+first.start+(first.end===first.start?'':'–'+first.end)+' 节 · 松手保存';
      }
    }
    function updateDrag(point){
      if(!drag)return;drag.point=point;ghostPosition(drag,point);const target=targetAt(point);
      if(!target||!drag.target||target.key!==drag.target.key){drag.target=target;markTarget(target);}
    }
    function scrollStep(){
      scrollFrame=null;if(!drag||typeof window.scrollBy!=='function')return;
      const height=window.innerHeight||document.documentElement.clientHeight,point=drag.point;
      const speed=point.y<72?-Math.min(12,(72-point.y)/5):point.y>height-72?Math.min(12,(point.y-height+72)/5):0;
      if(speed){window.scrollBy(0,speed);updateDrag(point);}scrollFrame=requestAnimationFrame(scrollStep);
    }
    function begin(candidate,point){
      if(activeView!=='week'||!candidate.source.parentElement)return false;stopSettling();
      const course=state.courses.find(c=>c.id===candidate.courseId&&c.dates.includes(candidate.date));if(!course)return false;
      const bounds=rect(candidate.source),ghost=node('div','wk-drag-ghost');ghost.setAttribute('aria-hidden','true');
      const card=candidate.source.cloneNode(true);card.removeAttribute('id');card.removeAttribute('aria-label');card.tabIndex=-1;card.className='week-course wk-ghost-card';
      ghost.style.width=bounds.width+'px';ghost.style.height=bounds.height+'px';ghost.append(card);document.body.append(ghost);
      const slots=Array.from(grid.querySelectorAll('.grid-slot')).map(el=>{const box=rect(el);return {el,date:el.dataset.weekDate,period:Number(el.dataset.weekPeriod),box:{left:box.left+scrollLeft(),right:box.right+scrollLeft(),top:box.top+scrollTop(),bottom:box.bottom+scrollTop()}};});
      // Non-teaching rows can be compressed between lessons. Derive the held
      // section from the real slot geometry rather than dividing by 76px.
      const sourceSlots=slots.filter(s=>s.date===candidate.date&&s.period>=course.start&&s.period<=course.end),heldY=point.y+scrollTop();
      const distance=s=>Math.max(s.box.top-heldY,heldY-s.box.bottom,0),held=sourceSlots.slice().sort((a,b)=>distance(a)-distance(b))[0];
      drag={source:candidate.source,courseId:course.id,date:candidate.date,base:Workspace.fingerprint(state),ghost,slots,point,target:null,navBounds:window.innerHeight?rect(document.querySelector('.bottom-nav')):null,
        offsetX:point.x-bounds.left,offsetY:point.y-bounds.top,rowOffset:held?held.period-course.start:0};
      ['lg-pressed','lg-hovered'].forEach(c=>candidate.source.classList.remove(c));
      candidate.source.classList.add('wk-drag-source');document.documentElement.classList.add('wk-dragging');
      live.hidden=false;haptic();updateDrag(point);
      motion(card,[{transform:'scale(1)',opacity:.8},{transform:'scale(1.03)',opacity:1}],160);
      if(window.innerHeight&&typeof window.scrollBy==='function')scrollFrame=requestAnimationFrame(scrollStep);
      return true;
    }
    function move(point){if(!drag)return;drag.point=point;if(frame!==null)return;frame=requestAnimationFrame(()=>{frame=null;if(drag)updateDrag(drag.point);});}
    function drop(point){
      if(!drag)return;updateDrag(point);const current=drag,target=current.target;
      const oldRects=new Map();if(target&&target.plan)target.plan.placements.forEach(p=>{const old=locateCourse(p.sourceCourseId,p.fromDate);if(old)oldRects.set(p.sourceCourseId,rect(old));});
      drag=null;releaseVisual(current);suppressClickUntil=Date.now()+500;
      if(!target||target.error||target.plan.kind==='noop'){
        settleGhost(current);if(target&&target.error)showToast(target.error.message);return;
      }
      if(current.base!==Workspace.fingerprint(state)){settleGhost(current);showToast('课表已改变，请重新拖动');return;}
      const plan=target.plan;
      if(!productCommit(plan.state,plan.kind==='swap'?'已交换本周这两次课':'已移动本周这次课',true)){settleGhost(current);return;}
      const first=plan.placements[0],landing=locateCourse(first.courseId,first.date);
      if(landing){
        landing.classList.add('wk-landing');const destination=rect(landing);
        current.ghost.firstChild.style.transform='scale(1)';motion(current.ghost.firstChild,[{transform:'scale(1.03)'},{transform:'scale(1)'}],240);
        motion(current.ghost,[{transform:'translate3d('+current.left+'px,'+current.top+'px,0)'},{transform:'translate3d('+destination.left+'px,'+destination.top+'px,0)'}],240,()=>{current.ghost.remove();landing.classList.remove('wk-landing');});
      }else current.ghost.remove();
      plan.placements.slice(1).forEach(p=>{
        const item=locateCourse(p.courseId,p.date),from=oldRects.get(p.sourceCourseId);if(!item||!from)return;const to=rect(item);
        motion(item,[{transform:'translate('+(from.left-to.left)+'px,'+(from.top-to.top)+'px)'},{transform:'translate(0,0)'}],260);
      });
    }
    const gesture=SuikeWeekGesture.create({onActivate:begin,onMove:move,onDrop:drop,onCancel:cancelDrag});

    function quickAdd(date,start){
      if(WI.coursesAt(state,date,start).length)return;
      const base=Workspace.fingerprint(state),id='local-week-'+(window.crypto&&crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2));
      let name,room,teacher,end,clockBegin,clockFinish,saved=false;
      productOpen('添加课程',()=>{
        if(saved)return;if(base!==Workspace.fingerprint(state))throw Error('课表已改变，请重新选择空白时段');
        const timing=window.SuikeCourseTime.resolve(state.periods,clockBegin.value,clockFinish.value,start,Number(end.value),false,'');
        const plan=WI.planAdd(state,Object.assign({id,date,name:name.value,room:room.value,teacher:teacher.value},timing),deps());
        if(productCommit(plan.state,'已添加课程',true)){saved=true;closeDialog(productDialog);}
      },{eyebrow:'课程详情',confirm:'添加课程',subtitle:dateText(date,true)+' · 星期'+WEEKDAYS[M.dayOf(date)-1]+' · 第 '+start+' 节开始'});
      name=pfField(productBody,'课程名称','', 'text','weekQuickName');name.required=true;name.maxLength=80;name.placeholder='例如：示例力学';
      end=pfSelect(productBody,'结束节次',Array.from({length:WI.maxPeriod(state)-start+1},(_,i)=>{const n=start+i,p=state.periods[n-1];return [String(n),'第 '+n+' 节'+(p?' · '+p.end:'')];}),String(WI.defaultEnd(state,date,start)),'weekQuickEnd');
      const fields=node('div','pf-grid2');productBody.append(fields);
      room=pfField(fields,'教室（选填）','','text','weekQuickRoom');room.maxLength=80;room.placeholder='例如：教学楼 201';
      teacher=pfField(fields,'教师（选填）','','text','weekQuickTeacher');teacher.maxLength=40;
      const clocks=node('div','pf-grid2');productBody.append(clocks);
      clockBegin=pfField(clocks,'开始时间',state.periods[start-1].start,'time','weekQuickBegin');clockFinish=pfField(clocks,'结束时间',state.periods[Number(end.value)-1].end,'time','weekQuickFinish');
      end.addEventListener('change',()=>{clockBegin.value=state.periods[start-1].start;clockFinish.value=state.periods[Number(end.value)-1].end;});name.focus();
      const mode=node('div','pf-seg manual-schedule-mode'),lesson=button('pf-seg-btn active','',()=>{}),affair=button('pf-seg-btn','',()=>{const draft={name:name.value,room:room.value};closeDialog(productDialog);setTimeout(()=>SuikeManualSchedule.open(date,state.periods[start-1].start,draft),190);});
      mode.setAttribute('role','group');mode.setAttribute('aria-label','添加类型');lesson.append(node('strong','','课程'));lesson.setAttribute('aria-pressed','true');affair.append(node('strong','','事务'));affair.id='weekQuickTaskMode';affair.setAttribute('aria-pressed','false');mode.append(lesson,affair);productBody.insertBefore(mode,productBody.firstChild);

    }
    const originalDetail=openDetail;
    openDetail=function(id,date){
      if(Date.now()<suppressClickUntil)return;
      originalDetail(id,date);
      Array.from($('courseDetail').children).forEach(row=>{if(row.firstChild&&row.firstChild.textContent==='保存方式')row.remove();});
    };
    const originalGrid=renderGrid;
    renderGrid=function(){
      gesture.cancel('render');const result=originalGrid();
      grid.querySelectorAll('.grid-slot').forEach(slot=>{
        const area=slot.style.gridArea.split('/').map(Number),period=area[0]-1,date=M.addDays(weekMonday,area[1]-2);
        slot.dataset.weekDate=date;slot.dataset.weekPeriod=String(period);
        if(WI.coursesAt(state,date,period).length)return;
        slot.classList.add('wk-empty-slot');slot.removeAttribute('aria-hidden');slot.setAttribute('role','button');slot.setAttribute('tabindex','0');
        slot.setAttribute('aria-label',dateText(date,true)+'星期'+WEEKDAYS[M.dayOf(date)-1]+'第 '+period+' 节，添加课程');
        const add=()=>{if(activeView==='week'&&Date.now()>=suppressClickUntil)quickAdd(date,period);};slot.addEventListener('click',add);
        slot.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();add();}});
      });
      grid.querySelectorAll('.week-course').forEach(item=>{
        if(item.classList.contains('week-conflict-group'))return;
        const area=item.style.gridArea.split('/').map(Number),date=M.addDays(weekMonday,area[1]-2);
        const candidates=M.coursesOn(state.courses,date).filter(c=>c.start===area[0]-1&&c.end===area[2]-2&&c.name===item.querySelector('.course-name').textContent);
        if(candidates.length!==1)return;item.dataset.weekCourseId=candidates[0].id;item.dataset.weekDate=date;
        item.title+='；长按 0.5 秒拖动，仅调整本周这一次';
      });
      const hint=document.querySelector('.week-hint');hint.textContent='点空白添加 · 长按课程 0.5 秒拖动 · 移到已有课程交换';
      return result;
    };
    function candidate(event){const source=event.target&&event.target.closest&&event.target.closest('.week-course');return source&&!source.classList.contains('minute-arrangement')&&source.dataset.weekCourseId?{source,courseId:source.dataset.weekCourseId,date:source.dataset.weekDate}:null;}
    grid.addEventListener('pointerdown',event=>{if(event.pointerType==='touch'||event.button!==0)return;const item=candidate(event);if(item)gesture.start(item,xy(event),event.pointerId);});
    document.addEventListener('pointermove',event=>{if(event.pointerType!=='touch')gesture.move(xy(event),event.pointerId);},{passive:true});
    document.addEventListener('pointerup',event=>{if(event.pointerType!=='touch')gesture.end(xy(event),event.pointerId);});
    document.addEventListener('pointercancel',event=>{if(event.pointerType!=='touch')gesture.cancel('cancel');});
    grid.addEventListener('touchstart',event=>{if(event.touches.length!==1){gesture.cancel('cancel');return;}const item=candidate(event);if(item)gesture.start(item,xy(event.touches[0]),event.touches[0].identifier);},{passive:true});
    document.addEventListener('touchmove',event=>{
      if(event.touches.length!==1){gesture.cancel('cancel');return;}
      if(gesture.phase==='dragging'&&event.cancelable)event.preventDefault();gesture.move(xy(event.touches[0]),event.touches[0].identifier);
    },{passive:false});
    document.addEventListener('touchend',event=>{const touch=Array.from(event.changedTouches).find(t=>t.identifier===gesture.pointerId);if(touch){if(gesture.phase==='dragging'&&event.cancelable)event.preventDefault();gesture.end(xy(touch),touch.identifier);}} ,{passive:false});
    document.addEventListener('touchcancel',()=>gesture.cancel('cancel'));
    grid.addEventListener('contextmenu',event=>{if(candidate(event))event.preventDefault();});
    grid.addEventListener('click',event=>{if(gesture.phase==='dragging'||Date.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
    document.addEventListener('keydown',event=>{if(event.key==='Escape')gesture.cancel('escape');});
    window.addEventListener('blur',()=>gesture.cancel('blur'));window.addEventListener('resize',()=>gesture.cancel('resize'));
    document.addEventListener('visibilitychange',()=>{if(document.hidden)gesture.cancel('hidden');});
    window.SuikeWeekInteractionsUI={holdMs:gesture.holdMs,snapshot:()=>({phase:gesture.phase,dragging:!!drag})};
  })();
