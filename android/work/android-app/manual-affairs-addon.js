  // One-day minute affairs share the existing form, transaction, undo and pickers.
  (function installManualAffairs(){
    const form=$('courseForm'),grid=form.querySelector('.form-grid'),oldOpen=openEdit,Time=window.SuikeCourseTime,Axis=window.SuikeMinuteAxis;
    const field=name=>form.elements.namedItem(name),key='suike.manual-affair-times.v1';let creating=false,task=false,contextDate='',initialBegin='',drafts={};
    const mode=node('div','pf-seg manual-schedule-mode');mode.id='manualScheduleMode';mode.setAttribute('role','group');mode.setAttribute('aria-label','添加类型');
    const courseButton=button('pf-seg-btn active','',()=>switchMode(false)),taskButton=button('pf-seg-btn','',()=>switchMode(true));
    courseButton.id='manualCourseMode';taskButton.id='manualTaskMode';courseButton.append(node('strong','','课程'));taskButton.append(node('strong','','事务'));mode.append(courseButton,taskButton);
    form.insertBefore(mode,grid);
    const dateInput=pfField(grid,'日期','','date','manualTaskDate');dateInput.parentElement.classList.add('field-full','manual-task-only');grid.insertBefore(dateInput.parentElement,grid.children[1]);
    ['day','start','end','teacher','weeks','color'].forEach(name=>field(name).closest('.field').classList.add('manual-course-only'));
    $('pendingTime').parentElement.classList.add('manual-course-only');
    const durations=node('div','manual-durations field-full manual-task-only');durations.setAttribute('role','group');durations.setAttribute('aria-label','事务时长');
    [10,30,60].forEach(n=>{const item=button('inst-btn',n===60?'1 小时':n+' 分钟',()=>{try{const begin=Axis.minute($('courseBegin').value),end=begin+n;if(end>=1440)throw Error();$('courseFinish').value=Axis.clock(end);refresh();}catch(_){status.textContent='请先选开始时间；跨天事务请分两天添加。';status.hidden=false;}});item.dataset.minutes=String(n);durations.append(item);});
    grid.insertBefore(durations,$('confirmedStartField'));
    const status=node('p','manual-task-status field-full manual-task-only');status.id='manualTaskStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');grid.append(status);
    const saveButton=Array.from(form.querySelectorAll('button')).find(item=>item.getAttribute('type')==='submit');
    function validDate(value){try{return M.iso(M.parseISO(value))===value;}catch(_){return false;}}
    function memory(){try{const v=JSON.parse(localStorage.getItem(key));if(v&&Time.valid(v.begin)&&Time.valid(v.finish)&&v.begin<v.finish)return v;}catch(_){}return null;}
    function defaults(){const last=memory();if(last&&!initialBegin)return last;let begin=initialBegin;
      if(!begin){if(contextDate===chinaToday()){const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());begin=Axis.clock(Math.min(1425,Math.ceil(Axis.minute(p)/5)*5));}else begin=last?last.begin:'18:40';}
      return {begin,finish:Axis.clock(Math.min(1439,Axis.minute(begin)+10))};}
    function snapshot(){return {begin:$('courseBegin').value,finish:$('courseFinish').value,date:dateInput.value};}
    function switchMode(value){
      if(!creating)return;drafts[task?'task':'course']=snapshot();task=value;form.dataset.manualKind=task?'task':'course';
      courseButton.classList.toggle('active',!task);taskButton.classList.toggle('active',task);courseButton.setAttribute('aria-pressed',String(!task));taskButton.setAttribute('aria-pressed',String(task));
      const saved=drafts[task?'task':'course']||(task?defaults():null);if(saved){$('courseBegin').value=saved.begin;$('courseFinish').value=saved.finish;if(saved.date)dateInput.value=saved.date;}
      dateInput.required=task;mode.hidden=false;field('name').parentElement.firstChild.textContent=task?'事务名称':'课程名称';field('name').placeholder=task?'例如：班会、团日活动':'例如：示例力学';
      field('room').parentElement.firstChild.textContent=task?'地点（选填）':'教室 / 地点';field('room').parentElement.classList.toggle('field-full',task);$('formTitle').textContent=task?'添加事务':'添加课程';form.querySelector('.eyebrow').textContent=task?'临时安排':'课程安排';saveButton.textContent=task?'添加事务':'保存课程';
      if(task){$('pendingTime').checked=false;['start','end'].forEach(n=>{field(n).required=false;});$('courseBegin').required=true;$('courseFinish').required=true;}
      else{$('courseBegin').required=false;$('courseFinish').required=false;}
      refresh();
    }
    function refresh(){if(window.SuikePickers)SuikePickers.refresh();if(!creating||!task)return;status.hidden=true;dateInput.setAttribute('aria-invalid',String(!validDate(dateInput.value)));
      try{const begin=$('courseBegin').value,finish=$('courseFinish').value;Time.resolve(state.periods,begin,finish,null,null,false,'');if(!validDate(dateInput.value))return;
        const duration=Axis.minute(finish)-Axis.minute(begin);Array.from(durations.children).forEach(item=>item.setAttribute('aria-pressed',String(Number(item.dataset.minutes)===duration)));
        const candidate={id:'manual-preview',name:field('name').value||'事务',day:M.dayOf(dateInput.value),dates:[dateInput.value],start:null,end:null,timeMode:'clock',sourceTime:begin+'-'+finish};
        const overlaps=M.conflictsFor(state.courses,candidate,state.periods);status.textContent=overlaps.length?'与「'+overlaps.slice(0,2).map(c=>c.name).join('、')+'」时间重叠；仍可添加。':'仅添加这一天 · '+duration+' 分钟';status.hidden=false;
      }catch(_){status.textContent='结束时间须晚于开始时间；跨天事务请分两天添加。';status.hidden=false;}}
    [dateInput,$('courseBegin'),$('courseFinish')].forEach(input=>{input.addEventListener('change',refresh);});
    openEdit=function(course){creating=!course;task=false;drafts={};contextDate=selectedDate;initialBegin='';form.dataset.manualKind='course';oldOpen(course);mode.hidden=!creating;dateInput.required=false;$('courseBegin').required=false;$('courseFinish').required=false;
      field('name').parentElement.firstChild.textContent='课程名称';field('name').placeholder='例如：示例力学';field('room').parentElement.firstChild.textContent='教室 / 地点';field('room').parentElement.classList.remove('field-full');form.querySelector('.eyebrow').textContent='课程安排';saveButton.textContent='保存课程';
      if(creating){dateInput.value=contextDate;switchMode(false);}else delete form.dataset.manualKind;
    };
    window.SuikeManualSchedule={
      open(date,begin,draft){openEdit();contextDate=date;dateInput.value=date;initialBegin=begin||'';if(draft){field('name').value=draft.name||'';field('room').value=draft.room||'';}switchMode(true);},
      prepare(){if(!creating||!task)return;if(!validDate(dateInput.value))throw Error('请选择有效的日期。');field('day').value=String(M.dayOf(dateInput.value));field('weeks').value=dateInput.value;field('teacher').value='';$('pendingTime').checked=false;
        const begin=$('courseBegin').value,finish=$('courseFinish').value;Time.resolve(state.periods,begin,finish,null,null,false,'');
        if(state.courses.some(c=>c.name===field('name').value.trim()&&c.dates.includes(dateInput.value)&&c.timeMode==='clock'&&c.sourceTime===begin+'-'+finish))throw Error('这项事务已在当天，无需重复添加。');
      },
      timing(value){return creating&&task?{start:null,end:null,timeMode:'clock',timeNote:'',sourceTime:$('courseBegin').value+'-'+$('courseFinish').value}:value;},
      saved(){if(creating&&task){try{localStorage.setItem(key,JSON.stringify({begin:$('courseBegin').value,finish:$('courseFinish').value}));}catch(_){}selectedDate=dateInput.value;weekMonday=M.mondayOf(selectedDate);render();}}
    };
    mode.hidden=true;
  })();
