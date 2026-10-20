const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const C=require('../campus-core.js'),M=require('../../timetable/dist/model.js'),root=path.resolve(__dirname,'..'),scope={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'campus-data.js'),'utf8'),scope);const S=JSON.parse(JSON.stringify(scope.window.SuikeCampusScene));const by=id=>S.buildings.find(b=>b.id===id);
test('the library ellipse and its final pixel footprint are mirror symmetric without protrusions',()=>{
 const b=by('library'),[cx,cy]=b.shape.center,[rx,ry]=b.shape.radii,cells=new Set();
 assert.equal(b.shape.type,'ellipse');assert.deepEqual(b.anchor,[cx,cy]);assert.ok(rx>0&&ry>0);
 for(const [x0,y0,x1,y1] of b.roofs)for(let y=y0+1;y<y1;y+=2)for(let x=x0+1;x<x1;x+=2){assert.ok(((x-cx)/rx)**2+((y-cy)/ry)**2<1.01);cells.add(x+','+y);}
 for(const key of cells){const [x,y]=key.split(',').map(Number);assert.ok(cells.has((2*cx-x)+','+y));assert.ok(cells.has(x+','+(2*cy-y)));}
 for(let y=b.bounds[1]+1;y<b.bounds[3];y+=2){const xs=[...cells].map(k=>k.split(',').map(Number)).filter(p=>p[1]===y).map(p=>p[0]).sort((a,b)=>a-b);for(let i=1;i<xs.length;i++)assert.equal(xs[i]-xs[i-1],2);}
});
test('straight-sided building footprints retain orthogonal corners after photo rectification',()=>{
 const plan=JSON.parse(fs.readFileSync(path.join(root,'vendor/just-zjg-campus/scene-calibrated.json'),'utf8'));
 for(const b of plan.buildings){if(!['rectangle','L','C'].includes(b.shape.type))continue;for(let i=0;i<b.pts.length;i++){const a=b.pts[i],p=b.pts[(i+1)%b.pts.length];assert.ok(a[0]===p[0]||a[1]===p[1],b.name+' has a skewed edge');}}
});
test('the calibrated scene contains all 45 buildings and two non-building commercial zones, a true isometric overview and dense quantized roofs',()=>{
 assert.equal(S.buildings.length,45);assert.ok(Math.abs(S.overview.elev-35.264389682754654)<1e-6);assert.equal(S.overview.yaw,45);assert.equal(new Set(S.buildings.map(b=>b.id)).size,45);for(const b of S.buildings){assert.ok(b.roofs.length);assert.ok(b.walls.length);assert.ok(b.roofs.every(r=>r.every(n=>n%2===0)));assert.ok(b.anchor[0]>=b.bounds[0]&&b.anchor[0]<=b.bounds[2]&&b.anchor[1]>=b.bounds[1]&&b.anchor[1]<=b.bounds[3]);}
});
test('the four E–H wings have distinct targets and match the plan board relative positions',()=>{
 const ids=['E','F','G','H'].map(x=>C.resolve({room:'张教学楼'+x+'-101'},null,S).building.id);assert.equal(new Set(ids).size,4);const [e,f,g,h]=ids.map(by);assert.ok(e.center[0]<f.center[0]);assert.ok(g.center[0]<h.center[0]);assert.ok(e.center[1]>g.center[1]);assert.ok(f.center[1]>h.center[1]);assert.ok(by('library').center[0]>e.center[0]&&by('library').center[0]<by('osm-262554957').center[0]);
});
test('the photographed dorm numbers 1–13, teacher apartment and north/south zones are represented separately',()=>{
 for(let i=1;i<=13;i++)assert.ok(by('plan-dorm-'+i));assert.ok(by('plan-teachers'));assert.ok(by('plan-dorm-11').center[1]>by('osm-260621106').center[1]);assert.ok(by('osm-260621106').center[1]>by('plan-teaching-H').center[1]);assert.ok(by('osm-260623023').center[1]<by('library').center[1]);assert.ok(by('business').center[0]<by('telecom-college').center[0]);
});
test('room punctuation normalizes without guessing an unknown classroom or another campus',()=>{
 for(const room of ['张外语楼-215','外语楼 215'])assert.equal(C.resolve({room},null,S).building.id,'osm-262555503');assert.equal(C.resolve({room:'张教学楼 Ｅ－１０１'},null,S).building.id,'plan-teaching-E');assert.equal(C.resolve({room:'F104'},null,S).building.id,'plan-teaching-F');assert.equal(C.resolve({room:'地点待补充'},null,S),null);assert.equal(C.resolve({room:'明志楼'},null,S),null);assert.equal(C.eligible({courses:[{room:'张教学楼E-101'}],importLedger:{source:{system:'other',term:'t'}}}),false);
});
test('the lamp uses exact minutes: steady future, breathing current, gray completed and explicit unknown time',()=>{
 const periods=[{start:'08:00',end:'08:45'}],c={start:1,end:1},date='2026-10-20';assert.equal(C.status(c,date,date,479,M,periods),'upcoming');assert.equal(C.status(c,date,date,480,M,periods),'current');assert.equal(C.status(c,date,date,525,M,periods),'done');assert.equal(C.status(c,'2026-10-21',date,600,M,periods),'upcoming');assert.equal(C.status(c,'2026-10-19',date,450,M,periods),'done');assert.equal(C.status({timeMode:'clock',sourceTime:'06:40-06:50',start:null,end:null},date,date,405,M,periods),'current');assert.equal(C.status({timeMode:'pending',timeNote:'待确认'},date,date,480,M,periods),'unknown');
});
test('hero interpolation remains top-down, starts and ends exactly, and can retarget from its current camera',()=>{
 const from={x:292,y:400,elev:90,zoom:1},to={x:150,y:200,elev:90,zoom:5};assert.deepEqual(C.cameraAt(from,to,0),from);assert.deepEqual(C.cameraAt(from,to,1),to);for(let i=0;i<=100;i++){const p=C.cameraAt(from,to,i/100);assert.equal(p.elev,90);assert.ok(p.zoom>=.65&&p.zoom<=5);}const mid=C.cameraAt(from,to,.4);assert.deepEqual(C.cameraAt(mid,from,0),mid);
});
test('rendering stops after the camera settles, pauses while inactive and caps the high-density backing surface',()=>{
 const callbacks=new Map();let serial=0,t=0;const marker={style:{},hidden:true},ctx=new Proxy({}, {get(o,k){return o[k]||(o[k]=()=>{});},set(o,k,v){o[k]=v;return true;}}),canvas={getContext:()=>ctx};const env={window:{devicePixelRatio:3},performance:{now:()=>t},requestAnimationFrame:fn=>{callbacks.set(++serial,fn);return serial},cancelAnimationFrame:id=>callbacks.delete(id),Date};vm.runInNewContext(fs.readFileSync(path.join(root,'campus-massing.js'),'utf8'),env);vm.runInNewContext(fs.readFileSync(path.join(root,'campus-renderer.js'),'utf8'),env);const r=env.window.SuikeCampusRenderer.create(canvas,marker,S,C);r.resize(1600,900);assert.ok(r.stats.pixels<=1080000);assert.equal(r.stats.draws,0);r.setActive(true);assert.ok(r.stats.visibleParts['roof-rack']>0);r.focus({building:by('plan-teaching-E')},true);for(let i=0;i<120&&callbacks.size;i++){t+=16;const list=Array.from(callbacks.values());callbacks.clear();list.forEach(fn=>fn(t));}assert.equal(r.stats.running,false);assert.equal(callbacks.size,0);const drawn=r.stats.draws;r.setActive(false);r.redraw();assert.equal(r.stats.draws,drawn);r.focus({building:by('plan-teaching-F')},true);assert.equal(callbacks.size,0);r.setActive(true);assert.ok(callbacks.size);r.setActive(false);assert.equal(callbacks.size,0);marker.hidden=false;r.focus(null,false);assert.equal(marker.hidden,true);
});

