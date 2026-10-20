const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../shared-glass-scene.js'),'utf8');
function fixture(unavailable=false){
 let time=0,textureCount=0,draws=0,uploads=0,decodes=0,uniformQueries=0,attributeQueries=0,classWrites=0;const frames=[],listeners={},resizers=[],readouts=[];let media,dialogOpen=false,nav=null,edge=null;const videoFrames=new Map();let videoId=0;
 class El{
  constructor(tag='section'){this.tagName=tag.toUpperCase();this.children=[];this.classes=new Set();this.style={};this.attrs={};this.isConnected=true;this.nodeType=1;this.rect={left:12,top:60,width:330,height:220,right:342,bottom:280};this.classList={add:n=>{classWrites++;this.classes.add(n);},remove:n=>this.classes.delete(n),contains:n=>this.classes.has(n)};this.listeners={};}
  set className(v){this.classes=new Set(v.split(/\s+/));}get className(){return [...this.classes].join(' ');}
  appendChild(n){n.parentElement=this;this.children.push(n);return n;}remove(){this.isConnected=false;if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);}
  setAttribute(k,v){this.attrs[k]=v;}addEventListener(t,fn){this.listeners[t]=fn;}removeEventListener(t,fn){if(this.listeners[t]===fn)delete this.listeners[t];}matches(s){return s==='.bottom-nav'?false:this.main===true;}
  closest(s){for(let p=this;p;p=p.parentElement){if(s==='dialog'&&p.tagName==='DIALOG')return p;if(s.includes('.week-grid-wrap')&&p.container)return p;}return null;}
  getBoundingClientRect(){return this.rect;}
 }
 const gl={MAX_TEXTURE_SIZE:1,FRAMEBUFFER_COMPLETE:2,NO_ERROR:0,TEXTURE0:100,
  getParameter:()=>4096,getShaderParameter:()=>true,getProgramParameter:()=>true,checkFramebufferStatus:()=>2,getAttribLocation:()=>{attributeQueries++;return 0;},getUniformLocation:(p,n)=>{uniformQueries++;return n;},
  createTexture(){textureCount++;return {id:textureCount};},texSubImage2D(){uploads++;},texImage2D(){uploads++;},drawArrays(){draws++;},uniform4f(...a){readouts.push(a);}};
 for(const n of ['createShader','createProgram','createBuffer','createFramebuffer'])gl[n]=()=>({});
 for(const n of ['shaderSource','compileShader','attachShader','linkProgram','deleteShader','bindBuffer','bufferData','disable','clearColor','deleteTexture','deleteFramebuffer','enableVertexAttribArray','vertexAttribPointer','useProgram','activeTexture','bindTexture','texParameteri','pixelStorei','framebufferTexture2D','bindFramebuffer','viewport','uniform1i','uniform1f','uniform2f','clear','enable','blendFunc'])gl[n]=()=>{};
 const root={dataset:{appearance:'custom'},removeAttribute(k){if(k==='data-glass-scene')delete this.dataset.glassScene;if(k==='data-glass-video')delete this.dataset.glassVideo;}},layer=new El('div'),shell=new El('main');
 const a=new El(),b=new El(),tile=new El();a.main=b.main=tile.main=true;b.container=true;b.rect={left:12,top:300,width:330,height:350,right:342,bottom:650};tile.rect={left:60,top:330,width:75,height:90,right:135,bottom:420};shell.appendChild(a);shell.appendChild(b);b.appendChild(tile);
 const modal=new El('dialog'),ignored=new El();ignored.main=true;modal.appendChild(ignored);
 const photo={naturalWidth:900,naturalHeight:1600};media={kind:'image',element:photo};
 const body=new El('body');const document={body,documentElement:root,hidden:false,querySelector:s=>s==='.app-shell'?shell:s==='dialog[open]'&&dialogOpen?modal:s==='.bottom-nav'?nav:s==='.lg-scroll-edge'?edge:null,querySelectorAll:()=>[a,b,tile,ignored],getElementById:id=>id==='suikeWallpaper'?layer:null,addEventListener:(t,fn)=>(listeners[t]||=[]).push(fn),createElement:tag=>{const n=new El(tag);if(tag==='canvas')n.getContext=type=>type==='webgl'?(unavailable?null:gl):{fillRect(){},clearRect(){},save(){},restore(){},beginPath(){},moveTo(){},arcTo(){},closePath(){},clip(){},createLinearGradient(){return {addColorStop(){}};},drawImage(...args){readouts.push(args);}};return n;}};
 const ctx=vm.createContext({document,performance:{now:()=>time},innerWidth:360,innerHeight:780,devicePixelRatio:3,
  Image:class{set src(url){decodes++;queueMicrotask(()=>{if(this.onload)this.onload();});}},
  requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},setTimeout:fn=>{frames.push(fn);return frames.length;},clearTimeout(){},
  addEventListener:(t,fn)=>(listeners[t]||=[]).push(fn),matchMedia:()=>({matches:false}),getComputedStyle:()=>({borderTopLeftRadius:'22px',borderTopRightRadius:'22px',borderBottomRightRadius:'22px',borderBottomLeftRadius:'22px'}),
  MutationObserver:class{observe(){}},ResizeObserver:class{constructor(fn){resizers.push(fn);}observe(){}unobserve(){}},
  SuikeAppearance:{isEnabled:()=>true,frostLevels:()=>({navBlur:.65})},SuikeWallpaper:{mediaForGlass:()=>media}});
 ctx.window=ctx;vm.runInContext(source,ctx);
 async function drain(){let steps=0;while(frames.length){if(++steps>200)throw Error('Unbounded idle render loop');time+=16;frames.shift()(time);await Promise.resolve();}}
 function emit(t){for(const f of listeners[t]||[])f();}
 function video(fallback=false){
  nav=new El('nav');shell.appendChild(nav);nav.rect={left:12,top:688,width:336,height:72,right:348,bottom:760};edge=new El('div');edge.rect={left:0,top:680,width:360,height:100,right:360,bottom:780};
  const el=new El('video');Object.assign(el,{videoWidth:3840,videoHeight:2160,readyState:2,paused:false,ended:false,currentTime:0});
  if(!fallback){el.requestVideoFrameCallback=fn=>{videoFrames.set(++videoId,fn);return videoId;};el.cancelVideoFrameCallback=id=>videoFrames.delete(id);}
  media={kind:'video',element:el};emit('suike-wallpaper-media');return {el,pending:()=>videoFrames.size,frame(ms=16.667){time+=ms;el.currentTime+=ms/1000;const next=videoFrames.entries().next().value;if(next){videoFrames.delete(next[0]);next[1](time,{mediaTime:el.currentTime});}},pause(){el.paused=true;if(el.listeners.pause)el.listeners.pause();}};
 }
 return {foregrounds:()=>shell.children.filter(n=>n.classList.contains("lg-video-foreground")),nav:()=>nav,now:()=>time,ctx,a,b,tile,ignored,layer,root,body,video,drain,emit,resizers,stats:()=>({textureCount,draws,uploads,decodes,uniformQueries,attributeQueries,classWrites}),setMedia:m=>media=m,setDialogOpen:v=>dialogOpen=v};
}

module.exports={fixture};
