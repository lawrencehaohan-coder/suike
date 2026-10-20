const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const R=path.resolve(__dirname,'..'),oldSource=fs.readFileSync(path.join(__dirname,'fixtures/beta18-liquid-map-scheduler.js'),'utf8');
const schedulerSource=fs.readFileSync(path.join(R,'liquid-map-scheduler.js'),'utf8'),opticsSource=fs.readFileSync(path.join(R,'liquid-optics.js'),'utf8');
function rawFixture(source,dpr){
 let allocations=0;
 const c=vm.createContext({performance:require('node:perf_hooks').performance,setTimeout:fn=>setImmediate(fn),Uint8Array,Uint8ClampedArray,Uint32Array,
  ImageData:class{constructor(w,h){allocations++;this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4);}}});
 c.window=c;c.devicePixelRatio=dpr;vm.runInContext(opticsSource,c);vm.runInContext(source,c);
 return {build:(shape,options)=>c.SuikeScheduledOptics.buildRaw(shape,options),allocations:()=>allocations};
}
test('custom displacement pixels and strength remain identical at DPR 1, 2 and 3, including tiny and fractional shapes',async()=>{
 const shapes=[{width:24,height:18,radius:8},{width:71.4,height:32.6,radius:16.3},{width:360,height:64,radius:32},{width:360,height:560,radius:28},{width:360,height:1000,radius:22}];
 for(const dpr of [1,2,3]){
  const before=rawFixture(oldSource,dpr),after=rawFixture(schedulerSource,dpr);
  for(const shape of shapes){
   const options={bezel:12,thickness:18,ior:1.33,profile:'squircle',clear:true,offthread:true};
   const a=await before.build(shape,options),b=await after.build(shape,options);
   assert.equal(b.resolution,a.resolution);assert.equal(b.scale,a.scale);assert.equal(b.displacement.width,a.displacement.width);assert.equal(b.displacement.height,a.displacement.height);
   assert.deepEqual(Buffer.from(b.displacement.data),Buffer.from(a.displacement.data),JSON.stringify({shape,dpr}));
   assert.equal(b.specular,null,'the existing vector sheen replaces this unused allocation');
  }
  assert.equal(after.allocations(),0);
 }
});
test('large wallpaper lenses evaluate less than 15% of texels without reducing texture resolution',async()=>{
 const h=rawFixture(schedulerSource,3);
 const raw=await h.build({width:360,height:800,radius:28},{bezel:12,thickness:18,ior:1.33,profile:'squircle',clear:true,offthread:true});
 assert.ok(raw.totalPixels>1100000);assert.ok(raw.visitedPixels/raw.totalPixels<.15);assert.equal(h.allocations(),0);
});
test('standard material retains both original displacement and specular pixels',async()=>{
 const a=await rawFixture(oldSource,3).build({width:130,height:76,radius:27},{bezel:12,thickness:18,ior:1.5,profile:'squircle'});
 const b=await rawFixture(schedulerSource,3).build({width:130,height:76,radius:27},{bezel:12,thickness:18,ior:1.5,profile:'squircle'});
 assert.deepEqual(Buffer.from(b.displacement.data),Buffer.from(a.displacement.data));assert.deepEqual(Buffer.from(b.specular.data),Buffer.from(a.specular.data));assert.equal(b.scale,a.scale);
});

