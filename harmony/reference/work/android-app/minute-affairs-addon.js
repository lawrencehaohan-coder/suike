  (function installMinuteAffairs(){
    const Axis=window.SuikeMinuteAxis,oldGrid=renderGrid,oldAgenda=renderAgenda;
    const list=node('dialog','minute-list-dialog');list.id='minuteListDialog';
    const heading=node('div','dialog-heading'),title=node('h2','','当天事务');title.id='minuteListTitle';
    heading.append(title,button('button button-outline','关闭',()=>closeDialog(list)));list.setAttribute('aria-labelledby',title.id);
    const body=node('div','minute-list');list.append(heading,body);document.body.append(list);armDialogCancel(list);
    let expanded=false,shownWeek='';const conflictCache=new Map();
    const toggle=button('text-button week-affairs-toggle','展开本周任务',()=>{expanded=!expanded;renderGrid();});toggle.id='weekAffairsToggle';toggle.setAttribute('aria-controls','weekGrid');toggle.setAttribute('aria-expanded','false');
    const add=$('addCourseWeek'),clear=$('clearTimetable'),toolbar=add.parentElement,actions=node('div','week-affair-actions');
    toolbar.parentElement.classList.add('week-plan-heading');toolbar.classList.add('week-affair-toolbar');
    toolbar.insertBefore(toggle,toolbar.firstChild);toolbar.append(actions);actions.append(clear,add);
    [toggle,clear,add].forEach(item=>item.classList.add('week-toolbar-button'));
    const hint=node('p','week-affair-hint','班会、团日活动等，点“添加”选择“事务”。');hint.id='weekAffairsHint';
    $('weekView').insertBefore(hint,$('weekGrid').parentElement);toggle.setAttribute('aria-describedby',hint.id);
    function conflicts(c,date){const key=c.id+'@'+date;if(!conflictCache.has(key))conflictCache.set(key,courseConflictOn(c,date));return conflictCache.get(key);}
    function detail(c,date){closeDialog(list);setTimeout(()=>openDetail(c.id,date),190);}
    function eventRow(c,date){
      const row=button('minute-event-row','',()=>detail(c,date)),info=node('span','minute-event-info'),time=M.timeRange(c,state.periods),overlaps=conflicts(c,date);
      row.dataset.minuteCourseId=c.id;row.dataset.minuteDate=date;
      info.append(node('strong','minute-event-name',c.name),node('small','minute-event-meta',time.text+(c.room?' · '+c.room:'')));
      if(overlaps.length)info.append(node('small','minute-event-conflict','与'+overlaps.map(other=>other.name).slice(0,2).join('、')+(overlaps.length>2?'等 '+overlaps.length+' 项':'')+'时间重叠'));
      row.append(info,node('span','minute-event-chevron','›'));row.setAttribute('aria-label',c.name+'，'+time.text+(c.room?'，'+c.room:'')+(overlaps.length?'，与'+overlaps.map(other=>other.name).join('、')+'时间重叠':''));return row;
    }
    function showList(date,events){title.textContent=dateText(date)+(events.some(c=>c.timeMode!=='clock')?' · 当天安排':' · 全天任务');body.replaceChildren(...events.map(c=>eventRow(c,date)));showDialog(list);}
    function taskCard(group,date){
      const c=group.events[0],single=group.events.length===1,overlaps=group.events.some(event=>conflicts(event,date).length),ranges=group.events.map(event=>Axis.range(event));
      const begin=Axis.clock(Math.min(...ranges.map(range=>range.start))),finish=Axis.clock(Math.max(...ranges.map(range=>range.end)));
      const card=button('week-course minute-arrangement minute-task-card'+(group.height<76?' is-short':'')+(overlaps?' conflict':''),'',()=>single?openDetail(c.id,date):showList(date,group.events));
      applyColor(card,c.color);card.dataset.minuteCourseId=single?c.id:'';card.dataset.minuteCount=String(group.events.length);card.dataset.minuteDate=date;
      card.append(node('strong','course-name',single?c.name:group.events.length+'项事务'));
      if(single)card.append(node('small','course-room',c.room||'地点待补充'));
      const clock=node('small','course-weeks minute-task-clock');clock.append(node('span','',begin),node('span','',finish));card.append(clock);
      const label=group.events.map(event=>event.name+'，'+M.timeRange(event,state.periods).text+(event.room?'，'+event.room:'')).join('；');card.setAttribute('aria-label',label+(overlaps?'，有时间重叠':''));card.title=card.getAttribute('aria-label');return card;
    }
    renderGrid=function(){
      const result=oldGrid(),grid=$('weekGrid'),end=M.addDays(weekMonday,6);conflictCache.clear();
      if(shownWeek!==weekMonday){shownWeek=weekMonday;expanded=false;}
      const events=state.courses.filter(c=>c.timeMode==='clock'&&c.dates.some(d=>d>=weekMonday&&d<=end));
      toggle.hidden=false;toggle.disabled=!events.length;
      if(!events.length){expanded=false;toggle.textContent='展开本周任务';toggle.setAttribute('aria-expanded','false');delete grid.dataset.minuteAxis;delete grid.dataset.minuteExpanded;return result;}
      const days=WEEKDAYS.map((_,i)=>{const date=M.addDays(weekMonday,i);return {date,events:M.coursesOn(events,date,state.periods)};});
      const axis=Axis.create(state.periods,events,expanded?{expanded:true}:{collapsed:true});
      toggle.textContent=expanded?'收起本周任务':'展开本周任务';toggle.setAttribute('aria-expanded',String(expanded));
      grid.dataset.minuteAxis='true';grid.dataset.minuteExpanded=String(expanded);
      grid.style.gridTemplateRows='48px '+axis.rows.map(row=>row.height+'px').join(' ');
      const regular=[],periodRow=p=>axis.periodRow(p).row;
      // Settings period numbers and teaching-row heights never change.
      Array.from(grid.children).forEach(el=>{const a=el.style.gridArea.split('/').map(Number);if(a[0]<2)return;if(el.classList.contains('week-course')){const first=axis.periodRow(a[0]-1),last=axis.periodRow(a[2]-2);regular.push({el,day:a[1]-1,top:first.y+2,bottom:last.y+last.height-2,events:M.coursesOn(state.courses,M.addDays(weekMonday,a[1]-2),state.periods).filter(c=>!isPending(c)&&c.timeMode!=='clock'&&(el.dataset.weekCourseId?c.id===el.dataset.weekCourseId:c.start<=a[2]-2&&c.end>=a[0]-1))});el.style.gridArea=first.row+' / '+a[1]+' / '+(last.row+1)+' / '+a[3];}else el.style.gridArea=periodRow(a[0]-1)+' / '+a[1];});
      axis.rows.filter(row=>!row.period).forEach(row=>{
        const time=node('div','minute-gap-time'+(expanded?'':' is-folded'));time.style.gridArea=row.row+' / 1';time.setAttribute('aria-label',Axis.clock(row.start)+' 至 '+Axis.clock(row.end)+'，非教学节次');if(expanded)time.append(node('small','',Axis.clock(row.start)),node('small','',Axis.clock(row.end)));grid.append(time);
        for(let day=1;day<=7;day++){const cell=node('div','minute-gap');cell.style.gridArea=row.row+' / '+(day+1);cell.setAttribute('aria-hidden','true');grid.append(cell);}
      });
      days.forEach((day,index)=>{
        if(expanded){
          const blocks=regular.filter(block=>block.day===index+1);
          Axis.taskGroups(axis,day.events).forEach(group=>{const card=taskCard(group,day.date);card.style.gridArea='1 / '+(index+2)+' / -1 / '+(index+3);card.style.top=(48+group.top)+'px';card.style.height=group.height+'px';grid.append(card);blocks.push({el:card,top:group.top,bottom:group.top+group.height,events:group.events,affair:true});});
          Axis.lanes(blocks);const clusters=[],columnWidth=((grid.clientWidth||window.innerWidth||360)-32)/7;
          blocks.slice().sort((a,b)=>a.top-b.top).forEach(block=>{let cluster=clusters[clusters.length-1];if(!cluster||block.top>=cluster.bottom){cluster={top:block.top,bottom:block.bottom,blocks:[]};clusters.push(cluster);}cluster.bottom=Math.max(cluster.bottom,block.bottom);cluster.blocks.push(block);});
          clusters.forEach(cluster=>{
            const members=cluster.blocks,lanes=Math.max(...members.map(block=>block.lanes));
            if(columnWidth/lanes<44&&members.some(block=>block.affair)&&members.some(block=>!block.affair)){
              const unique=new Map();members.forEach(block=>block.events.forEach(c=>unique.set(c.id,c)));const records=Array.from(unique.values()),lessons=records.filter(c=>c.timeMode!=='clock'),affairs=records.filter(c=>c.timeMode==='clock'),primary=lessons[0];
              if(primary){const warning=records.some(c=>conflicts(c,day.date).length),card=button('week-course minute-arrangement minute-course-group'+(warning?' conflict':''),'',()=>showList(day.date,records));
                card.dataset.minuteDate=day.date;card.dataset.minuteCount=String(affairs.length);card.dataset.minuteLessonCount=String(lessons.length);applyColor(card,primary.color);card.style.gridArea='1 / '+(index+2)+' / -1 / '+(index+3);card.style.top=(48+cluster.top)+'px';card.style.height=Math.max(64,cluster.bottom-cluster.top)+'px';
                card.append(node('strong','course-name',lessons.length>1?lessons.length+'门课程':primary.name),node('small','course-room',primary.room||'地点待补充'),node('small','minute-group-more','另 '+affairs.length+' 项事务'));
                const time=M.timeRange(primary,state.periods),clocks=node('small','course-weeks minute-task-clock');clocks.append(node('span','',time.start),node('span','',time.end));card.append(clocks);card.setAttribute('aria-label',records.map(c=>c.name+'，'+M.timeRange(c,state.periods).text).join('；')+'，点开逐项查看');card.title=card.getAttribute('aria-label');members.forEach(block=>block.el.remove());grid.append(card);return;}
            }
            members.forEach(block=>{if(block.lanes>1){block.el.style.width='calc('+(100/block.lanes)+'% - 6px)';block.el.style.marginLeft='calc('+(block.lane*100/block.lanes)+'% + 3px)';block.el.style.justifySelf='start';}});
          });
        }else Axis.indicators(axis,day.events).forEach(group=>{
          const overlaps=group.events.some(c=>conflicts(c,day.date).length),inside=group.events.some(c=>conflicts(c,day.date).some(other=>other.timeMode!=='clock'));
          const mark=node('i','minute-time-mark'+(overlaps?' has-conflict':'')+(inside?' is-in-class':''));
          mark.dataset.minuteDate=day.date;mark.dataset.minuteCount=String(group.events.length);mark.dataset.minuteIds=group.events.map(c=>c.id).join('|');mark.dataset.minuteTop=String(group.y);
          mark.style.gridArea='1 / '+(index+2)+' / -1 / '+(index+3);mark.style.top=(48+group.y)+'px';
          mark.setAttribute('aria-hidden','true');mark.title=group.events.map(c=>c.name+' '+M.timeRange(c,state.periods).text).join('；');grid.append(mark);
        });
        if(day.events.length){const head=Array.from(grid.querySelectorAll('.grid-day'))[index],more=button('minute-day-list','',()=>showList(day.date,day.events));more.append(node('span','minute-day-count',day.events.length+'项'));more.setAttribute('aria-label',dateText(day.date)+'，全天 '+day.events.length+' 项事务');head.append(more);}
      });return result;
    };
    renderAgenda=function(){
      const result=oldAgenda(),courses=selectedCourses().filter(c=>!isPending(c));
      $('agenda').querySelectorAll('.agenda-card').forEach((el,i)=>{
        const c=courses[i];if(!c||c.timeMode!=='clock')return;
        const duration=Axis.range(c).end-Axis.range(c).start,axis=Axis.create(state.periods,[c]);
        el.classList.add('agenda-minute');el.dataset.minuteDuration=String(duration);
        const line=el.querySelector('.course-line');line.classList.add('minute-duration');line.style.height=Math.min(76,duration*axis.unit)+'px';
      });return result;
    };
  })();