test('height estimates preserve the reviewed hierarchy and every building is explicitly approximate',()=>{
 const evidence=JSON.parse(fs.readFileSync(path.join(root,'vendor/just-zjg-campus/height-estimates.json'),'utf8'));assert.equal(evidence.photographsReviewed,23);assert.equal(evidence.buildings.length,45);for(const b of evidence.buildings){assert.equal(b.surveyed,false);assert.ok(b.references.length&&b.note&&b.confidence);assert.ok(b.metres>0);}assert.ok(by('osm-260623023').height>by('library').height);assert.ok(by('library').height>by('plan-teaching-F').height);assert.ok(by('plan-teaching-F').height>by('plan-service-1').height);
});
test('isometric projection has equally shortened x y and z axes and a smooth move to north-up roof focus',()=>{
 const a=S.overview.elev*Math.PI/180,yaw=S.overview.yaw*Math.PI/180,lx=Math.hypot(Math.cos(yaw),Math.sin(yaw)*Math.sin(a)),ly=Math.hypot(Math.sin(yaw),Math.cos(yaw)*Math.sin(a)),lz=Math.cos(a);assert.ok(Math.abs(lx-ly)<1e-10&&Math.abs(lx-lz)<1e-10);const to={x:514,y:312,elev:90,yaw:0,zoom:4};assert.deepEqual(C.cameraAt(S.overview,to,0),S.overview);assert.deepEqual(C.cameraAt(S.overview,to,1),to);for(let i=0;i<=100;i++){const p=C.cameraAt(S.overview,to,i/100);assert.ok(p.elev>=S.overview.elev&&p.elev<=90);assert.ok(p.yaw>=0&&p.yaw<=45);}
});

test('photograph-informed details have a near-ground wrapped gym shell, an open administration frame and restrained roof racks',()=>{
 const faces=require('../campus-massing.js').build(S),gym=faces.filter(f=>f.id==='osm-260623895'&&f.part==='wrapped-shell');assert.equal(gym.length,40);const heights=gym.flatMap(f=>f.points.map(p=>p[2]));assert.equal(Math.max(...heights),19);assert.equal(Math.min(...heights),2.2);assert.ok(gym.slice(10,30).flatMap(f=>f.points).every(p=>p[2]>18));assert.equal(faces.filter(f=>f.id==='osm-260623895'&&f.part==='entrance-stair').length,12);assert.equal(faces.filter(f=>f.id==='osm-260623895'&&f.part==='entrance-door').length,5);for(const f of faces)assert.ok(f.points.every(p=>p.every(Number.isFinite)));const admin=faces.filter(f=>f.id==='osm-260623023'&&f.shade===0&&f.points.every(p=>p[2]===34));assert.equal(admin.length,22);for(const f of admin){const xs=f.points.map(p=>p[0]),ys=f.points.map(p=>p[1]);assert.ok((Math.max(...xs)-Math.min(...xs))*(Math.max(...ys)-Math.min(...ys))<250);}assert.equal(faces.filter(f=>f.part==='roof-rack').length,70);assert.ok(faces.some(f=>f.id==='library'&&f.part==='library-eave'&&f.points.some(p=>p[2]===24.8)));
});

