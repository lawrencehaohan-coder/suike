  // Shared production rendering for live status, monochrome pixels and compact WEEK LOAD.
  (function installPixelDashboard(){
  const previewHeader=document.querySelector('.app-header'),previewWeekLoad=$('weekLoad');
  previewHeader.append(previewWeekLoad);previewWeekLoad.classList.add('preview-header-load');
  let previewPhase='';
  const originalHeader=renderHeader;
  renderHeader=function(){
    originalHeader();previewPhase=$('headPhase').textContent;
    const todayView=activeView==='today';
    previewHeader.classList.toggle('preview-today-header',todayView);previewWeekLoad.hidden=!todayView;
    if(todayView)['headWeek','headPeriod','headPhase'].forEach(id=>{$(id).textContent='';});
  };
  renderWeekLoad=function(){
    const counts=WEEKDAYS.map((_,index)=>M.coursesOn(state.courses,M.addDays(weekMonday,index)).length);
    const total=counts.reduce((sum,count)=>sum+count,0),wrap=node('div');
    wrap.append(node('p','micro wl-title','WEEK LOAD · '+total+' 节'));
    const bars=node('div','wl-bars');bars.setAttribute('aria-hidden','true');
    counts.forEach((count,index)=>{
      const col=node('span','wl-col'),stack=node('span','preview-load-stack');
      for(let block=0;block<count;block++)stack.append(node('i','preview-load-block'));
      col.append(stack,node('span','wl-label',DOW_LETTERS[index]));bars.append(col);
    });
    wrap.append(bars);previewWeekLoad.replaceChildren(wrap);
    previewWeekLoad.setAttribute('role','img');
    previewWeekLoad.setAttribute('aria-label','本周 '+total+' 门课程，每个方块代表一门；'+counts.map((count,index)=>'星期'+WEEKDAYS[index]+' '+count+' 门').join('，'));
  };
  const originalPips=renderDayStrip;
  renderDayStrip=function(){
    originalPips();
    const days=Array.from($('dayStrip').children);
    days.forEach((day,index)=>{
      const date=M.addDays(weekMonday,index),all=M.coursesOn(state.courses,date);
      const status=course=>date<chinaToday()?'done':date>chinaToday()?'upcoming':isPending(course)?'pending':courseStatus(course,date).className==='current'?'current':courseStatus(course,date).className==='done'?'done':'upcoming';
      let visible=all.slice(0,5);
      const current=all.find(course=>status(course)==='current');
      if(current&&visible.indexOf(current)<0)visible=visible.slice(0,4).concat(current);
      const pips=day.querySelector('.day-pips');
      pips.replaceChildren(...visible.map(course=>node('i','preview-pip-'+status(course))));
      const counts={done:0,current:0,upcoming:0,pending:0};all.forEach(course=>counts[status(course)]++);
      day.setAttribute('aria-label',dateText(date)+'星期'+WEEKDAYS[index]+'，'+all.length+' 门课程；已上 '+counts.done+'，进行中 '+counts.current+'，未上 '+counts.upcoming+(counts.pending?'，时间待确认 '+counts.pending:''));
    });
  };
  function fillPixelBar(progress){
    const ratio=Number(progress.dataset.previewRatio)||0;
    const width=progress.getBoundingClientRect().width||progress.clientWidth||240;
    const columns=Math.max(16,Math.min(160,Math.floor((width+2)/6))),filled=Math.floor(ratio*columns+1e-8);
    progress.style.setProperty('--preview-columns',String(columns));
    const cells=[];
    for(let column=0;column<columns;column++)for(let row=0;row<2;row++)cells.push(node('span','preview-pixel-cell'+(column<filled?' is-filled':'')));
    progress.replaceChildren(...cells);
  }
  const originalNext=renderNext;
  renderNext=function(){
    originalNext();
    renderDayStrip();
    const currentCard=$('nextCourse').querySelector('.now-card');
    if(currentCard){
      const p=chinaNow(),now=Number(p.hour)*60+Number(p.minute);
      const current=currentArrangement(selectedDate,now);
      let text='';
      if(current){
        const range=M.timeRange(current,state.periods),first=state.periods[current.start-1],last=state.periods[current.end-1];
        if(first&&last&&first.start===range.start&&last.end===range.end){
          const slots=state.periods.slice(current.start-1,current.end),active=slots.find(slot=>now>=minutes(slot.start)&&now<minutes(slot.end)),next=slots.find(slot=>minutes(slot.start)>now);
          if(active)text=' · 本节剩 '+(minutes(active.end)-now)+' 分钟';
          else if(next)text=' · 课间休息 '+(minutes(next.start)-now)+' 分钟';
        }
        if(!text)text=' · 剩 '+(minutes(range.end)-now)+' 分钟';
      }
      if(text)currentCard.querySelector('.nc-label').append(node('span','preview-remaining',text));
    }
    document.querySelectorAll('.nc-progress').forEach(progress=>{
      const original=progress.querySelector('i'),ratio=Math.max(0,Math.min(1,parseFloat(original.style.width)/100));
      progress.dataset.previewRatio=String(ratio);progress.classList.add('preview-pixel-progress');
      progress.removeAttribute('aria-hidden');progress.setAttribute('role','progressbar');
      progress.setAttribute('aria-label','本节课程进度');progress.setAttribute('aria-valuemin','0');progress.setAttribute('aria-valuemax','100');progress.setAttribute('aria-valuenow',String(Math.round(ratio*100)));
      progress.title='课程已进行 '+Math.round(ratio*100)+'%';fillPixelBar(progress);
      requestAnimationFrame(()=>{if(progress.isConnected)fillPixelBar(progress);});
    });
  };
  window.addEventListener('resize',()=>document.querySelectorAll('.preview-pixel-progress').forEach(fillPixelBar),{passive:true});
  })();
