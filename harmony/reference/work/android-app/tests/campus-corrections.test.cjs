const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),C=require('../campus-core.js'),scope={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'campus-data.js'),'utf8'),scope);
const S=JSON.parse(JSON.stringify(scope.window.SuikeCampusScene)),by=id=>S.buildings.find(b=>b.id===id),plan=JSON.parse(fs.readFileSync(path.join(root,'vendor/just-zjg-campus/scene-calibrated.json'),'utf8'));
function inside(p,pts){let hit=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const a=pts[i],b=pts[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
test('both commercial areas are dashed ground zones and cannot create phantom buildings or binding targets',()=>{
 assert.equal(S.zones.length,2);assert.ok(S.zones.every(z=>z.type==='commercial'&&z.outline==='dashed'&&!z.height));
 assert.ok(!by('plan-commercial'));assert.ok(!S.features.some(f=>f.name==='休闲广场'));
 const faces=require('../campus-massing.js').build(S);assert.ok(S.zones.every(z=>!faces.some(f=>f.id===z.id)));
 const course={id:'shop',room:'商业街'};assert.equal(C.resolve(course,{'room:商业街':'plan-commercial'},S),null);
});
test('teaching A leaves a visible library ring road corridor including the projecting eave',()=>{
 const a=by('osm-262554957'),lib=by('library'),eave=lib.shape.center[0]+lib.shape.radii[0]*1.025;
 assert.ok(Math.min(...a.roofs.map(r=>r[0]))-eave>=16);
 const ring=plan.roads.find(r=>r.pts.length>40),east=plan.roads.find(r=>r.calibrationNote);
 assert.ok(east&&ring);assert.ok(Math.max(...ring.pts.map(p=>p[0]))+ring.width/2<a.bounds[0]);
 for(let i=0;i<=100;i++){const t=i/100,p=east.pts[0].map((v,k)=>v+(east.pts[1][k]-v)*t);assert.ok(p[0]-east.width/2>eave);}
});
test('the regular auditorium ellipse attaches to the west wall and stays clear of the neighbouring watercourse',()=>{
 const a=by('osm-260623023'),hall=by('osm-260623230'),[x,y]=hall.shape.center;
 assert.equal(hall.shape.type,'ellipse');assert.ok(x<a.center[0]);assert.ok(y>a.bounds[1]&&y<a.bounds[3]);
 assert.equal(Math.max(...hall.roofs.map(r=>r[2])),Math.min(...a.roofs.map(r=>r[0])));
 assert.deepEqual(hall.anchor,[x,y]);
 for(const rect of hall.roofs)for(let xx=rect[0]+1;xx<rect[2];xx+=2)for(let yy=rect[1]+1;yy<rect[3];yy+=2)assert.ok(!inside([xx,yy],S.waters[0].pts),'annex is over water');
});
test('ship-civil aliases resolve imported locations with prefixes, fullwidth digits and specific room suffixes without rewriting courses',()=>{
 const aliases=['船海土木楼','船海楼','海纳楼','航海楼','机动院办公室'];
 assert.deepEqual(by('ship-civil').aliases,aliases);
 for(const name of aliases)for(const room of [name,name+'-301','张家港校区 '+name+' ３０１',name+'报告厅']){
  const course={id:'imported',room,start:1,end:2,dates:['2026-10-20']},before=JSON.stringify(course);
  assert.equal(C.resolve(course,null,S).building.id,'ship-civil',room);assert.equal(JSON.stringify(course),before);
 }
 assert.equal(C.resolve({room:'机动学院-201'},null,S).building.id,'mechanical');
 assert.equal(C.resolve({room:'报告厅'},null,S).building.id,'osm-260623230');
 assert.equal(C.resolve({room:'海纳路301'},null,S),null);
});
test('a JUST import containing only a building alias can enable the campus map, while other schools cannot',()=>{
 for(const room of ['海纳楼301','机动院办公室']){const state={courses:[{room}],importLedger:{source:{system:'just-jwglxt',term:'test-term'}}};
  assert.equal(C.campusRoom(room,'just-jwglxt',S),true);assert.equal(C.eligible(state,'',S),true);
  state.importLedger.source.system='other';assert.equal(C.eligible(state,'',S),false);
  assert.equal(C.eligible({courses:[{room}]},'',S),false);
 }
});
