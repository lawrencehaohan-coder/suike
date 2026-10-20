/* Display-only time axis. Teaching periods remain unchanged. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SuikeMinuteAxis=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const minute=s=>{if(typeof s!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s))throw Error('TIME_INVALID');const [h,m]=s.split(':').map(Number);return h*60+m;};
  const clock=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
  function range(c){if(c.timeMode!=='clock')return null;const p=(c.sourceTime||'').split('-');if(p.length!==2)return null;const a=minute(p[0]),b=minute(p[1]);if(b<=a)throw Error('TIME_INVALID');return {start:a,end:b};}
  function create(periods,courses,options){
    const regular=periods.map((p,i)=>({start:minute(p.start),end:minute(p.end),period:i+1}));
    const spans=regular.map(p=>p.end-p.start).sort((a,b)=>a-b),unit=76/spans[Math.floor(spans.length/2)];
    const times=courses.map(range).filter(Boolean),rows=[];let y=0;
    function push(a,b,period){
      if(a>=b)return;let parts=null,height=period?76:options&&options.collapsed?0:options&&options.compact?Math.min(64,(b-a)*unit):(b-a)*unit;
      if(!period&&options&&options.expanded){
        const points=Array.from(new Set([a,b].concat(times.flatMap(t=>[Math.max(a,Math.min(b,t.start)),Math.max(a,Math.min(b,t.end))])))).sort((x,z)=>x-z);let at=0;
        parts=[];for(let i=1;i<points.length;i++){const start=points[i-1],end=points[i],active=times.filter(t=>t.start<end&&t.end>start),h=active.length?(end-start)*Math.max(...active.map(t=>Math.max(64,Math.min(160,(t.end-t.start)*unit))/(t.end-t.start))):Math.min(12,(end-start)*unit);parts.push({start,end,y:at,height:h});at+=h;}
        height=at;
      }
      rows.push({start:a,end:b,period:period||null,height,y,row:rows.length+2,parts});y+=height;
    }
    function gap(a,b){if(!(options&&options.collapsed)&&times.some(t=>t.start<b&&a<t.end))push(a,b,null);}
    const first=regular[0],last=regular[regular.length-1];
    if(times.some(t=>t.start<first.start))gap(Math.floor(Math.min(...times.map(t=>t.start),first.start)/30)*30,first.start);
    regular.forEach((p,i)=>{if(i)gap(regular[i-1].end,p.start);push(p.start,p.end,p.period);});
    if(times.some(t=>t.end>last.end))gap(last.end,Math.min(1440,Math.ceil(Math.max(...times.map(t=>t.end),last.end)/30)*30));
    function position(n){for(const r of rows){if(n<=r.start)return r.y;if(n<=r.end){if(r.parts){const part=r.parts.find(p=>n<=p.end);return r.y+part.y+(n-part.start)/(part.end-part.start)*part.height;}return r.y+(n-r.start)/(r.end-r.start)*r.height;}}return y;}
    function place(c){const t=range(c);if(!t)return null;const top=position(t.start),bottom=position(t.end);return {top,height:bottom-top,duration:t.end-t.start};}
    return {rows,height:y,unit,position,place,periodRow:n=>rows.find(r=>r.period===n),startRow:n=>rows.find(r=>n>=r.start&&n<r.end)||rows[rows.length-1]};
  }
  // One readable entry per day and start row; exact duration marks remain separate.
  function groups(axis,courses){
    const result=new Map();courses.slice().sort((a,b)=>range(a).start-range(b).start||range(a).end-range(b).end||a.id.localeCompare(b.id)).forEach(c=>{
      const r=axis.startRow(range(c).start);if(!r)return;
      let group=result.get(r.row);if(!group){group={row:r,events:[]};result.set(r.row,group);}group.events.push(c);
    });return Array.from(result.values());
  }
  // Independent visual lanes for overlapping blocks, including short affairs.
  function lanes(items){
    const sorted=items.slice().sort((a,b)=>a.top-b.top||a.bottom-b.bottom),groups=[];
    sorted.forEach(item=>{let g=groups[groups.length-1];if(!g||item.top>=g.end){g={end:item.bottom,items:[]};groups.push(g);}g.items.push(item);g.end=Math.max(g.end,item.bottom);});
    groups.forEach(g=>{const ends=[];g.items.forEach(item=>{let lane=ends.findIndex(end=>end<=item.top);if(lane<0)lane=ends.length;ends[lane]=item.bottom;item.lane=lane;});g.items.forEach(item=>item.lanes=ends.length);});return items;
  }
  // Nearby positions in a folded break share a line; their exact times stay in the task cards.
  function indicators(axis,courses){
    const groups=[];
    courses.map(course=>{const p=axis.place(course);return {course,y:p.top+p.height/2};}).sort((a,b)=>a.y-b.y||a.course.id.localeCompare(b.course.id)).forEach(item=>{
      let group=groups[groups.length-1];
      if(!group||item.y-group.first>5){group={first:item.y,last:item.y,events:[]};groups.push(group);}
      group.last=item.y;group.events.push(item.course);group.y=(group.first+group.last)/2;
    });return groups;
  }
  function cardPlacement(axis,course){const p=axis.place(course),height=Math.max(64,Math.min(160,p.height));return {top:Math.max(0,Math.min(p.top,axis.height-height)),height,duration:p.duration};}
  function taskGroups(axis,courses){
    const result=[];courses.map(course=>({course,...cardPlacement(axis,course)})).sort((a,b)=>a.top-b.top||a.course.id.localeCompare(b.course.id)).forEach(item=>{
      let group=result[result.length-1];if(!group||item.top>=group.bottom){group={top:item.top,bottom:item.top+item.height,events:[]};result.push(group);}group.events.push(item.course);group.bottom=Math.max(group.bottom,item.top+item.height);group.height=Math.max(64,Math.min(160,group.bottom-group.top));
    });return result;
  }
  return {minute,clock,range,create,lanes,groups,indicators,cardPlacement,taskGroups};
});

