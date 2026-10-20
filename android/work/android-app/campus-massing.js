/* Lightweight, photograph-informed white-model details; original ground plans remain canonical. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SuikeCampusMassing=api;})(typeof window==='object'?window:globalThis,function(){'use strict';
 function build(scene){const faces=[];
  function face(points,shade,b,extra){const center=points.reduce((c,p)=>[c[0]+p[0]/points.length,c[1]+p[1]/points.length,c[2]+p[2]/points.length],[0,0,0]);faces.push(Object.assign({points,shade,id:b.id,center},extra));}
  function box(b,x0,y0,x1,y1,z0,z1){face([[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],0,b);for(const [axis,d,a,v0,v1] of [[0,-1,x0,y0,y1],[0,1,x1,y0,y1],[1,-1,y0,x0,x1],[1,1,y1,x0,x1]]){const pts=axis===0?[[a,v0,z0],[a,v1,z0],[a,v1,z1],[a,v0,z1]]:[[v0,a,z0],[v1,a,z0],[v1,a,z1],[v0,a,z1]];face(pts,axis===0?1:2,b,{axis,d});}}
  function gym(b,detail){
   const [x0,y0,x1,y1]=b.bounds,w=x1-x0,h=y1-y0,cx=(x0+x1)/2,count=detail.roofSegments||40,foot=detail.shellFootHeight||2.2,shoulder=detail.shoulderFraction||.22,drop=detail.crownDrop||.6;
   const profile=t=>{const u=Math.min(t,1-t);return u<shoulder?foot+(b.height-drop-foot)*Math.sqrt(Math.max(0,1-((shoulder-u)/shoulder)**2)):b.height-drop*((t-.5)/(.5-shoulder))**2;};
   const at=(t,y)=>{const q=(y-y0)/h,left=x0+w*.13*q,right=x1-w*.13*q;return [left+(right-left)*t,y,profile(t)];};
   for(let i=0;i<count;i++){const a=i/count,c=(i+1)/count;face([at(a,y0),at(c,y0),at(c,y1),at(a,y1)],0,b,{edge:i%4===0,part:'wrapped-shell'});}
   // End facades use an inward recess; the wrap itself remains a thin shell at both shoulders.
   for(const [y,d] of [[y0+.9,-1],[y1-.9,1]]){const arc=Array.from({length:count+1},(_,i)=>at(i/count,y));face([[arc[0][0],y,0],...arc,[arc[arc.length-1][0],y,0]],2,b,{axis:1,d,depthBias:-b.height*.65,part:'recessed-gym-facade'});}
   for(const t of [0,1]){const a=at(t,y0),c=at(t,y1);face([[a[0],a[1],0],[c[0],c[1],0],c,a],1,b,{axis:0,d:t===0?-1:1,part:'shell-foot'});}
   const px0=cx-w*.33,px1=cx+w*.33,front=y0-h*.105,rear=y0+h*.035,platform=detail.platformHeight||3.5,canopy=detail.canopyHeight||8.8;
   box(b,px0,front,px1,rear,platform-.7,platform);
   // A separate shallow canopy, open gallery and columns: no solid block under the entrance.
   box(b,px0-w*.025,front-h*.025,px1+w*.025,y0+h*.06,canopy-.5,canopy);
   for(const x of [px0+w*.025,cx-w*.12,cx+w*.12,px1-w*.025]){box(b,x-.55,front+.7,x+.55,front+1.8,platform,canopy-.5);box(b,x-.55,front+.7,x+.55,front+1.8,0,platform-.7);}
   for(const x of [px0,px1-.7])box(b,x,front,x+.7,rear,platform,platform+.65);
   box(b,px0,front,px1,front+.55,platform+.65,platform+.9);
   const steps=detail.stairs||12,sx0=cx-w*.18,sx1=cx+w*.18,footY=front-h*.23,run=front-footY;
   for(let i=0;i<steps;i++){
    const ya=footY+run*i/steps,yb=footY+run*(i+1)/steps,z=platform*(i+1)/steps;
    face([[sx0,ya,z],[sx1,ya,z],[sx1,yb,z],[sx0,yb,z]],0,b,{edge:true,part:'entrance-stair'});
    face([[sx0,ya,platform*i/steps],[sx1,ya,platform*i/steps],[sx1,ya,z],[sx0,ya,z]],2,b,{axis:1,d:-1,part:'stair-riser'});
   }
   // Tall doors behind the portico; these shaded planes add no extra storeys.
   for(let i=0;i<5;i++){const x=cx-w*.24+i*w*.1;face([[x,y0+.55,platform+.2],[x+w*.055,y0+.55,platform+.2],[x+w*.055,y0+.55,canopy-.9],[x,y0+.55,canopy-.9]],2,b,{axis:1,d:-1,material:'window',part:'entrance-door'});}
  }
  scene.buildings.forEach(b=>{const detail=b.details||{},base=detail.wallHeight||b.height,[x0,y0,x1,y1]=b.bounds,w=x1-x0,h=y1-y0;
   if(detail.type==='wrapped-shell-gym'){gym(b,detail);return;}
   b.walls.forEach(([axis,d,a,v0,v1])=>{face(axis===0?[[a,v0,0],[a,v1,0],[a,v1,base],[a,v0,base]]:[[v0,a,0],[v1,a,0],[v1,a,base],[v0,a,base]],axis===0?1:2,b,{axis,d,floors:detail.wallFloors||b.estimatedFloors||1});});
   if(detail.type==='barrel-vault-gym'){
    const count=detail.roofSegments||24,rise=detail.roofRise||10,z=t=>base+rise*Math.sqrt(Math.max(0,1-(2*t-1)**2)),at=(t,y)=>{const q=(y-y0)/h,left=x0+w*.13*q,right=x1-w*.13*q;return [left+(right-left)*t,y,z(t)];};
    for(let i=0;i<count;i++){const a=i/count,c=(i+1)/count;face([at(a,y0),at(c,y0),at(c,y1),at(a,y1)],0,b,{edge:true,part:'barrel-roof'});}
    for(const [y,d] of [[y0,-1],[y1,1]]){const arc=Array.from({length:count+1},(_,i)=>at(i/count,y));face(arc,2,b,{axis:1,d,part:'curved-gable'});}
   }else{
    b.roofs.forEach(r=>face([[r[0],r[1],base],[r[2],r[1],base],[r[2],r[3],base],[r[0],r[3],base]],0,b));
   }
   if(detail.type==='elliptical-library'){
    const [cx,cy]=b.shape.center,scale=detail.capScale||1.025,top=b.height+(detail.roofCap||.8),xy=(x,y,z)=>[cx+(x-cx)*scale,cy+(y-cy)*scale,z];
    b.roofs.forEach(r=>face([xy(r[0],r[1],top),xy(r[2],r[1],top),xy(r[2],r[3],top),xy(r[0],r[3],top)],0,b,{part:'library-eave'}));
    b.walls.forEach(([axis,d,a,v0,v1])=>face(axis===0?[xy(a,v0,b.height),xy(a,v1,b.height),xy(a,v1,top),xy(a,v0,top)]:[xy(v0,a,b.height),xy(v1,a,b.height),xy(v1,a,top),xy(v0,a,top)],axis===0?1:2,b,{axis,d,part:'library-eave'}));
   }
   if(detail.type==='open-roof-frame'){
    const top=detail.frameTop||b.height,beam=1.4,count=detail.columns||9;
    for(let i=0;i<count;i++){const x=x0+beam+(w-3*beam)*i/(count-1);for(const y of [y0+beam,y1-2*beam])box(b,x,y,x+beam,y+beam,base,top);}
    box(b,x0,y0,x1,y0+beam,top-.8,top);box(b,x0,y1-beam,x1,y1,top-.8,top);box(b,x0,y0,x0+beam,y1,top-.8,top);box(b,x1-beam,y0,x1,y1,top-.8,top);
   }
   if(detail.type==='dorm-roof-racks'){
    const count=detail.racks||5,depth=Math.min(7,h*.45),z0=base+.3,z1=detail.rackTop||b.height;
    for(let i=0;i<count;i++){const x=x0+w*(i+.5)/count,pw=Math.min(w/count*.68,10),y=(y0+y1-depth)/2;face([[x-pw/2,y,z0],[x+pw/2,y,z0],[x+pw/2,y+depth,z1],[x-pw/2,y+depth,z1]],1,b,{edge:true,part:'roof-rack'});for(const xx of [x-pw/2,x+pw/2])box(b,xx,y+depth-.7,xx+.6,y+depth,base,z1);}
   }
  });return faces;
 }
 return {build};
});
