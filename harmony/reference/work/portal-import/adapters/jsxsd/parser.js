/* Independently implemented JSXSD DOM-capture normalizer. No login/network access. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SuikeJsxsdParser=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function fail(code){const error=new TypeError(code);error.code=code;throw error;}
  function keys(value,allowed,required){if(!value||Object.prototype.toString.call(value)!=='[object Object]'||Object.keys(value).some(k=>!allowed.includes(k))||(required||allowed).some(k=>!Object.prototype.hasOwnProperty.call(value,k)))fail('CAPTURE_FIELDS_INVALID');}
  function clean(value,max,required){if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))fail('TEXT_INVALID');const text=value.replace(/\s+/g,' ').trim();if(required&&!text)fail('TEXT_EMPTY');return text;}
  function number(value,min,max){if(!Number.isInteger(value)||value<min||value>max)fail('NUMBER_INVALID');return value;}
  function minute(value){if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))fail('CLOCK_INVALID');const [h,m]=value.split(':').map(Number);return h*60+m;}
  function clock(value){return String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');}
  function hash(value){let a=2166136261,b=3339675911;for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b^value.charCodeAt(i),2246822519);}return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');}
  function isoDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('DATE_INVALID');const d=new Date(value+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)fail('DATE_INVALID');return d;}
  function addDays(value,n){return new Date(isoDate(value).getTime()+n*86400000).toISOString().slice(0,10);}
  function parsePattern(text,totalWeeks){
    const value=clean(text,200,true).replace(/[–—～~]/g,'-');
    const section=/\[\s*([\d\s,，、-]+)\s*节\s*\]/.exec(value);if(!section)fail('SECTIONS_MISSING');
    const raw=section[1].replace(/\s/g,''),tokens=raw.split(/[,，、-]/).map(Number);let sections;
    if(tokens.length===2&&/^\d+-\d+$/.test(raw))sections=Array.from({length:number(tokens[1],tokens[0],12)-number(tokens[0],1,12)+1},(_,i)=>tokens[0]+i);
    else sections=tokens.map(n=>number(n,1,12));
    sections=Array.from(new Set(sections)).sort((a,b)=>a-b);if(!sections.length||sections.some((n,i)=>i&&n!==sections[i-1]+1))fail('SECTIONS_NONCONTIGUOUS');
    const remaining=value.replace(section[0],'').trim(),weeks=new Set();let found=false;
    const re=/([\d\s,，、-]+)\s*[（(]\s*(周|单周|双周)\s*[)）]/g;let match;
    while((match=re.exec(remaining))){found=true;
      match[1].replace(/\s/g,'').split(/[,，、]/).filter(Boolean).forEach(item=>{
        const m=/^(\d{1,2})(?:-(\d{1,2}))?$/.exec(item);if(!m)fail('WEEKS_INVALID');const first=number(Number(m[1]),1,totalWeeks),last=number(Number(m[2]||m[1]),first,totalWeeks);
        for(let week=first;week<=last;week++)if(match[2]==='周'||match[2]==='单周'&&week%2===1||match[2]==='双周'&&week%2===0)weeks.add(week);
      });
    }
    if(!found||remaining.replace(re,'').replace(/[\s,，、;]/g,'')||!weeks.size)fail('WEEKS_INVALID');
    return {start:sections[0],end:sections[sections.length-1],weeks:[...weeks].sort((a,b)=>a-b)};
  }
  function expandPeriodGroups(rows){
    if(!Array.isArray(rows)||rows.length<2||rows.length>12)fail('PERIOD_GROUPS_INVALID');
    let lastPeriod=0,lastClock=-1;
    const groups=rows.map((row,index)=>{keys(row,['group','first','last','start','end']);number(row.group,index+1,index+1);number(row.first,lastPeriod+1,lastPeriod+1);number(row.last,row.first,12);const start=minute(row.start),end=minute(row.end);if(end<=start||start<lastClock)fail('PERIOD_GROUPS_INVALID');lastPeriod=row.last;lastClock=end;return {...row,count:row.last-row.first+1,duration:end-start};});
    if(lastPeriod<8)fail('PERIOD_GROUPS_INVALID');
    // Infer a uniform lesson and intra-group gap only from two different group
    // lengths, then verify every group. No JUST clocks or hard-coded HHU defaults.
    const a=groups[0],b=groups.find(g=>g.count!==a.count);let lesson,gap;
    if(groups.every(g=>g.count===1)){lesson=null;gap=0;}
    else{
      if(!b)fail('PERIOD_TIMES_AMBIGUOUS');const stride=(b.duration-a.duration)/(b.count-a.count);gap=a.count*stride-a.duration;lesson=stride-gap;
      if(!Number.isInteger(lesson)||!Number.isInteger(gap)||lesson<20||lesson>90||gap<0||gap>30||groups.some(g=>g.duration!==g.count*lesson+(g.count-1)*gap))fail('PERIOD_TIMES_AMBIGUOUS');
    }
    const periods=[];groups.forEach(g=>{for(let i=0;i<g.count;i++){const start=minute(g.start)+(lesson===null?0:i*(lesson+gap));periods.push({period:g.first+i,start:clock(start),end:clock(lesson===null?minute(g.end):start+lesson)});}});
    return {groups,periods,inferred:lesson!==null,lessonMinutes:lesson,gapMinutes:gap};
  }
  function normalizeCapture(capture,settings,profile,personalPeriods){
    if(!profile||profile.protocol!=="jsxsd")fail("ADAPTER_PROFILE_REQUIRED");
    keys(capture,['source','adapterVersion','term','rows','periodGroups','unscheduledPresent']);
    if(capture.source!==profile.captureSource||capture.adapterVersion!==profile.adapterVersion||typeof capture.unscheduledPresent!=='boolean')fail('CAPTURE_INVALID');
    keys(capture.term,['year','semester']);const year=clean(capture.term.year,9,true),semester=clean(capture.term.semester,1,true),ys=/^(\d{4})-(\d{4})$/.exec(year);
    if(!ys||Number(ys[2])!==Number(ys[1])+1||Number(ys[1])<1900||Number(ys[2])>2200||!/[123]/.test(semester))fail('TERM_INVALID');
    if(!settings||!Number.isInteger(settings.totalWeeks)||settings.totalWeeks<1||settings.totalWeeks>52||isoDate(settings.startMonday).getUTCDay()!==1)fail('SETTINGS_INVALID');
    const y=Number(settings.startMonday.slice(0,4));if(y!==(semester==='1'?Number(ys[1]):Number(ys[2])))fail('TERM_DATE_MISMATCH');
    if(!Array.isArray(capture.periodGroups))fail('PERIOD_GROUPS_INVALID');
    const timing=capture.periodGroups.length?expandPeriodGroups(capture.periodGroups):{groups:[],periods:[],inferred:false};
    if(!timing.periods.length&&profile.collectorLayout==='hhu-groups')fail('PERIOD_GROUPS_INVALID');
    if(!Array.isArray(capture.rows)||!capture.rows.length||capture.rows.length>500)fail('ROWS_INVALID');
    const termId=year+'-'+semester,source={system:profile.system,term:termId},occurrences=[],seen=new Map(),warnings=[],stats={sourceRows:capture.rows.length,selectedRows:capture.rows.length,acceptedRows:0,rejectedRows:0,excludedRows:0,duplicateRows:0,uniqueMeetings:0};
    capture.rows.forEach((row,index)=>{try{
      keys(row,['cell','name','weekText','teacher','room']);const cell=/^([1-7])-([1-9]|1[0-2])$/.exec(clean(row.cell,10,true));if(!cell)fail('CELL_INVALID');
      const day=Number(cell[1]),group=timing.groups.find(g=>g.group===Number(cell[2]));if(timing.groups.length&&!group)fail('CELL_INVALID');
      const name=clean(row.name,80,true),teacher=clean(row.teacher,120,false),room=clean(row.room,120,false),pattern=parsePattern(row.weekText,settings.totalWeeks);
      if(pattern.end>profile.maxSections||group&&(pattern.start<group.first||pattern.end>group.last))fail('CELL_PERIOD_MISMATCH');
      const sourceKey=profile.id+'-course-'+hash(JSON.stringify([termId,name,day,pattern.start,pattern.end]));let added=0;
      pattern.weeks.forEach(week=>{
        const date=addDays(settings.startMonday,(week-1)*7+day-1),clocks=timing.periods.length?timing.periods:(personalPeriods||[]);
        const first=clocks[pattern.start-1],last=clocks[pattern.end-1],pending=pattern.end>8&&(!first||!last);
        const time=pattern.end>8&&!pending?first.start+'-'+last.end:'';
        const item={sourceOccurrenceId:profile.id+'-pattern-'+hash(sourceKey+'|'+week),sourceKey,week,date,name,day,start:pending?null:pattern.start,end:pending?null:pattern.end,room,teacher,sourceTime:time,timeMode:pending?'pending':'periods',timeNote:pending?'第'+pattern.start+'–'+pattern.end+'节（实际时间待确认）':''};
        const previous=seen.get(item.sourceOccurrenceId);if(previous&&JSON.stringify(previous)!==JSON.stringify(item))fail('SOURCE_PATTERN_CONFLICT');if(!previous){seen.set(item.sourceOccurrenceId,item);occurrences.push(item);added++;}
      });
      if(!added)stats.duplicateRows++;stats.acceptedRows++;
    }catch(error){if(error.code==='SOURCE_PATTERN_CONFLICT')throw error;stats.rejectedRows++;warnings.push({code:error.code||'ROW_INVALID',row:index});}});
    if(!occurrences.length)fail('NO_VALID_COURSES');if(timing.inferred)warnings.push({code:'PERIOD_TIMES_INFERRED',lessonMinutes:timing.lessonMinutes,gapMinutes:timing.gapMinutes});
    occurrences.sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start||a.sourceOccurrenceId.localeCompare(b.sourceOccurrenceId));stats.uniqueMeetings=occurrences.length;
    return {source,term:{year,semester},scope:{from:settings.startMonday,to:addDays(settings.startMonday,settings.totalWeeks*7-1),complete:stats.rejectedRows===0},occurrences,warnings,rejectedCount:stats.rejectedRows,unscheduledPresent:capture.unscheduledPresent,periods:timing.periods,periodCount:timing.periods.length||null,periodsComplete:timing.periods.length>0,stats,clockInference:timing.inferred,requiresManualTimes:!timing.periods.length};
  }
  return {normalizeCapture,parsePattern,expandPeriodGroups};
});
