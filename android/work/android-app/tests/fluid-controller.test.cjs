// Runs the shipped optics controller. It does not emulate GPU compositing.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../liquid-refraction.js'),'utf8');
function fixture(){
 const frames=[],timers=new Map(),listeners={},mutations=[],resizes=[];let frameCount=0,workerCalls=0,animations=0,layoutReads=0,failNext=false;
 class El{
  constructor(tag='div',height=64){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes={};this.isConnected=true;this.w=360;this.h=height;this.top=0;this.nodeType=1;this.style={removeProperty(k){delete this[k];if(k==='backdrop-filter')delete this.backdropFilter;if(k==='-webkit-backdrop-filter')delete this.webkitBackdropFilter;}};this.classes=new Set();this.classList={contains:k=>this.classes.has(k),add:k=>this.classes.add(k),remove:k=>this.classes.delete(k)};}
  get offsetWidth(){layoutReads++;return this.w;}get offsetHeight(){layoutReads++;return this.h;}
  set className(v){this.classes=new Set(v.split(/\s+/));}get className(){return [...this.classes].join(' ');}
  setAttribute(k,v){this.attributes[k]=v;if(k==='id')this.id=v;}setAttributeNS(ns,k,v){this.setAttribute(k,v);}
  appendChild(el){this.children.push(el);el.parentElement=this;return el;}insertBefore(el){this.children.unshift(el);el.parentElement=this;}
  remove(){this.isConnected=false;if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(e=>e!==this);}
  contains(el){return el===this||this.children.some(c=>c.contains(el));}closest(){return null;}
  querySelector(){return null;}matches(s){return this.card&&s.includes('.settings-card');}getAnimations(){return [];}
  getBoundingClientRect(){return {top:this.top,bottom:this.top+this.h,width:this.w,height:this.h};}
  animate(){animations++;return {};}
 }
 const root=new El('html');root.dataset.appearance='custom';const body=new El('body'),nav=new El('nav');body.appendChild(nav);
 const a=new El('section',500),b=new El('section',300);a.card=b.card=true;b.top=1000;body.appendChild(a);body.appendChild(b);
 const document={documentElement:root,body,querySelector:s=>s==='.bottom-nav'?nav:null,querySelectorAll:s=>s.includes('.next-card')?[a,b]:[],
  createElementNS:(ns,t)=>new El(t),createElement:t=>{const e=new El(t);if(t==='canvas'){e.getContext=()=>({putImageData(){}});e.toDataURL=()=> 'data:image/png;base64,legacy';}return e;},addEventListener:(t,fn)=>(listeners[t]||=[]).push(fn)};
 const ctx=vm.createContext({document,navigator:{userAgent:'Chrome/132'},CSS:{supports:()=>true},performance:{now:()=>0},getComputedStyle:()=>({borderTopLeftRadius:'24',opacity:'1'}),
  ImageData:class{constructor(data,w,h){this.data=typeof data==='number'?new Uint8ClampedArray(4):data;this.width=typeof data==='number'?data:w;this.height=typeof data==='number'?w:h;}},
  requestAnimationFrame(fn){frameCount++;frames.push(fn);return frameCount;},requestIdleCallback:fn=>frames.push(fn),
  setTimeout(fn){const id=timers.size+1;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
  MutationObserver:class{constructor(fn){mutations.push(fn);}observe(){}},ResizeObserver:class{constructor(fn){resizes.push(fn);}observe(){}unobserve(){}},
  matchMedia:()=>({matches:false}),addEventListener:(t,fn)=>(listeners[t]||=[]).push(fn),innerHeight:800,
  SuikeLiquidUI:{ready:true,isEnabled:()=>true},SuikeGlassOptics:{},
  SuikeOpticsWorker:{async build(){workerCalls++;if(failNext){failNext=false;throw Error('Synthetic worker failure');}return {displacement:'data:image/png;base64,cached-'+workerCalls,scale:6,resolution:3,visitedPixels:100,totalPixels:1000,encodingMs:1};}},
  SuikeScheduledOptics:{buildRaw(){throw Error('Unexpected UI-thread map work');},pause:()=>Promise.resolve()}});
 ctx.window=ctx;vm.runInContext(source,ctx);
 function emit(t){for(const fn of listeners[t]||[])fn();}
 async function drain(){for(let i=0;i<50;i++){for(const [id,fn] of [...timers]){timers.delete(id);fn();}while(frames.length)frames.shift()();await Promise.resolve();}}
 function mutation(target,nodes){mutations.forEach(fn=>fn([{type:'childList',target,addedNodes:nodes,removedNodes:[]} ]));}
 return {ctx,nav,a,b,root,body,emit,drain,mutation,resize(el){resizes.forEach(fn=>fn([{target:el,borderBoxSize:[{inlineSize:el.w,blockSize:el.h}]}]));},
  stats:()=>({workerCalls,animations,layoutReads,frameCount}),failNext(){failNext=true;}};
}
test('wallpaper still installs real displacement and the original vector rim through background jobs',async()=>{
 const h=fixture();await h.drain();assert.equal(h.stats().workerCalls,2);assert.match(h.a.style.backdropFilter,/blur\(.+url\(#/);
 assert.equal(h.a.children[0].dataset.vectorRim,'true');assert.equal(h.a.children[0].dataset.lensResolution,'3');assert.equal(h.ctx.SuikeLiquidUI.optics.workerBuilds,2);assert.equal(h.ctx.SuikeLiquidUI.optics.failures,0);
});
test('scrolling away and back retains connected lenses, avoiding rebuild, filter replacement and sheen restart',async()=>{
 const h=fixture();await h.drain();const oldFilter=h.a.style.backdropFilter,oldRim=h.a.children[0];
 h.a.top=-700;h.b.top=50;h.emit('scroll');await h.drain();const calls=h.stats().workerCalls,animations=h.stats().animations;
 h.a.top=0;h.b.top=1000;h.emit('scroll');await h.drain();
 assert.equal(h.a.style.backdropFilter,oldFilter);assert.equal(h.a.children[0],oldRim);assert.equal(h.stats().workerCalls,calls);assert.equal(h.stats().animations,animations);assert.equal(h.ctx.SuikeLiquidUI.optics.failures,0);
});
test('resizing still stretches both optical maps; settled reopening reuses the exact-sized cache',async()=>{
 const h=fixture();await h.drain();const oldRim=h.a.children[0],animations=h.stats().animations;
 h.a.h=180;const reads=h.stats().layoutReads;h.resize(h.a);
 assert.equal(h.stats().layoutReads,reads,'ResizeObserver supplies dimensions without another layout read');
 const host=h.body.children.find(n=>n.attributes.class==='lg-filter-definitions'),defs=host.children[0];
 const id=h.a.style.backdropFilter.match(/url\(#(.+)\)/)[1],filter=defs.children.find(f=>f.id===id);
 assert.equal(filter.attributes.height,180);assert.equal(filter.children[0].attributes.height,180);
 await h.drain();const jobs=h.stats().workerCalls;h.a.h=500;h.resize(h.a);await h.drain();
 assert.equal(h.stats().workerCalls,jobs);assert.equal(h.a.children[0],oldRim);assert.equal(h.stats().animations,animations);assert.ok(h.ctx.SuikeLiquidUI.optics.cacheHits>0);
});
test('internal filter inserts and text ticks no longer schedule extra geometry scans',async()=>{
 const h=fixture();await h.drain();const frames=h.stats().frameCount,host=h.body.children.find(n=>n.attributes.class==='lg-filter-definitions');
 h.mutation(host.children[0],[host]);h.mutation(h.a,[h.a.children[0]]);h.mutation(h.a,[{nodeType:3}]);await h.drain();
 assert.equal(h.stats().frameCount,frames);
 h.mutation(h.body,[h.b]);await h.drain();assert.ok(h.stats().frameCount>frames);
});
test('failed cached work is evicted so a later interaction can retry successfully',async()=>{
 const h=fixture();await h.drain();h.a.h=420;h.failNext();h.ctx.SuikeLiquidUI.refreshOptics();await h.drain();assert.equal(h.ctx.SuikeLiquidUI.optics.failures,1);
 const before=h.stats().workerCalls;h.ctx.SuikeLiquidUI.refreshOptics();await h.drain();assert.equal(h.stats().workerCalls,before+1);assert.match(h.a.style.backdropFilter,/url\(#/);
});
