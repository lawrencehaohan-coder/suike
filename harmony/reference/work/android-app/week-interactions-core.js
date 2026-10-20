/* Pure weekly-occurrence operations; the UI commits a whole plan once. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.SuikeWeekInteractions=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function fail(code,message){const error=new Error(message);error.code=code;throw error;}
  function copy(value){return JSON.parse(JSON.stringify(value));}
  function dateCheck(date,M){try{if(M.iso(M.parseISO(date))!==date)throw Error();}catch(_){fail('DATE_INVALID','请选择有效的上课日期');}}
  function maxPeriod(state){return Math.min(24,Math.max(1,state.periods.length,...state.courses.filter(c=>c.timeMode!=='pending').map(c=>c.end)));}
  function overlaps(c,start,end){return c.timeMode!=='pending'&&c.start<=end&&start<=c.end;}
  function coursesAt(state,date,period,ignoreId){return state.courses.filter(c=>c.id!==ignoreId&&c.dates.includes(date)&&overlaps(c,period,period));}
  function courseFor(state,id,date){const course=state.courses.find(c=>c.id===id&&c.dates.includes(date));if(!course)fail('COURSE_GONE','这次课程已改变，请重新选择');if(course.timeMode==='pending')fail('PENDING','请先确认课程节次');if(course.timeMode==='clock')fail('CLOCK_ONLY','请点开安排修改具体时间');return course;}
  function positionChanges(state,course,start,end){
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start||end>maxPeriod(state))fail('OUT_OF_RANGE','这个位置放不下完整课程');
    let sourceTime='';
    if(course.timeMode==='clock'&&start===course.start&&end===course.end)return {start,end,sourceTime:course.sourceTime,timeMode:'clock',timeNote:''};
    if(end>8){
      if(start===course.start&&end===course.end&&course.sourceTime)sourceTime=course.sourceTime;
      else if(state.periods[start-1]&&state.periods[end-1])sourceTime=state.periods[start-1].start+'-'+state.periods[end-1].end;
      else fail('NIGHT_TIME_UNKNOWN','该晚间节次尚未设置时间，请先修改上课时间');
    }
    return {start,end,sourceTime,timeMode:'periods',timeNote:''};
  }
  function checkPlacement(state,course,date,W){
    const candidate=Object.assign({},course,{dates:[date]});
    const check=W.detectConflicts(state,candidate,{ignoreOccurrences:[{courseId:course.id,date}]});
    if(check.conflicts.length)fail('CONFLICT','这个位置会与「'+check.conflicts[0].name+'」冲突');
    if(check.unconfirmed.length)fail('UNCONFIRMED','当天有时间待确认的安排，请先核对后再调整');
  }
  function planMove(input,request,deps){
    const M=deps.model,W=deps.workspace,options=deps.options||{},state=copy(input);
    dateCheck(request.date,M);dateCheck(request.targetDate,M);
    if(M.mondayOf(request.date)!==M.mondayOf(request.targetDate))fail('OUTSIDE_WEEK','请在当前周内移动课程');
    const source=courseFor(state,request.courseId,request.date),duration=source.end-source.start+1;
    const hitPeriod=request.hitPeriod===undefined?request.targetStart:request.hitPeriod;
    if(!Number.isInteger(hitPeriod)||hitPeriod<1||hitPeriod>maxPeriod(state))fail('OUT_OF_RANGE','请移到课表里的有效时段');
    const targets=coursesAt(state,request.targetDate,hitPeriod,source.id);
    if(targets.length>1)fail('MULTIPLE_TARGETS','此处有多门重叠课程，请选择其他位置');
    const target=targets[0]||null,start=target?target.start:request.targetStart,end=start+duration-1;
    const changes=positionChanges(state,source,start,end);
    if(!target&&request.date===request.targetDate&&source.start===start)return {kind:'noop',state,placements:[]};
    const first=W.editOccurrences(state,{courseId:source.id,date:request.date,scope:'one',targetDate:request.targetDate,changes},options);
    let next=first.state;
    const placements=[{courseId:first.courseId,sourceCourseId:source.id,fromDate:request.date,fromStart:source.start,fromEnd:source.end,date:request.targetDate,start,end}];
    if(target){
      if(target.timeMode==='clock')fail('CLOCK_ONLY','请点开安排修改具体时间');
      const targetEnd=source.start+(target.end-target.start);
      const second=W.editOccurrences(next,{courseId:target.id,date:request.targetDate,scope:'one',targetDate:request.date,changes:positionChanges(state,target,source.start,targetEnd)},options);
      next=second.state;
      placements.push({courseId:second.courseId,sourceCourseId:target.id,fromDate:request.targetDate,fromStart:target.start,fromEnd:target.end,date:request.date,start:source.start,end:targetEnd});
    }
    placements.forEach(p=>checkPlacement(next,courseFor(next,p.courseId,p.date),p.date,W));
    return {kind:target?'swap':'move',state:next,placements,targetCourseId:target?target.id:null};
  }
  function defaultEnd(state,date,start){
    return start%2===1&&start<maxPeriod(state)&&!coursesAt(state,date,start+1).length?start+1:start;
  }
  function planAdd(input,request,deps){
    const M=deps.model,W=deps.workspace,state=copy(input);dateCheck(request.date,M);
    const name=String(request.name||'').trim(),room=String(request.room||'').trim(),teacher=String(request.teacher||'').trim();
    if(!name)fail('NAME_REQUIRED','请填写课程名称');
    if(name.length>80||room.length>80||teacher.length>40)fail('TEXT_TOO_LONG','课程名和教室最多 80 字，教师最多 40 字');
    if(!request.id||state.courses.some(c=>c.id===request.id))fail('DUPLICATE_ID','这门课程已添加，请重新打开新增界面');
    const course={id:request.id,name,room,teacher,day:M.dayOf(request.date),start:request.start===null?null:Number(request.start),end:request.end===null?null:Number(request.end),dates:[request.date],color:'teal',sourceTime:String(request.sourceTime||'').trim()};
    if(request.timeMode==='clock')course.timeMode='clock';
    if(course.timeMode!=='clock'){const position=positionChanges(state,course,course.start,course.end);Object.assign(course,position);}
    state.courses.push(course);const options=deps.options||{},next=W.normalizeState(state,options.validateState||M.validateState,options.validateLedger);checkPlacement(next,next.courses.find(c=>c.id===course.id),request.date,W);
    return {state:next,courseId:course.id};
  }
  return {planMove,planAdd,coursesAt,defaultEnd,maxPeriod};
});
