/* Pure room matching, status and continuous orthographic camera interpolation. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SuikeCampusCore=api;})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const normalize=value=>String(value||'').normalize('NFKC').replace(/[‐‑–—−－]/g,'-').replace(/\s+/g,'').trim();
 const ids={A:'osm-262554957',B:'osm-262554891',C:'osm-262555111',D:'osm-262555479',E:'plan-teaching-E',F:'plan-teaching-F',G:'plan-teaching-G',H:'plan-teaching-H'};
 function key(course){return normalize(course.room)?'room:'+normalize(course.room):'course:'+course.id;}
 function campusRoom(room,system,scene){const value=normalize(room);return /张家港|张(?:教学|外语)楼/.test(value)||!!(system==='just-jwglxt'&&scene&&scene.buildings.some(b=>(b.aliases||[]).some(alias=>value.includes(normalize(alias)))));}
 function eligible(state,detected,scene){const source=state.importLedger&&state.importLedger.source||{},system=source.system;if(system&&system!=='just-jwglxt')return false;return state.courses.some(c=>campusRoom(c.room,system,scene))||!!(system==='just-jwglxt'&&detected&&detected===source.term);}
 function resolve(course,bindings,scene){
  const buildings=scene.buildings,manual=bindings&&bindings[key(course)],find=id=>buildings.find(b=>b.id===id);
  if(manual&&find(manual))return {building:find(manual),manual:true,room:course.room||'地点待补充'};
  const room=normalize(course.room).replace(/^张家港(?:校区)?/,'');let id=null,label=null,match;
  // Specific campus aliases take precedence over generic room names such as 报告厅.
  const aliases=buildings.filter(b=>(b.aliases||[]).some(alias=>room.includes(normalize(alias))));
  if(aliases.length===1)id=aliases[0].id;
  else if(/外语楼|外语教学楼/.test(room))id='osm-262555503';
  else if((match=room.match(/(?:张?教学楼|江科大(?:校区)?教学楼|苏理工(?:教学楼)?)([A-H])(?:区)?(?:-|\d|$)/i))||(match=room.match(/^([A-H])-?\d{3,4}$/i))){const block=match[1].toUpperCase();id=ids[block];label=null;}
  else if(/图书馆|博闻馆/.test(room))id='library';
  else if(/体育馆/.test(room))id='osm-260623895';
  else if(/行政楼/.test(room))id='osm-260623023';
  else if(/报告厅/.test(room))id='osm-260623230';
  else if(/船海|航海楼/.test(room))id='ship-civil';
  else if(/工程实训|工程训练/.test(room))id='training-center';
  else if(/机电与动力|机动学院/.test(room))id='mechanical';
  else if(/电信学院/.test(room))id='telecom-college';
  else if(/智能电力/.test(room))id='power-institute';
  else if(/机房/.test(room))id='server-room';
  else if(/商学院/.test(room))id='business';
  else if(/冶金材料/.test(room))id='metallurgy';
  if(!id){const named=buildings.filter(b=>b.name&&!['学生公寓','生活服务'].includes(b.name)&&room.includes(normalize(b.name)));if(named.length===1)id=named[0].id;}
  return id&&find(id)?{building:find(id),manual:false,label,room:course.room||'地点待补充'}:null;
 }
 function status(course,date,today,minute,model,periods){if(!course)return 'unknown';const time=model.timeRange(course,periods);if(!time.exact)return 'unknown';if(date<today)return 'done';if(date>today)return 'upcoming';const n=s=>Number(s.slice(0,2))*60+Number(s.slice(3));return minute<n(time.start)?'upcoming':minute>=n(time.end)?'done':'current';}
 function defaultCourse(state,date,today,minute,model){
  const values=state.courses.flatMap(c=>c.dates.filter(d=>date===today?d>=today:d===date).map(d=>({course:c,date:d,time:model.timeRange(c,state.periods)}))).filter(v=>v.time.exact).sort((a,b)=>a.date.localeCompare(b.date)||a.time.start.localeCompare(b.time.start)||a.course.id.localeCompare(b.course.id));
  const current=values.filter(v=>status(v.course,v.date,today,minute,model,state.periods)==='current');if(current.length)return current.find(v=>v.course.timeMode==='clock')||current[0];
  return values.find(v=>date!==today||v.date>today||status(v.course,v.date,today,minute,model,state.periods)==='upcoming')||null;
 }
 const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*t*(t*(t*6-15)+10);};
 function cameraAt(from,to,t){const s=ease(t),arc=Math.sin(Math.PI*Math.max(0,Math.min(1,t)))**2,distance=Math.hypot(to.x-from.x,to.y-from.y),out={};for(const k of ['x','y','elev','zoom'])out[k]=from[k]+(to[k]-from[k])*s;if(from.yaw!==undefined||to.yaw!==undefined)out.yaw=(from.yaw||0)+((to.yaw||0)-(from.yaw||0))*s;
  if(distance>80){out.zoom=Math.max(.65,out.zoom-arc*Math.min(from.zoom,to.zoom)*.55);}return out;
 }
 return {normalize,key,campusRoom,eligible,resolve,status,defaultCourse,ease,cameraAt};
});
