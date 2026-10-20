(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SuikeProductCore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  function fail(){throw new Error('PRODUCT_SETTINGS_INVALID');}
  function plain(value){return value&&typeof value==='object'&&!Array.isArray(value);}
  function string(value,max){if(typeof value!=='string'||value.length>max||/[\u0000-\u0008]/.test(value))fail();return value.trim();}
  function number(value,min,max){if(!Number.isInteger(value)||value<min||value>max)fail();return value;}
  function boolean(value){if(typeof value!=='boolean')fail();return value;}
  function defaults(){return {setupCompleted:true,profile:{school:'江苏科技大学',major:'',classNumber:1,batchNumber:1},reminders:{enabled:false,leadMinutes:10,mutedCourseIds:[],courseOverrides:{}}};}
  function validateSettings(input){
    if(!plain(input)||!plain(input.profile)||!plain(input.reminders))fail();
    const p=input.profile,r=input.reminders;
    if(!Array.isArray(r.mutedCourseIds)||r.mutedCourseIds.length>500||!plain(r.courseOverrides)||Object.keys(r.courseOverrides).length>500)fail();
    const overrides={};
    Object.keys(r.courseOverrides).forEach(id=>{
      const key=string(id,160),v=r.courseOverrides[id];if(!key||!plain(v)||['__proto__','prototype','constructor'].includes(key))fail();
      const out={};if(v.enabled!==undefined)out.enabled=boolean(v.enabled);if(v.leadMinutes!==undefined)out.leadMinutes=number(v.leadMinutes,0,120);
      if(!Object.keys(out).length)fail();overrides[key]=out;
    });
    const muted=Array.from(new Set(r.mutedCourseIds.map(id=>{const key=string(id,160);if(!key)fail();return key;})));
    const result={setupCompleted:boolean(input.setupCompleted),profile:{school:string(p.school,120),major:string(p.major,120),classNumber:number(p.classNumber,1,100),batchNumber:number(p.batchNumber,1,100)},reminders:{enabled:boolean(r.enabled),leadMinutes:number(r.leadMinutes,0,120),mutedCourseIds:muted,courseOverrides:overrides}};
    if(input.aiIdentity!==undefined){const a=input.aiIdentity;if(!plain(a))fail();result.aiIdentity={major:string(a.major,120),className:string(a.className,120),group:string(a.group,120)};if(!result.aiIdentity.className)fail();}
    return result;
  }
  function settings(state){return state.productSettings?validateSettings(state.productSettings):defaults();}
  function blankState(seed,fresh){const state=copy(seed);state.courses=[];state.importLedger=null;state.appliedUpdateIds=state.appliedUpdateIds||[];state.skipLegacyImportBaseline=true;state.productSettings=defaults();state.productSettings.setupCompleted=!fresh;return state;}
  function nativeId(value){let a=2166136261,b=3339675911;for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b^value.charCodeAt(i),2246822519);}return 'c-'+('00000000'+(a>>>0).toString(16)).slice(-8)+('00000000'+(b>>>0).toString(16)).slice(-8);}
  function nativeLabel(value,max){return String(value||'').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g,' ').trim().slice(0,max);}
  function nativePayload(state,now,model){
    const r=settings(state).reminders,occurrences=[];const horizon=now+366*86400000;
    const ids=new Map(),seenIds=new Map();
    state.courses.forEach(course=>{
      const mapped=nativeId(course.id);if(seenIds.has(mapped)&&seenIds.get(mapped)!==course.id)throw new Error('NATIVE_ID_COLLISION');ids.set(course.id,mapped);seenIds.set(mapped,course.id);
      const time=model.timeRange(course,state.periods);if(!time.exact||!time.start||!time.end)return;
      course.dates.forEach(date=>{
        const startMillis=Date.parse(date+'T'+time.start+':00+08:00'),endMillis=Date.parse(date+'T'+time.end+':00+08:00');
        if(!Number.isFinite(startMillis)||!Number.isFinite(endMillis)||endMillis<=now||startMillis>horizon)return;
        occurrences.push({id:mapped+'@'+date,courseId:mapped,date,name:nativeLabel(course.name,80)||'课程',room:nativeLabel(course.room,80),startMillis,endMillis});
      });
    });
    occurrences.sort((a,b)=>a.startMillis-b.startMillis||a.id.localeCompare(b.id));
    const selected=occurrences.slice(0,1500);
    const overrides={};Object.keys(r.courseOverrides).forEach(id=>{if(ids.has(id))overrides[ids.get(id)]=r.courseOverrides[id];});
    const payload={schemaVersion:1,theme:state.settings.theme||'auto',enabled:r.enabled,leadMinutes:r.leadMinutes,mutedCourseIds:r.mutedCourseIds.filter(id=>ids.has(id)).map(id=>ids.get(id)),courseOverrides:overrides,occurrences:selected};
    // Conservative UTF-8 budget: at most three bytes per UTF-16 code unit.
    while(JSON.stringify(payload).length>300000&&selected.length)selected.pop();
    Object.defineProperty(payload,'projectionInfo',{value:{eligible:occurrences.length,included:selected.length,truncated:occurrences.length>selected.length},enumerable:false});
    return payload;
  }
  return {defaults,validateSettings,settings,blankState,nativePayload,nativeId};
});
