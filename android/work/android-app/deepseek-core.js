/* Strict AI draft validation. No network, storage, or automatic timetable mutation. */
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.SuikeDeepSeekCore=value;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  function fail(code,message){const error=new Error(message);error.code=code;throw error;}
  function plain(value){return value&&typeof value==='object'&&!Array.isArray(value);}
  function text(value,max,required,label){
    if(typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f]/.test(value)||required&&!value.trim())
      fail('RESULT_INVALID',label+'格式不完整，请补充原文后重新解析');
    return value.trim();
  }
  function date(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('DATE_INVALID','课程需要明确的年月日，请补充后重新解析');
    const d=new Date(value+'T00:00:00Z');
    if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value||Number(value.slice(0,4))<1900||Number(value.slice(0,4))>2200)
      fail('DATE_INVALID','课程日期不存在，请补充正确日期');
    return d.getUTCDay()||7;
  }
  function normalize(result,periods){
    if(!plain(result))fail('RESULT_INVALID','解析结果不完整，请重新解析');
    if(result.status==='clarify'){
      if(result.courses!==undefined||!Array.isArray(result.questions)||result.questions.length<1||result.questions.length>5)
        fail('QUESTIONS_INVALID','澄清问题格式不完整，请重新解析');
      const ids=new Set();
      const questions=result.questions.map(q=>{
        if(!plain(q))fail('QUESTIONS_INVALID','澄清问题格式不完整');
        const id=text(q.id,40,true,'问题编号');
        if(ids.has(id))fail('QUESTIONS_INVALID','问题编号重复，请重新解析');
        ids.add(id);
        const choices=q.choices===undefined?[]:q.choices;
        if(!Array.isArray(choices)||choices.length>6)fail('QUESTIONS_INVALID','澄清选项格式不完整');
        return {id,question:text(q.question,240,true,'问题'),choices:choices.map(c=>text(c,160,true,'选项'))};
      });
      return {status:'clarify',questions};
    }
    if(result.status!=='ready'||!Array.isArray(result.courses)||result.courses.length<1||result.courses.length>100)
      fail('RESULT_INVALID','尚未得到完整的课程安排，请补充日期和节次');
    let meetings=0;
    const courses=result.courses.map(c=>{
      if(!plain(c))fail('RESULT_INVALID','课程格式不完整');
      const name=text(c.name,120,true,'课程名称');
      if(!Array.isArray(c.dates)||!c.dates.length||c.dates.length>366)fail('DATE_INVALID','课程需要具体上课日期');
      const days=c.dates.map(date),dates=c.dates.slice().sort();
      if(days.some(d=>d!==days[0]))fail('DAY_MISMATCH','不同星期的课程需要分条核对，请重新解析');
      if(new Set(dates).size!==dates.length)fail('DATE_DUPLICATE','上课日期重复，请重新解析');
      meetings+=dates.length;if(meetings>1000)fail('TOO_MANY_COURSES','单次最多录入 1000 次课，请分批粘贴');
      const sourceTime=text(c.sourceTime===undefined?'':c.sourceTime,40,false,'上课时间');
      if(sourceTime){
        const parts=sourceTime.split('-'),pattern=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
        if(parts.length!==2||!parts.every(p=>pattern.test(p))||parts[0]>=parts[1])
          fail('TIME_INVALID','上课钟点无效，请补充开始和结束时间');
      }
      const independent=!!sourceTime&&(c.start==null&&c.end==null);
      if(!independent&&(!Number.isInteger(c.start)||!Number.isInteger(c.end)||c.start<1||c.end<c.start||c.end>periods.length))fail('PERIOD_INVALID','请补充节次或明确的开始和结束时间');
      if(c.timeMode==='clock'&&!sourceTime)fail('TIME_INVALID','请补充开始和结束时间');
      return {...(independent||c.timeMode==='clock'?{timeMode:'clock'}:{}),name,dates,day:days[0],start:independent?null:c.start,end:independent?null:c.end,sourceTime,
        room:text(c.room===undefined?'':c.room,120,false,'教室'),teacher:text(c.teacher===undefined?'':c.teacher,80,false,'教师')};
    });
    const notes=result.notes===undefined?[]:result.notes;
    if(!Array.isArray(notes)||notes.length>20)fail('RESULT_INVALID','核对说明格式不完整');
    return {status:'ready',courses,notes:notes.map(n=>text(n,240,true,'核对说明'))};
  }
  function sameMeeting(a,b,periods){
    const clock=c=>c.timeMode==='pending'?'pending':((c.timeMode==='clock'||c.end>8)&&c.sourceTime?c.sourceTime:(periods[c.start-1]&&periods[c.end-1]?periods[c.start-1].start+'-'+periods[c.end-1].end:''));
    return a.name===b.name&&a.day===b.day&&clock(a)===clock(b)&&
      (!a.room||!b.room||a.room===b.room)&&(!a.teacher||!b.teacher||a.teacher===b.teacher);
  }
  function plan(state,courses,prefix){
    const next=JSON.parse(JSON.stringify(state));let added=0,duplicates=0;
    const existingIds=new Set(next.courses.map(c=>c.id));
    courses.forEach((draft,index)=>{
      const dates=draft.dates.filter(day=>{
        const exists=next.courses.some(c=>sameMeeting(c,draft,state.periods)&&c.dates.indexOf(day)>=0);
        if(exists)duplicates++;return !exists;
      });
      if(!dates.length)return;
      let id=prefix+'-'+index;
      while(existingIds.has(id))id+='x';
      existingIds.add(id);
      next.courses.push(Object.assign({},draft,{id,dates,color:'teal'}));added+=dates.length;
    });
    return {next,added,duplicates};
  }
  return {normalize,plan,date};
});
