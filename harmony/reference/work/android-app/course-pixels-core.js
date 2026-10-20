(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SuikeCoursePixels=factory();})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const norm=v=>String(v||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
 const stamp=(date,time)=>Date.parse(date+'T'+time+':00+08:00');
 const rootId=c=>String(c.id||'').split('-edit-')[0];
 function phase(hour){return hour>=5&&hour<11?'morning':hour>=11&&hour<14?'noon':hour>=14&&hour<18?'afternoon':'night';}
 const pools={morning:['alpine-dawn','misty-forest','taj-dawn','jal-mahal','earthrise','salt-flat'],noon:['jungle-falls','deep-reef','kite-festival','saturn-rise','black-prism'],afternoon:['ocean-sunset','cloud-sea','lake-pichola','kyoto-dusk','night-highway','storm-plains'],night:['lantern-lake','aurora-fjord','desert-night','amer-fort','command-city','edge-orbit','gangaur-ghat','lava-wall','marine-drive','night-coast','planet-scale','prism-city','snow-train','tokyo-rain','varanasi-ghats','volcano-night']};
 function choose(view,at){at=Number.isFinite(at)?at:Date.now();const hour=new Date(at+28800000).getUTCHours(),day=Math.floor((at+28800000)/86400000),list=pools[phase(hour)],offset=Math.max(0,['today','week','settings'].indexOf(view));return list[((day+offset)%list.length+list.length)%list.length];}
 function related(state,target){
  const records=state.courses||[],ledger=state.importLedger&&state.importLedger.entries||[],ids=new Set([target.id]),roots=new Set([rootId(target)]),names=new Set([JSON.stringify([norm(target.name),norm(target.teacher)])]),keys=new Set();
  let changed=true;while(changed){changed=false;
   for(const entry of ledger)if(!entry.tombstone&&entry.association){if(ids.has(entry.association.courseId))keys.add(entry.sourceKey);else if(keys.has(entry.sourceKey)){ids.add(entry.association.courseId);changed=true;}}
   for(const c of records){const name=JSON.stringify([norm(c.name),norm(c.teacher)]);if(ids.has(c.id)||roots.has(rootId(c))||names.has(name)){if(!ids.has(c.id)){ids.add(c.id);changed=true;}if(!roots.has(rootId(c))||!names.has(name))changed=true;roots.add(rootId(c));names.add(name);}}
  }
  return records.filter(c=>ids.has(c.id));
 }
 function summarize(state,id,now){
  now=Number.isFinite(now)?now:Date.now();const target=(state.courses||[]).find(c=>c.id===id);if(!target)return null;
  const periods=state.periods||[],settings=state.settings||{},start=settings.startMonday||'',finish=start&&Number.isInteger(settings.totalWeeks)?stamp(start,'00:00')+settings.totalWeeks*604800000:Infinity;
  const today=new Date(now+28800000).toISOString().slice(0,10),units=[],seen=new Set();
  function add(c,date,begin,end,unit,index){
   const key=JSON.stringify([date,begin,end,unit,index]);if(seen.has(key))return;seen.add(key);
   const a=begin?stamp(date,begin):NaN,b=end?stamp(date,end):NaN;
   const status=Number.isFinite(a)&&Number.isFinite(b)?now>=b?'done':now>=a?'current':'upcoming':date<today?'done':'pending';
   units.push({date,begin:begin||'',end:end||'',unit,index,status,pending:!Number.isFinite(a)||!Number.isFinite(b),at:Number.isFinite(a)?a:stamp(date,'23:59')});
  }
  for(const c of related(state,target))for(const date of new Set(c.dates||[])){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||start&&(date<start||stamp(date,'00:00')>=finish))continue;
   const ordinary=c.timeMode!=='pending'&&c.timeMode!=='clock'&&Number.isInteger(c.start)&&Number.isInteger(c.end)&&c.start>0&&c.end>=c.start&&periods[c.end-1];
   if(ordinary){for(let p=c.start;p<=c.end;p++){const slot=periods[p-1];add(c,date,slot&&slot.start,slot&&slot.end,'period',p);}}
   else{const times=c.timeMode==='clock'&&/^(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d$/.test(c.sourceTime||'')?c.sourceTime.split('-'):[];add(c,date,times[0],times[1],'event',null);}
  }
  units.sort((a,b)=>a.at-b.at||(a.index||0)-(b.index||0));
  const count=(unit,status)=>units.filter(u=>(!unit||u.unit===unit)&&(!status||u.status===status)).length;
  const result={units,totalPeriods:count('period'),totalEvents:count('event'),donePeriods:count('period','done'),doneEvents:count('event','done'),current:count(null,'current'),pending:units.filter(u=>u.status==='pending').length};
  result.remainingPeriods=result.totalPeriods-result.donePeriods;result.remainingEvents=result.totalEvents-result.doneEvents;
  result.unit=result.totalPeriods?'节':'次';result.knownSemester=!!start;
  return result;
 }
 function pixels(units,limit=512){
  const step=Math.max(1,Math.ceil(units.length/limit)),out=[];
  for(let i=0;i<units.length;i+=step){const group=units.slice(i,i+step),state=group.some(u=>u.status==='current')?'current':group.some(u=>u.status==='upcoming')?'upcoming':group.some(u=>u.status==='pending')?'pending':'done';out.push({state,event:group.every(u=>u.unit==='event'),units:group});}
  return {step,items:out};
 }
 return {summarize,related,pixels,phase,pools,choose};
});
