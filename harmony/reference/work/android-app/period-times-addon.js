  const PeriodTimes=window.SuikePeriodTimes;
  let teachingPeriodPlan=null,teachingPeriodChoice=null;
  function renderTeachingPeriodPreview(rows,metadata){
    teachingPeriodPlan=null;
    const panel=node('section','teaching-period-preview');panel.id='teachingPeriodPreview';
    panel.append(node('strong','','上课时间'));
    if(!rows||!rows.length){
      panel.append(node('p','','网页未提供明确的每节起止时间，沿用当前时间。可在“上课时间”中点击节次手动修改。'));
      return panel;
    }
    try{teachingPeriodPlan=PeriodTimes.preview(state.periods,rows,{complete:!!(metadata&&metadata.periodsComplete)});PeriodTimes.assertFits(state,teachingPeriodPlan.periods.length);}
    catch(error){panel.append(node('p','teaching-warning',error.message+'；本次保留当前时间，可继续导入课程。'));return panel;}
    const changes=teachingPeriodPlan.changes;
    if(metadata&&metadata.periodCount&&!metadata.periodsComplete)panel.append(node('p','period-time-hint','网页共 '+metadata.periodCount+' 节，起止时间不完整，保留当前每日节数。'));
    if(!changes.length){panel.append(node('p','','读到 '+rows.length+' 节时间，与当前设置一致。'));return panel;}
    if(teachingPeriodChoice===null)teachingPeriodChoice=true;
    const label=node('label','teaching-choice'),check=node('input');check.type='checkbox';check.id='teachingImportTimes';check.checked=teachingPeriodChoice;
    check.addEventListener('change',()=>{teachingPeriodChoice=check.checked;});
    label.append(check,node('span','',teachingPeriodPlan.complete?'采用校园作息 · 每天 '+teachingPeriodPlan.periods.length+' 节':'同步网页提供的 '+changes.length+' 节时间'));panel.append(label);
    const details=node('details','help-details');details.append(node('summary','','查看上课时间变更'));
    changes.forEach(change=>details.append(node('p','','第 '+change.period+' 节：'+(change.before?change.before.start+'–'+change.before.end:'未设置')+' → '+(change.after?change.after.start+'–'+change.after.end:'移除'))));
    panel.append(details,node('p','period-time-hint','确认导入后更新“上课时间”；取消勾选可保留你当前的时间。'));
    return panel;
  }
  function openPeriodEditor(number){
    const adding=number===state.periods.length+1,before=adding?{start:'',end:''}:clone(state.periods[number-1]);let start,end;
    productOpen((adding?'添加':'修改')+'第 '+number+' 节时间',()=>{
      if(adding?number!==state.periods.length+1:JSON.stringify(state.periods[number-1])!==JSON.stringify(before))throw new Error('该节时间已改变，请重新打开后修改。');
      const plan=PeriodTimes.preview(state.periods,[{period:number,start:start.value,end:end.value}]);
      const next=PeriodTimes.applyToState(state,plan.periods);
      if(!commit(next,'第 '+number+' 节时间已更新；常规课程与提醒同步调整'))throw new Error('未能保存，当前课表保持原样。');
      closeDialog(productDialog);
    },{eyebrow:'SUIKE · 上课时间',confirm:'保存时间',subtitle:'修改常规节次时间，适用于当前学期。'});
    const fields=node('div','form-grid');productBody.append(fields);
    start=pfField(fields,'开始时间',before.start,'time','periodStart');
    end=pfField(fields,'结束时间',before.end,'time','periodEnd');
    [start,end].forEach(input=>{input.required=true;input.step='60';});
    productBody.append(node('p','period-time-hint','Today、Week 和提醒同步使用这里的时间。'));
  }
  function openDailyPeriodEditor(){
    const before=JSON.stringify(state.periods),draft=clone(state.periods);let count,fields;
    function rebuild(){
      if(fields){Array.from(fields.children).forEach((row,i)=>{const inputs=row.querySelectorAll('input');if(inputs.length===2)draft[i]={start:inputs[0].value,end:inputs[1].value};});fields.replaceChildren();}
      const number=Number(count.value);if(!Number.isInteger(number)||number<1||number>PeriodTimes.MAX_PERIODS)return;
      for(let i=0;i<number;i++){
        const row=node('div','form-grid');fields.append(row);const value=draft[i]||{start:'',end:''};
        const begin=pfField(row,'第 '+(i+1)+' 节 · 开始',value.start,'time','dailyPeriodStart'+(i+1));
        const finish=pfField(row,'结束',value.end,'time','dailyPeriodEnd'+(i+1));
        [begin,finish].forEach(input=>{input.required=true;input.step='60';});
      }
    }
    productOpen('每日节数',()=>{
      if(before!==JSON.stringify(state.periods))throw new Error('作息已改变，请重新打开。');
      const number=Number(count.value);if(!Number.isInteger(number)||number<1||number>PeriodTimes.MAX_PERIODS)throw new Error('每天可设置 1–24 节。');
      const nextPeriods=[];for(let i=1;i<=number;i++)nextPeriods.push({start:$('dailyPeriodStart'+i).value,end:$('dailyPeriodEnd'+i).value});
      const next=PeriodTimes.applyToState(state,nextPeriods);
      if(!commit(next,'已更新每日节数与上课时间'))throw new Error('未能保存，当前课表保持原样。');
      closeDialog(productDialog);
    },{confirm:'保存',subtitle:'校园导入优先，也可自行调整。'});
    count=pfField(productBody,'每天共几节',String(state.periods.length),'number','dailyPeriodCount');count.min='1';count.max=String(PeriodTimes.MAX_PERIODS);count.step='1';count.required=true;
    fields=node('div','daily-period-fields');productBody.append(fields);count.addEventListener('change',rebuild);rebuild();
  }
  const renderOriginalSettings=renderSettings;
  renderSettings=function(){
    renderOriginalSettings();
    const list=document.querySelector('.period-list');if(!list)return;
    const rows=Array.from(list.children);
    state.periods.forEach((period,index)=>{
      const row=rows[index];row.classList.add('period-edit-item');
      const edit=button('period-edit-row','',()=>openPeriodEditor(index+1));edit.dataset.period=String(index+1);
      edit.setAttribute('aria-label','修改第 '+(index+1)+' 节，'+period.start+' 至 '+period.end);
      edit.append(node('span','','第 '+(index+1)+' 节'),node('strong','',period.start+'–'+period.end),node('span','period-edit-chevron','›'));row.replaceChildren(edit);
    });
    if(!$('editDailyPeriods')){const count=button('daily-period-count-row','',openDailyPeriodEditor);count.id='editDailyPeriods';list.parentElement.insertBefore(count,list);}
    $('editDailyPeriods').replaceChildren(node('span','','每日节数'),node('strong','',state.periods.length+' 节'),node('span','period-edit-chevron','›'));
    if(!$('addPeriod')){const add=button('button button-outline','',()=>openPeriodEditor(state.periods.length+1));add.id='addPeriod';list.parentElement.append(add);}
    $('addPeriod').textContent=state.periods.length<PeriodTimes.MAX_PERIODS?'添加第 '+(state.periods.length+1)+' 节':'已设置 '+PeriodTimes.MAX_PERIODS+' 节';$('addPeriod').disabled=state.periods.length>=PeriodTimes.MAX_PERIODS;
    if(!$('periodEditHint')){const hint=node('p','period-time-hint','在这里统一设置节次时间，Today 和 Week 自动同步。');hint.id='periodEditHint';list.parentElement.insertBefore(hint,list);}
  };