const clientSource=fs.readFileSync(path.join(R,'liquid-worker-client.js'),'utf8').replace('/* SUIKE_OPTICS_WORKER_SOURCE */null',JSON.stringify('bundled trusted math'));
function clientFixture(blocked=false){
 const timers=new Map(),listeners={},workers=[];let serial=0,revokes=0;
 class WorkerMock{constructor(url){if(blocked)throw Error('CSP blocked');this.url=url;this.sent=[];workers.push(this);}postMessage(job){this.sent.push(job);}terminate(){this.terminated=true;}}
 const c=vm.createContext({Worker:WorkerMock,OffscreenCanvas:class{},Blob,URL:{createObjectURL:()=> 'blob:synthetic',revokeObjectURL:()=>revokes++},
  setTimeout(fn){const id=++serial;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),addEventListener:(type,fn)=>listeners[type]=fn});
 c.window=c;c.devicePixelRatio=3;vm.runInContext(clientSource,c);
 return {client:c.SuikeOpticsWorker,workers,timers,listeners,revokes:()=>revokes};
}
test('worker requests preserve DPR and correlate out-of-order results; no course or API context is sent',async()=>{
 const h=clientFixture(),a=h.client.build({width:100,height:60,radius:24},{clear:true}),b=h.client.build({width:220,height:300,radius:24},{clear:true});
 const w=h.workers[0];assert.equal(w.sent[0].dpr,3);assert.deepEqual(Object.keys(w.sent[0]).sort(),['dpr','id','options','shape']);
 w.onmessage({data:{id:2,result:{scale:12}}});w.onmessage({data:{id:1,result:{scale:6}}});
 assert.equal((await a).scale,6);assert.equal((await b).scale,12);assert.equal(h.client.status.pending,0);assert.equal(h.timers.size,0);assert.equal(h.revokes(),1);
});
test('blocked workers use the cooperative fallback without hanging startup',async()=>{
 const h=clientFixture(true);assert.equal(await h.client.build({},{}),null);assert.equal(h.workers.length,0);assert.equal(h.client.status.pending,0);assert.equal(h.revokes(),1);
});
test('a worker failure releases every pending request and avoids repeated failed construction',async()=>{
 for(const responseError of [false,true]){
  const h=clientFixture(),a=h.client.build({},{}),b=h.client.build({},{});
  if(responseError)h.workers[0].onmessage({data:{id:1,error:'Worker canvas unavailable'}});else h.workers[0].onerror({preventDefault(){}});
  assert.equal(await a,null);assert.equal(await b,null);assert.equal(await h.client.build({},{}),null);assert.equal(h.workers.length,1);assert.equal(h.timers.size,0);assert.equal(h.workers[0].terminated,true);
 }
});
test('worker timeout or page disposal releases queued work',async()=>{
 for(const timeout of [false,true]){
  const h=clientFixture(),result=h.client.build({},{});
  if(timeout)[...h.timers.values()][0]();else h.listeners.pagehide();
  assert.equal(await result,null);assert.equal(h.client.status.pending,0);assert.equal(h.timers.size,0);assert.equal(h.workers[0].terminated,true);
 }
});
test('the real worker pipeline preserves native DPR, pixels and queue ordering',async()=>{
 const pixels=[],responses=[];
 const c=vm.createContext({performance:require('node:perf_hooks').performance,setTimeout,Uint8Array,Uint8ClampedArray,Uint32Array,
  ImageData:class{constructor(data,w,h){this.data=data;this.width=w;this.height=h;}},
  OffscreenCanvas:class{constructor(w,h){this.width=w;this.height=h;}getContext(){return {putImageData(image){pixels.push(image);}};}async convertToBlob(){return new Blob(['native PNG encoder stub'],{type:'image/png'});}},
  Blob,FileReaderSync:class{readAsDataURL(){return 'data:image/png;base64,synthetic';}}});
 c.window=c;c.self=c;c.postMessage=message=>responses.push(message);
 vm.runInContext(opticsSource+'\n'+schedulerSource+'\n'+fs.readFileSync(path.join(R,'liquid-optics-worker.js'),'utf8'),c);
 const options={bezel:12,thickness:18,ior:1.33,profile:'squircle',clear:true};
 const shape={width:120,height:68,radius:28};
 c.onmessage({data:{id:1,shape,options,dpr:3}});c.onmessage({data:{id:2,shape,options,dpr:2}});
 for(let i=0;i<40&&responses.length<2;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(responses.map(x=>x.id),[1,2]);
 for(let i=0;i<2;i++){
  const old=await rawFixture(oldSource,i===0?3:2).build(shape,options);
  assert.equal(responses[i].result.resolution,old.resolution);assert.equal(responses[i].result.scale,old.scale);
  assert.deepEqual(Buffer.from(pixels[i].data),Buffer.from(old.displacement.data));
 }
});
