// One compositor for image-wallpaper glass. DOM type, tints, vector rims and
// disclosure/navigation animations stay in their existing layers.
window.SuikeGlassScene=(function(){
  const selector='.next-card,.now-card,.agenda-card,.week-toolbar,.settings-card,.week-grid-wrap,.empty-state,.pending-course,.app-header,.section-heading,#statusLine,.day-btn,.week-course,.minute-arrangement';
  const status={active:false,backend:'legacy',frames:0,surfaces:0,lenses:0,backgroundBuilds:0,failures:0,drawCalls:0,pixelRatio:0,mediaKind:null,videoFrames:0,maxVideoUpdateMs:0,foregroundCopies:0,videoSourceWidth:0,videoSourceHeight:0};
  if(typeof performance==='undefined'||typeof requestAnimationFrame!=='function')return {register(){},unregister(){},refresh(){},setEnabled(){},status:status};
  const lenses=new Map(),textures=new Map(),tracked=new Map(),locations=new Map(),attributes=new Map();
  let canvas=null,gl=null,drawProgram=null,blurProgram=null,buffer=null,background=null,blurred=null,nested=null,scratch=null;
  let media=null,photo=null,targets=[],frame=0,epoch=0,viewportW=0,viewportH=0,pixelW=0,pixelH=0,motionUntil=0,blurTimer=null,forcedOff=false,dirty=true;
  const enabled=()=>!forcedOff&&document.documentElement.dataset.appearance==='custom'&&window.SuikeAppearance&&SuikeAppearance.isEnabled()&&!(window.matchMedia&&matchMedia('(prefers-reduced-transparency: reduce)').matches);
  const vertex='attribute vec2 a_point;uniform vec2 u_view;uniform vec4 u_rect;varying vec2 v_uv;varying vec2 v_screen;void main(){v_uv=a_point;v_screen=u_rect.xy+a_point*u_rect.zw;gl_Position=vec4(v_screen.x/u_view.x*2.0-1.0,1.0-v_screen.y/u_view.y*2.0,0.,1.);}';
  const precision='#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
  const fragment=precision+'varying vec2 v_uv;varying vec2 v_screen;uniform sampler2D u_photo;uniform sampler2D u_map;uniform vec2 u_view;uniform vec2 u_size;uniform vec4 u_radii;uniform float u_scale;uniform float u_lens;uniform float u_aa;uniform float u_opacity;void main(){vec2 p=v_uv*u_size;float r=p.y<u_size.y*.5?(p.x<u_size.x*.5?u_radii.x:u_radii.y):(p.x<u_size.x*.5?u_radii.w:u_radii.z);vec2 q=abs(p-u_size*.5)-(u_size*.5-r);float inside=r-length(max(q,vec2(0.)))-min(max(q.x,q.y),0.);float alpha=smoothstep(-u_aa,u_aa,inside)*u_opacity;if(alpha<=0.)discard;vec2 displacement=vec2(0.);if(u_lens>.5)displacement=(texture2D(u_map,vec2(v_uv.x,1.-v_uv.y)).rg-.5)*u_scale;vec2 uv=(v_screen+displacement)/u_view;vec4 color=texture2D(u_photo,vec2(uv.x,1.-uv.y));gl_FragColor=vec4(color.rgb*alpha,alpha);}';
  const blurFragment=precision+'varying vec2 v_uv;uniform sampler2D u_photo;uniform vec2 u_step;void main(){vec2 uv=vec2(v_uv.x,1.-v_uv.y);vec3 c=texture2D(u_photo,uv).rgb*.227027027;c+=(texture2D(u_photo,uv+u_step*1.3846153846).rgb+texture2D(u_photo,uv-u_step*1.3846153846).rgb)*.3162162162;c+=(texture2D(u_photo,uv+u_step*3.2307692308).rgb+texture2D(u_photo,uv-u_step*3.2307692308).rgb)*.0702702703;gl_FragColor=vec4(c,1.);}';
  // Video frames are scaled once, shared by all lenses, and never PNG-encoded.
  // Scrolling may render geometry at display cadence while the video cache is 24Hz.
  let isVideo=false,blurW=0,blurH=0,edgeBlur=null,videoRaster=null,videoContext=null,videoDirty=true;
  let videoCallback=0,videoTimer=0,videoOwner=null,videoEvents=[],lastVideoStamp=-Infinity,lastMediaTime=-1,navModel=null;
  let foreground=null,foregroundContext=null,foregroundStamp='',foregroundMap=null;
  const sourceWidth=()=>isVideo?photo.videoWidth:photo.naturalWidth,sourceHeight=()=>isVideo?photo.videoHeight:photo.naturalHeight;
  function stopVideoFrames(){
    if(videoCallback&&videoOwner&&videoOwner.cancelVideoFrameCallback)videoOwner.cancelVideoFrameCallback(videoCallback);
    videoCallback=0;if(videoTimer)clearTimeout(videoTimer);videoTimer=0;
  }
  function unwatchVideo(){stopVideoFrames();videoEvents.forEach(([name,fn])=>{if(videoOwner&&videoOwner.removeEventListener)videoOwner.removeEventListener(name,fn);});videoEvents=[];videoOwner=null;}
  function videoCanRun(){return isVideo&&photo&&enabled()&&!document.hidden&&!photo.paused&&!photo.ended&&photo.readyState>=2;}
  function queueVideoFrame(){
    if(!videoCanRun()||videoCallback||videoTimer)return;
    const owner=photo;
    function accept(now){
      if(owner!==photo||!videoCanRun())return;
      const interval=document.querySelector('dialog[open]')?1000/15:1000/24;
      if((!Number.isFinite(lastVideoStamp)||now-lastVideoStamp>=interval)&&photo.currentTime!==lastMediaTime){lastVideoStamp=Number.isFinite(lastVideoStamp)?now-((now-lastVideoStamp)%interval):now;lastMediaTime=photo.currentTime;videoDirty=true;request();}
      queueVideoFrame();
    }
    if(typeof owner.requestVideoFrameCallback==='function')videoCallback=owner.requestVideoFrameCallback(now=>{videoCallback=0;accept(now);});
    else videoTimer=setTimeout(()=>{videoTimer=0;accept(performance.now());},42);
  }
  function watchVideo(){
    videoOwner=photo;lastVideoStamp=-Infinity;lastMediaTime=-1;
    const play=()=>{videoDirty=true;request();queueVideoFrame();},pause=()=>{stopVideoFrames();videoDirty=true;request();};
    videoEvents=[['playing',play],['play',play],['seeked',play],['pause',pause],['ended',pause]];
    videoEvents.forEach(([name,fn])=>photo.addEventListener(name,fn));queueVideoFrame();
  }
  function removeForeground(){if(foreground)foreground.remove();foreground=null;foregroundContext=null;foregroundStamp='';foregroundMap=null;}
  function captureVideo(){
    if(!videoRaster||!videoContext||!photo||photo.readyState<2)return false;
    const iw=sourceWidth(),ih=sourceHeight();if(!iw||!ih)return false;
    const s=Math.max(pixelW/iw,pixelH/ih);videoContext.drawImage(photo,(pixelW-iw*s)/2,(pixelH-ih*s)/2,iw*s,ih*s);return true;
  }
  function updateVideo(){
    if(!isVideo||!videoDirty)return;
    const start=performance.now();if(!captureVideo())return;
    texture(0,background);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,videoRaster);
    const amount=SuikeAppearance.frostLevels().navBlur;makeBlur(background,blurred,amount);makeBlur(background,nested,amount*Math.sqrt(2));makeBlur(background,edgeBlur,Math.sqrt(144+amount*amount));
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);videoDirty=false;status.videoFrames++;status.maxVideoUpdateMs=Math.max(status.maxVideoUpdateMs,performance.now()-start);
  }
  function quad(rect,tex,model,radius){
    use(drawProgram,rect);texture(0,tex);gl.uniform1i(uniform(drawProgram,'u_photo'),0);gl.uniform1i(uniform(drawProgram,'u_map'),1);
    gl.uniform2f(uniform(drawProgram,'u_size'),rect.width,rect.height);gl.uniform4f(uniform(drawProgram,'u_radii'),radius,radius,radius,radius);
    gl.uniform1f(uniform(drawProgram,'u_aa'),.5/(pixelW/viewportW));gl.uniform1f(uniform(drawProgram,'u_opacity'),1);
    const ready=model&&model.map&&model.map.texture;texture(1,ready?model.map.texture:background);
    gl.uniform1f(uniform(drawProgram,'u_lens'),ready?1:0);gl.uniform1f(uniform(drawProgram,'u_scale'),ready?model.maps.scale:0);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }
  function paintVideoForeground(){
    const nav=document.querySelector('.bottom-nav'),edge=document.querySelector('.lg-scroll-edge');if(!nav||!edge)return;
    const n=nav.getBoundingClientRect(),e=edge.getBoundingClientRect();if(!n.width||!e.width||!e.height)return;
    if(navModel&&!navModel.map)navModel.map=acquireMap(navModel.url);
    const map=navModel&&navModel.map&&navModel.map.texture;
    const stamp=[status.videoFrames,pixelW,pixelH,n.left,n.top,n.width,n.height,e.top,e.height].join(':');
    if(foreground&&stamp===foregroundStamp&&foregroundMap===map)return;
    if(!foreground){foreground=document.createElement('canvas');foreground.className='lg-video-foreground';foreground.setAttribute('aria-hidden','true');foregroundContext=foreground.getContext('2d',{alpha:true});if(!foregroundContext)throw Error('Video foreground unavailable');(nav.parentElement||document.body).appendChild(foreground);}
    const ratio=pixelW/viewportW,w=Math.max(1,Math.round(viewportW*ratio)),h=Math.max(1,Math.round(e.height*ratio));
    if(foreground.width!==w||foreground.height!==h){foreground.width=w;foreground.height=h;}foreground.style.height=e.height+'px';
    quad(e,edgeBlur.texture,null,0);quad(n,edgeBlur.texture,navModel,n.height/2);
    const ctx=foregroundContext;ctx.globalCompositeOperation='source-over';ctx.clearRect(0,0,w,h);
    ctx.drawImage(canvas,0,e.top*ratio,pixelW,e.height*ratio,0,0,w,h);ctx.fillStyle='rgba(0,0,0,.24)';ctx.fillRect(0,0,w,h);
    const gradient=ctx.createLinearGradient(0,h,0,0);gradient.addColorStop(0,'rgba(0,0,0,1)');gradient.addColorStop(.3,'rgba(0,0,0,1)');gradient.addColorStop(1,'rgba(0,0,0,0)');
    ctx.globalCompositeOperation='destination-in';ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);ctx.globalCompositeOperation='source-over';
    const x=n.left*ratio,y=(n.top-e.top)*ratio,nw=n.width*ratio,nh=n.height*ratio,r=nh/2;
    ctx.save();ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+nw,y,x+nw,y+nh,r);ctx.arcTo(x+nw,y+nh,x,y+nh,r);ctx.arcTo(x,y+nh,x,y,r);ctx.arcTo(x,y,x+nw,y,r);ctx.closePath();ctx.clip();
    ctx.drawImage(canvas,n.left*ratio,n.top*ratio,n.width*ratio,n.height*ratio,x,y,nw,nh);ctx.fillStyle='rgba(0,0,0,.24)';ctx.fillRect(x,y,nw,nh);ctx.restore();
    foregroundStamp=stamp;foregroundMap=map;status.foregroundCopies++;
  }

  function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('Glass shader unavailable');return s;}
  function program(fragmentSource){const p=gl.createProgram(),v=shader(gl.VERTEX_SHADER,vertex),f=shader(gl.FRAGMENT_SHADER,fragmentSource);gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error('Glass program unavailable');return p;}
  function uniform(p,name){let cache=locations.get(p);if(!cache){cache=new Map();locations.set(p,cache);}if(!cache.has(name))cache.set(name,gl.getUniformLocation(p,name));return cache.get(name);}
  function bindProgram(p){gl.useProgram(p);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);if(!attributes.has(p))attributes.set(p,gl.getAttribLocation(p,'a_point'));const a=attributes.get(p);gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);gl.uniform2f(uniform(p,'u_view'),viewportW,viewportH);}
  function setRect(p,r){gl.uniform4f(uniform(p,'u_rect'),r.left,r.top,r.width,r.height);}
  function use(p,rect){bindProgram(p);setRect(p,rect);} 
  function texture(unit,handle){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,handle);}
  function newTexture(source){const t=gl.createTexture();texture(0,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);if(source)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);return t;}
  function target(){const tex=newTexture();gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,blurW,blurH,0,gl.RGBA,gl.UNSIGNED_BYTE,null);const fbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Glass target unavailable');return {texture:tex,fbo:fbo};}
  function releaseTarget(t){if(t&&gl){gl.deleteTexture(t.texture);gl.deleteFramebuffer(t.fbo);}}
  function deactivate(){stopVideoFrames();removeForeground();document.documentElement.removeAttribute('data-glass-video');status.active=false;status.backend='legacy';document.documentElement.removeAttribute('data-glass-scene');tracked.forEach((_,el)=>el.classList.remove('lg-scene-surface'));if(canvas)canvas.style.display='none';}
  function fail(error){status.failures++;status.lastFailure=String(error&&error.message||'context-lost');deactivate();}
  function init(){
    if(gl)return true;
    canvas=document.createElement('canvas');canvas.className='lg-glass-scene';canvas.setAttribute('aria-hidden','true');
    try{gl=canvas.getContext('webgl',{alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:true,preserveDrawingBuffer:false});}catch(_){gl=null;}
    if(!gl){canvas=null;return false;}
    try{
      drawProgram=program(fragment);blurProgram=program(blurFragment);buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,0,1,0,0,1,1,1]),gl.STATIC_DRAW);
      gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.clearColor(0,0,0,0);
      canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();epoch++;textures.forEach(t=>{t.image.onload=null;t.image.onerror=null;});textures.clear();locations.clear();attributes.clear();lenses.forEach(m=>m.map=null);if(navModel)navModel.map=null;photo=null;background=null;blurred=nested=scratch=edgeBlur=null;videoRaster=videoContext=null;gl=null;fail();});
      canvas.addEventListener('webglcontextrestored',()=>{if(canvas)canvas.remove();canvas=null;gl=null;dirty=true;reload();});
      return true;
    }catch(error){fail(error);gl=null;return false;}
  }
  function blurPass(input,output,x,y){gl.bindFramebuffer(gl.FRAMEBUFFER,output.fbo);gl.viewport(0,0,blurW,blurH);gl.disable(gl.BLEND);use(blurProgram,{left:0,top:0,width:viewportW,height:viewportH});texture(0,input);gl.uniform1i(uniform(blurProgram,'u_photo'),0);gl.uniform2f(uniform(blurProgram,'u_step'),x,y);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);}
  function makeBlur(input,output,amount){const stride=amount*(pixelW/viewportW)/1.75;blurPass(input,scratch,stride/pixelW,0);blurPass(scratch.texture,output,0,stride/pixelH);}
  function fixedLayers(){
    if(isVideo||!photo||!photo.src)return;
    const css=document.documentElement.style;if(css&&css.setProperty)css.setProperty('--lg-scene-photo','url('+JSON.stringify(photo.src)+')');
    const nav=document.querySelector('.bottom-nav');if(!nav)return;
    const r=nav.getBoundingClientRect(),scale=Math.max(viewportW/photo.naturalWidth,viewportH/photo.naturalHeight),width=photo.naturalWidth*scale,height=photo.naturalHeight*scale;
    nav.style.setProperty('--lg-scene-photo-size',width+'px '+height+'px');nav.style.setProperty('--lg-scene-photo-position',((viewportW-width)/2-r.left)+'px '+((viewportH-height)/2-r.top)+'px');
    const levels=SuikeAppearance.frostLevels(),original=nav.style.backdropFilter||nav.style.webkitBackdropFilter||'',url=original.match(/url\(.+\)/);
    nav.style.setProperty('--lg-scene-nav-filter','blur('+Math.sqrt(144+levels.navBlur*levels.navBlur).toFixed(2)+'px)'+(url?' '+url[0]:''));
  }
  function rebuild(){
    if(!photo||!enabled()||!init())return false;
    const layer=document.getElementById('suikeWallpaper');if(!layer)return false;
    const w=window.innerWidth,h=window.innerHeight,max=gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const ratio=isVideo?Math.min(window.devicePixelRatio||1,2,Math.sqrt(1200000/(w*h)),1600/Math.max(w,h),max/Math.max(w,h)):Math.min(window.devicePixelRatio||1,3,Math.sqrt(4000000/(w*h)),max/Math.max(w,h));
    viewportW=w;viewportH=h;pixelW=Math.max(1,Math.round(w*ratio));pixelH=Math.max(1,Math.round(h*ratio));
    blurW=isVideo?Math.max(1,Math.round(pixelW/2)):pixelW;blurH=isVideo?Math.max(1,Math.round(pixelH/2)):pixelH;canvas.width=pixelW;canvas.height=pixelH;canvas.style.display='block';if(canvas.parentElement!==layer)layer.appendChild(canvas);
    const raster=document.createElement('canvas');raster.width=pixelW;raster.height=pixelH;const ctx=raster.getContext('2d');if(!ctx)throw Error('Wallpaper raster unavailable');
    ctx.fillStyle='#151b23';ctx.fillRect(0,0,pixelW,pixelH);
    const iw=sourceWidth(),ih=sourceHeight(),s=Math.max(pixelW/iw,pixelH/ih);
    ctx.drawImage(photo,(pixelW-iw*s)/2,(pixelH-ih*s)/2,iw*s,ih*s);
    if(isVideo){videoRaster=raster;videoContext=ctx;status.videoSourceWidth=iw;status.videoSourceHeight=ih;}else{videoRaster=null;videoContext=null;}if(background)gl.deleteTexture(background);background=newTexture(raster);releaseTarget(blurred);releaseTarget(nested);releaseTarget(scratch);blurred=target();nested=target();scratch=target();releaseTarget(edgeBlur);edgeBlur=isVideo?target():null;
    const levels=SuikeAppearance.frostLevels(),amount=levels.navBlur;
    makeBlur(background,blurred,amount);makeBlur(background,nested,amount*Math.sqrt(2));if(isVideo){makeBlur(background,edgeBlur,Math.sqrt(144+amount*amount));videoDirty=false;status.videoFrames++;foregroundStamp="";}gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    dirty=false;fixedLayers();status.backgroundBuilds++;status.pixelRatio=ratio;return true;
  }
  function collect(){
    const next=Array.from(document.querySelectorAll(selector)).filter(el=>!el.closest('dialog'));
    const set=new Set(next);tracked.forEach((_,el)=>{if(!set.has(el)){el.classList.remove('lg-scene-surface');tracked.delete(el);if(resizeObserver)resizeObserver.unobserve(el);}});
    next.forEach(el=>{if(!tracked.has(el)){const cs=getComputedStyle(el);tracked.set(el,{radii:[cs.borderTopLeftRadius,cs.borderTopRightRadius,cs.borderBottomRightRadius,cs.borderBottomLeftRadius].map(v=>parseFloat(v)||0),view:el.closest('#todayView,#weekView,#settingsView'),nested:!!(el.parentElement&&el.parentElement.closest('.week-grid-wrap,.settings-card,.agenda-card,.now-card,.next-card'))});if(resizeObserver)resizeObserver.observe(el);}});
    targets=next;
  }
  function acquireMap(url){
    let entry=textures.get(url);if(entry){entry.refs++;return entry;}
    entry={refs:1,texture:null};textures.set(url,entry);const image=new Image();entry.image=image;
    image.onload=()=>{if(!gl||textures.get(url)!==entry)return;try{entry.texture=newTexture(image);request();}catch(error){fail(error);}};
    image.onerror=()=>{entry.failed=true;request();};image.src=url;return entry;
  }
  function releaseMap(entry){if(!entry)return;if(--entry.refs>0)return;if(entry.texture&&gl)gl.deleteTexture(entry.texture);textures.forEach((v,k)=>{if(v===entry)textures.delete(k);});entry.image.onload=null;entry.image.onerror=null;}
  function register(el,maps,shape){
    if(el.tagName==='DIALOG')return;if(el.matches('.bottom-nav')){if(navModel&&navModel.url!==maps.displacement)releaseMap(navModel.map);if(!navModel||navModel.url!==maps.displacement)navModel={url:maps.displacement,maps:maps,shape:shape,map:null};if(status.active){fixedLayers();request();}return;}if(!el.matches(selector))return;
    const old=lenses.get(el);if(old&&old.url===maps.displacement){old.shape=shape;request();return;}
    if(old)releaseMap(old.map);
    lenses.set(el,{url:maps.displacement,maps:maps,shape:shape,map:gl?acquireMap(maps.displacement):null});request();
  }
  function unregister(el){if(el.matches('.bottom-nav')&&navModel){releaseMap(navModel.map);navModel=null;}const old=lenses.get(el);if(old){releaseMap(old.map);lenses.delete(el);}request();}
  function paint(){
    frame=0;
    if(!enabled()||!photo){deactivate();return;}
    try{
      if(dirty&&!rebuild())return;
      updateVideo();gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,pixelW,pixelH);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);if(isVideo)quad({left:0,top:0,width:viewportW,height:viewportH},background,null,0);
      const opacityCache=new Map();
      const measured=targets.map(el=>{const view=tracked.get(el).view;let opacity=1;if(view){if(!opacityCache.has(view))opacityCache.set(view,Number(getComputedStyle(view).opacity));opacity=opacityCache.get(view);}return {el:el,rect:el.getBoundingClientRect(),style:tracked.get(el),opacity:Number.isFinite(opacity)?opacity:1};});let visible=0,draws=0;
      bindProgram(drawProgram);gl.uniform1i(uniform(drawProgram,'u_photo'),0);gl.uniform1i(uniform(drawProgram,'u_map'),1);gl.uniform1f(uniform(drawProgram,'u_aa'),.5/(pixelW/viewportW));
      let previousPhoto=null,previousMap=null,previousOpacity=-1;
      measured.forEach(item=>{
        const r=item.rect,el=item.el;if(!el.isConnected||!r.width||!r.height||r.bottom<=0||r.top>=viewportH||r.right<=0||r.left>=viewportW)return;
        const model=lenses.get(el);if(model&&!model.map)model.map=acquireMap(model.url);
        // Keep the shared flat glass while a new lens decodes; never fall back
        // to a live backdrop capture in the middle of a scroll.
        const ready=model&&model.map&&model.map.texture?model:null;
        setRect(drawProgram,r);const photoTexture=item.style.nested?nested.texture:blurred.texture;if(previousPhoto!==photoTexture){texture(0,photoTexture);previousPhoto=photoTexture;}
        gl.uniform2f(uniform(drawProgram,'u_size'),r.width,r.height);const radii=item.style.radii.map(v=>Math.min(v,r.width/2,r.height/2));gl.uniform4f(uniform(drawProgram,'u_radii'),radii[0],radii[1],radii[2],radii[3]);
        if(previousOpacity!==item.opacity){gl.uniform1f(uniform(drawProgram,'u_opacity'),item.opacity);previousOpacity=item.opacity;}gl.uniform1f(uniform(drawProgram,'u_scale'),ready?ready.maps.scale:0);gl.uniform1f(uniform(drawProgram,'u_lens'),ready?1:0);
        const mapTexture=ready?ready.map.texture:background;if(previousMap!==mapTexture){texture(1,mapTexture);previousMap=mapTexture;}gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
        if(!el.classList.contains('lg-scene-surface'))el.classList.add('lg-scene-surface');visible++;draws++;
      });
      if(isVideo){paintVideoForeground();document.documentElement.dataset.glassVideo='on';}else document.documentElement.removeAttribute('data-glass-video');document.documentElement.dataset.glassScene='on';status.mediaKind=isVideo?'video':'image';status.active=true;status.backend='shared-webgl';status.surfaces=visible;status.lenses=lenses.size;status.frames++;status.drawCalls=draws;
      if(performance.now()<motionUntil)request();
    }catch(error){fail(error);}
  }
  function request(motion){if(motion)motionUntil=Math.max(motionUntil,performance.now()+motion);if(!frame&&!document.hidden)frame=requestAnimationFrame(paint);}
  function reload(){
    unwatchVideo();removeForeground();epoch++;const current=window.SuikeWallpaper&&SuikeWallpaper.mediaForGlass?SuikeWallpaper.mediaForGlass():null;media=current;photo=null;
    isVideo=!!(current&&current.kind==='video');
    if(!enabled()||!current||!current.element||(isVideo?current.element.readyState<2||!current.element.videoWidth:!current.element.naturalWidth)){deactivate();return;}
    photo=current.element;videoDirty=true;dirty=true;collect();if(isVideo)watchVideo();request(520);
  }
  const resizeObserver=window.ResizeObserver?new ResizeObserver(()=>request(180)):null;
  const observer=new MutationObserver(records=>{if(records.some(r=>r.attributeName==='hidden'||r.attributeName==='open'||r.type==='childList'&&Array.from(r.addedNodes||[]).concat(Array.from(r.removedNodes||[])).some(n=>n.nodeType===1&&!(n.classList&&n.classList.contains('lg-optical-sheen'))))){collect();request(document.querySelector('dialog[open]')?0:520);}});
  const shell=document.querySelector('.app-shell');if(shell)observer.observe(shell,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','open']});
  document.addEventListener('scroll',()=>request(),{passive:true,capture:true});
  document.addEventListener('click',()=>request(document.querySelector('dialog[open]')?0:520),{passive:true});
  document.addEventListener('suike-wallpaper-media',reload);document.addEventListener('suike-appearance-change',reload);document.addEventListener('suike-glass-change',reload);
  document.addEventListener('suike-glass-frost',()=>{clearTimeout(blurTimer);blurTimer=setTimeout(()=>{dirty=true;request(180);},120);});
  window.addEventListener('resize',()=>{dirty=true;request(250);},{passive:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopVideoFrames();else{request(180);queueVideoFrame();}});window.addEventListener('pagehide',stopVideoFrames);
  reload();
  return {register:register,unregister:unregister,status:status,setEnabled(value){forcedOff=value===false;if(forcedOff)deactivate();else reload();},refresh:()=>{collect();request(520);}};
})();
