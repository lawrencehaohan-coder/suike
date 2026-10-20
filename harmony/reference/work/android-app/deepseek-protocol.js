/* AI supplies source facts. The app owns audience filtering and calendar arithmetic. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SuikeDeepSeekProtocol=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const DAY=86400000;
  function fail(code,message){const e=new Error(message);e.code=code;throw e;}
  const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
  function str(v,max,required){if(typeof v!=='string'||v.length>max||/[\u0000-\u001f\u007f]/.test(v)||required&&!v.trim())fail('FACT_INVALID','课程信息不完整，请补充后重试。');return v.trim();}
  function list(v,max){if(!Array.isArray(v)||v.length>max)fail('FACT_INVALID','课程列表格式不完整，请重新解析。');return v;}
  function iso(v){str(v,10,true);if(!/^\d{4}-\d{2}-\d{2}$/.test(v))fail('DATE_INVALID','请确认完整的上课日期。');const n=Date.parse(v+'T00:00:00Z');if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==v)fail('DATE_INVALID','上课日期不存在。');return n;}
  const key=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
  function inspect(result){
    if(!plain(result)||result.protocol!==2||result.status!=='scope'||!['personal','classes','unknown'].includes(result.mode))fail('PROTOCOL_INVALID','未识别出课程范围，请重新解析。');
    const ids=new Set();
    function id(v){const s=str(v,40,true);if(!/^[A-Za-z0-9_-]+$/.test(s)||ids.has(s))fail('SCOPE_INVALID','班级选项重复或不完整，请重新解析。');ids.add(s);return s;}
    const candidates=list(result.candidates,100).map(c=>{
      if(!plain(c))fail('SCOPE_INVALID','班级信息不完整。');
      return {id:id(c.id),label:str(c.label,160,true),className:str(c.className,120,true),major:str(c.major||'',120,false),
        groups:list(c.groups||[],30).map(g=>({id:id(g.id),label:str(g.label,120,true)}))};
    });
    if((result.mode==='classes')!==!!candidates.length)fail('SCOPE_INVALID','请先确定文件中的班级范围。');
    return {protocol:2,status:'scope',mode:result.mode,candidates,basis:str(result.basis||'',400,true)};
  }
  function remembered(scope,identity){
    if(!identity||!identity.className)return null;
    const matches=scope.candidates.filter(c=>key(c.className)===key(identity.className)&&key(c.major)===key(identity.major));
    if(matches.length!==1)return null;
    const c=matches[0],groups=c.groups.filter(g=>key(g.label)===key(identity.group));
    if(c.groups.length&&groups.length!==1||!c.groups.length&&identity.group)return null;
    return {classId:c.id,groupId:groups.length?groups[0].id:''};
  }
  function identity(scope,target){const c=scope.candidates.find(c=>c.id===target.classId);if(!c)fail('SCOPE_INVALID','请选择文件中的班级。');const g=c.groups.find(g=>g.id===target.groupId);if(c.groups.length&&!g)fail('SCOPE_INVALID','请选择实验批次或分组。');return {major:c.major,className:c.className,group:g?g.label:''};}
  function day(v){const s=key(str(v,30,true)).replace(/星期|礼拜|周/g,'');const chinese={一:1,二:2,三:3,四:4,五:5,六:6,日:7,天:7};const n=chinese[s]||Number(s);if(!Number.isInteger(n)||n<1||n>7)fail('DAY_INVALID','请确认星期几上课。');return n;}
  function nums(s,max,code){
    if(!s||!/^[\d,\-]+$/.test(s))fail(code,'周次或节次不明确，请确认具体范围。');
    const all=[];s.split(',').forEach(part=>{const m=/^(\d{1,2})(?:-(\d{1,2}))?$/.exec(part);if(!m)fail(code,'周次或节次范围不完整。');const a=Number(m[1]),b=Number(m[2]||m[1]);if(a<1||b<a||b>max)fail(code,'周次或节次超出当前学期设置。');for(let i=a;i<=b;i++)all.push(i);});
    return [...new Set(all)].sort((a,b)=>a-b);
  }
  function numericText(v){return key(v).replace(/[零一二三四五六七八九十]+/g,s=>{const digits='零一二三四五六七八九';if(s.includes('十')){const parts=s.split('十');return String((parts[0]?digits.indexOf(parts[0]):1)*10+(parts[1]?digits.indexOf(parts[1]):0));}return String(digits.indexOf(s));}).replace(/[，、；;]/g,',').replace(/[—–~～至到]/g,'-').replace(/第|周|节|\s/g,'');}
  function weeks(v,total){
    let s=numericText(str(v,160,true)),parity=0;
    if(/单/.test(s)&&/双/.test(s))fail('WEEK_INVALID','单双周信息冲突，请确认。');
    if(/单/.test(s))parity=1;if(/双/.test(s))parity=2;
    s=s.replace(/[()（）]/g,'').replace(/单|双/g,'');
    const pieces=s.split(/除|不含/);if(pieces.length>2)fail('WEEK_INVALID','请确认需要排除的周次。');
    const included=nums(pieces[0].replace(/,$/,''),total,'WEEK_INVALID');
    const excluded=pieces.length===2?nums(pieces[1].replace(/^,|,$/g,''),total,'WEEK_INVALID'):[];
    const result=included.filter(n=>(!parity||n%2===(parity===1?1:0))&&!excluded.includes(n));
    if(!result.length)fail('WEEK_INVALID','没有符合条件的上课周次。');return result;
  }
  function periods(v,all,clock){
    let selected=[];if(v)selected=nums(numericText(str(v,80,true)),all.length,'PERIOD_INVALID');
    const time=clock?str(clock,40,true).replace(/[—–~～]/g,'-'):'';
    if(time&&!/^(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))fail('TIME_INVALID','请确认上课钟点。');
    if(time){
      const [a,b]=time.split('-');if(a>=b)fail('TIME_INVALID','结束时间需要晚于开始时间。');
      if(selected.length&&!selected.some(n=>all[n-1].start<b&&a<all[n-1].end))fail('TIME_MISMATCH','节次与钟点不对应，请确认。');
      if(selected.some((n,i)=>i&&n!==selected[i-1]+1))fail('PERIOD_INVALID','不连续节次需要分条。');
      // Explicit clock-only facts stay independent of the period table.
      if(!selected.length)return {start:null,end:null,sourceTime:time,timeMode:'clock'};
      const start=selected[0],end=selected[selected.length-1];
      if(time!==all[start-1].start+'-'+all[end-1].end)return {start:null,end:null,sourceTime:time,timeMode:'clock'};
      return {start,end,sourceTime:time};
    }
    if(!selected.length||selected.some((n,i)=>i&&n!==selected[i-1]+1))fail('PERIOD_INVALID','请确认连续的上课节次；不连续节次需要分条。');
    const start=selected[0],end=selected[selected.length-1];
    return {start,end,sourceTime:end>8?all[start-1].start+'-'+all[end-1].end:''};
  }

  function applies(a,scope,target){
    if(!plain(a))fail('SCOPE_INVALID','课程缺少所属班级信息。');
    const evidence=str(a.evidence||'',400,true),classes=list(a.classIds,100).map(x=>str(x,40,true)),groups=list(a.groupIds||[],30).map(x=>str(x,40,true));
    if(!['personal','listed','shared','unknown'].includes(a.kind))fail('SCOPE_INVALID','课程所属范围不明确。');
    if(scope.mode==='personal'){
      if(a.kind!=='personal'||classes.length||groups.length)fail('SCOPE_INVALID','文件中出现班级限制，请重新确认范围。');return true;
    }
    identity(scope,target);
    const knownClasses=new Set(scope.candidates.map(c=>c.id)),knownGroups=new Set([].concat(...scope.candidates.map(c=>c.groups.map(g=>g.id))));
    if(classes.some(c=>!knownClasses.has(c))||groups.some(g=>!knownGroups.has(g)))fail('SCOPE_INVALID','课程使用了未确认的班级或分组。');
    if(classes.length&&!classes.includes(target.classId))return false;
    if(groups.length&&!groups.includes(target.groupId))return false;
    if(a.kind==='unknown')fail('SCOPE_UNCERTAIN','有课程无法确定所属班级，请先确认。');
    if(a.kind==='personal')fail('SCOPE_INVALID','班级课表中的课程需要明确所属班级。');
    if(a.kind==='shared'&&!classes.length&&!/全体|所有班|全部班|各班|全专业|全年级|通用/.test(evidence))fail('SCOPE_UNCERTAIN','通用课程的适用范围需要确认。');
    if(a.kind==='listed'&&!classes.length)fail('SCOPE_INVALID','课程没有明确所属班级。');
    if(classes.length&&!classes.includes(target.classId))return false;
    if(groups.length&&!groups.includes(target.groupId))return false;
    if(!groups.length&&/批次|第[一二三四五六七八九十\d]+批|[一二三四五六七八九十\d]+组/.test(evidence))fail('SCOPE_UNCERTAIN','实验课的分组需要确认。');
    return true;
  }
  function normalize(result,context){
    if(!plain(result)||result.protocol!==2||result.status!=='ready')fail('PROTOCOL_INVALID','结果未按课表格式返回，请重新解析。');
    const scope=context.scope;if(!scope||!['personal','classes'].includes(scope.mode))fail('SCOPE_INVALID','请先确认导入范围。');
    const first=iso(context.startMonday),total=context.totalWeeks;
    if((new Date(first).getUTCDay()||7)!==1||!Number.isInteger(total)||total<1||total>52)fail('TERM_INVALID','请确认学期首周周一和总周数。');
    const facts=list(result.courses,150);if(!facts.length)fail('FACT_INVALID','没有找到符合条件的课程。');
    let excluded=0,meetings=0;
    const courses=[],sources=[];
    facts.forEach(f=>{
      if(!plain(f))fail('FACT_INVALID','课程信息不完整。');
      if(!applies(f.audience,scope,context.target)){excluded++;return;}
      const name=str(f.name,120,true),s=f.schedule,source=f.source;
      if(!plain(s)||!plain(source))fail('FACT_INVALID','课程缺少时间或来源。');
      const proof={location:str(source.location,200,true),quote:str(source.quote,800,true)};
      if(!key(proof.quote).includes(key(name)))fail('SOURCE_INVALID','课程名称与来源不符，请重新核对。');
      if(!context.hasAttachment&&context.sourceText&& !key(context.sourceText).includes(key(proof.quote)))fail('SOURCE_INVALID','课程来源与本次文字不符，请重新核对。');
      const rawDates=list(s.dates||[],366),hasWeeks=!!s.weeks,weekday=s.weekday?day(s.weekday):rawDates.length?(new Date(iso(rawDates[0])).getUTCDay()||7):0;
      if(!weekday)fail('DAY_INVALID','请确认上课星期。');
      let dates=rawDates.map(d=>{const n=iso(d);if((new Date(n).getUTCDay()||7)!==weekday)fail('DAY_MISMATCH','日期与星期不一致，请确认。');return d;});
      if(new Set(dates).size!==dates.length)fail('DATE_DUPLICATE','上课日期重复，请重新核对。');
      if(hasWeeks){const computed=weeks(s.weeks,total).map(w=>new Date(first+((w-1)*7+weekday-1)*DAY).toISOString().slice(0,10));if(dates.length&&dates.slice().sort().join()!==computed.join())fail('DATE_MISMATCH','周次与日期不一致，请确认原始周次。');dates=computed;}
      if(!dates.length)fail('WEEK_INVALID','请确认上课周次或具体日期。');
      if(dates.some(d=>iso(d)<first||iso(d)>=first+total*7*DAY))fail('DATE_OUTSIDE_TERM','日期超出当前学期，请确认学期或上课日期。');
      const time=periods(s.periods||'',context.periods,s.clock||'');
      meetings+=dates.length;if(meetings>1000)fail('TOO_MANY_COURSES','本次课程过多，请按学期分批导入。');
      courses.push(Object.assign({name,dates:dates.sort(),day:weekday,room:str(f.room||'',120,false),teacher:str(f.teacher||'',80,false)},time));sources.push(proof);
    });
    if(!courses.length)fail('SCOPE_EMPTY','没有找到所选班级的课程，请检查班级或附件。');
    return {status:'ready',courses,sources,excluded,notes:excluded?['已排除其他班级或分组的 '+excluded+' 条安排。']:[]};
  }
  return {inspect,normalize,remembered,identity,weeks,periods,day};
});
