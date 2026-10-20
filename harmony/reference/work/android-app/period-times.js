/* Pure period-time validation and updates; no storage, DOM or school defaults. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.SuikePeriodTimes=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function fail(code,message){var error=new TypeError(message);error.code=code;throw error;}
  function keys(value,expected){
    if(!value||Object.prototype.toString.call(value)!=='[object Object]'||
      [Object.prototype,null].indexOf(Object.getPrototypeOf(value))<0)fail('PERIOD_OBJECT_INVALID','课时时间格式无效');
    var own=Object.keys(value);
    if(own.length!==expected.length||own.some(function(key){var d=Object.getOwnPropertyDescriptor(value,key);return expected.indexOf(key)<0||!d||!Object.prototype.hasOwnProperty.call(d,'value');}))fail('PERIOD_FIELDS_INVALID','课时时间字段无效');
  }
  function clock(value){return typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);}
  function range(value){if(!clock(value.start)||!clock(value.end)||value.start>=value.end)fail('PERIOD_CLOCK_INVALID','结束时间须晚于开始时间，格式为 HH:MM');}
  function validatePeriods(periods){
    if(!Array.isArray(periods)||periods.length<1||periods.length>24)fail('PERIOD_COUNT_INVALID','每天可设置 1–24 节');
    var result=periods.map(function(period){keys(period,['start','end']);range(period);return {start:period.start,end:period.end};});
    for(var i=1;i<result.length;i++)if(result[i-1].end>result[i].start)fail('PERIOD_OVERLAP','第 '+i+' 节与第 '+(i+1)+' 节时间重叠');
    return result;
  }
  function validateRows(rows){
    if(!Array.isArray(rows)||rows.length<1||rows.length>24)fail('PERIOD_ROWS_INVALID','网页课时时间数量无效');
    var seen=new Set(),result=rows.map(function(row){
      keys(row,['period','start','end']);
      if(!Number.isInteger(row.period)||row.period<1||row.period>24||seen.has(row.period))fail('PERIOD_NUMBER_INVALID','节次重复或超出 1–24 节');
      seen.add(row.period);range(row);return {period:row.period,start:row.start,end:row.end};
    }).sort(function(a,b){return a.period-b.period;});
    for(var i=1;i<result.length;i++)if(result[i-1].end>result[i].start)fail('PERIOD_OVERLAP','网页上的课时时间重叠或顺序不正确');
    return result;
  }
  function preview(current,rows,options){
    var original=validatePeriods(current),next=original.map(function(p){return {start:p.start,end:p.end};}),changes=[];
    var validatedRows=validateRows(rows),complete=!!(options&&options.complete);
    if(complete){
      if(validatedRows.some(function(row,i){return row.period!==i+1;}))fail('PERIOD_GAP','网页作息不完整，保留当前每日节数');
      next=next.slice(0,validatedRows.length);
      original.slice(validatedRows.length).forEach(function(before,i){changes.push({period:validatedRows.length+i+1,before:before,after:null});});
    }
    validatedRows.forEach(function(row){
      if(row.period>next.length+1)fail('PERIOD_GAP','网页未提供中间节次，请先手动补充时间');
      var before=original[row.period-1]||null,after={start:row.start,end:row.end};
      next[row.period-1]=after;
      if(!before||before.start!==after.start||before.end!==after.end)changes.push({period:row.period,before:before,after:after});
    });
    for(var i=1;i<next.length;i++)if(next[i-1].end>next[i].start)fail('PERIOD_OVERLAP','第 '+i+' 节与第 '+(i+1)+' 节时间重叠，请调整后再保存');
    return {periods:next,changes:changes,countChanged:next.length!==original.length,complete:complete};
  }
  function assertFits(state,count){
    var occupied=(state.courses||[]).filter(function(c){return c.timeMode!=='pending'&&c.end>count;});
    if(occupied.length)fail('PERIOD_IN_USE','第 '+occupied[0].end+' 节仍有“'+occupied[0].name+'”，请先调整课程再减少节数');
  }
  function applyToState(state,periods){
    var next=JSON.parse(JSON.stringify(state)),validated=validatePeriods(periods),previous=validatePeriods(state.periods);
    assertFits(state,validated.length);
    next.periods=validated;
    // Routine evening courses follow their period table; separately agreed clocks remain explicit.
    next.courses.forEach(function(course){
      if(course.timeMode==='pending'||course.timeMode==='clock'||course.end<=8||!previous[course.start-1]||!previous[course.end-1]||!validated[course.end-1])return;
      var old=previous[course.start-1].start+'-'+previous[course.end-1].end;
      if(course.sourceTime===old)course.sourceTime=validated[course.start-1].start+'-'+validated[course.end-1].end;
    });
    return next;
  }
  return {MAX_PERIODS:24,assertFits:assertFits,validateRows:validateRows,validatePeriods:validatePeriods,preview:preview,applyToState:applyToState};
});
