(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SuikeCourseTime=factory();})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const valid=s=>typeof s==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s);
  function resolve(periods,begin,finish,start,end,pending,note){
    begin=(begin||'').trim();finish=(finish||'').trim();
    if(begin&&finish){
      if(!valid(begin)||!valid(finish)||begin>=finish)throw new Error('结束时间须晚于开始时间。');
      // Clock arrangements do not create or depend on teaching periods.
      const hits=periods.map((p,i)=>p.start<finish&&begin<p.end?i+1:0).filter(Boolean);
      start=hits.length?hits[0]:null;end=hits.length?hits[hits.length-1]:null;
      const ordinary=start!==null&&begin===periods[start-1].start&&finish===periods[end-1].end;
      return {start:ordinary?start:null,end:ordinary?end:null,timeMode:ordinary?'periods':'clock',timeNote:'',sourceTime:ordinary&&end<=8?'':begin+'-'+finish};
    }
    if(pending){
      const text=begin?begin+'开始，结束时间待确认':finish?'开始时间待确认，'+finish+'结束':(note||'开始和结束时间待确认');
      return {start:null,end:null,timeMode:'pending',timeNote:text,sourceTime:''};
    }
    throw new Error('请填写开始时间和结束时间，或勾选“时间待确认”。');
  }
  function initial(course,periods){
    if(!course)return {begin:periods[0].start,finish:periods[Math.min(1,periods.length-1)].end};
    if(course.timeMode==='pending'){
      const clocks=(course.timeNote||'').match(/(?:[01]\d|2[0-3]):[0-5]\d/g)||[];
      return {begin:/开始时间待/.test(course.timeNote||'')?'':clocks[0]||'',finish:clocks.length>1?clocks[1]:/结束$/.test(course.timeNote||'')?clocks[0]||'':''};
    }
    const explicit=((course.timeMode==='clock'||(!periods[course.start-1]||!periods[course.end-1])&&course.end>8)?course.sourceTime||'':'').split('-');
    return {begin:explicit.length===2?explicit[0]:periods[course.start-1].start,finish:explicit.length===2?explicit[1]:periods[course.end-1].end};
  }
  function infer(periods,begin,finish){
    if(!valid(begin)||!valid(finish)||begin>=finish)return null;
    const matches=periods.map((p,i)=>p.start<finish&&begin<p.end?i+1:0).filter(Boolean);
    return matches.length?{start:matches[0],end:matches[matches.length-1]}:null;
  }
  return {resolve,initial,infer,valid};
});
