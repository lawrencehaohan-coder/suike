  // Single-pass, shape-matched refraction on the real backdrop. Optional UI only.
  (function installClearRefraction(){
    if(!window.SuikeLiquidUI || !SuikeLiquidUI.ready || !window.SuikeGlassOptics) return;
    const O=window.SuikeGlassOptics, namespace='http://www.w3.org/2000/svg';
    const supported=/Chrome\/\d+/.test(navigator.userAgent) && typeof ImageData==='function' &&
      window.CSS && CSS.supports('backdrop-filter','blur(1px) url(#suike-clear-test)');
    const status={source:'https://github.com/LeonardSEO/liquid-glass-react',
      commit:'b857e5cd1ce3daf5599fc9a838364e591aa0c0e5',supported:!!supported,
      surfaces:0,mapBuilds:0,maxMapBuildMs:0,maxMapSliceMs:0,maxEncodingMs:0,yields:0,dispersion:0,passes:1,failures:0,workerBuilds:0,fallbackBuilds:0,cacheHits:0,cacheEvictions:0,visitedPixels:0,totalPixels:0,maxWorkerEncodingMs:0};
    SuikeLiquidUI.optics=status;
    if(!supported) return;
    const host=document.createElementNS(namespace,'svg');
    host.setAttribute('class','lg-filter-definitions');host.setAttribute('aria-hidden','true');host.setAttribute('focusable','false');
    const definitions=document.createElementNS(namespace,'defs');host.appendChild(definitions);document.body.appendChild(host);
    const cache=new Map(), installed=new WeakMap();let pending=new WeakMap();
    let sequence=0, queued=false, resizeTimer=null, generation=0;
    const surfaces=new Set();
    const standardDisplayGlass=false;
    const opticalIndex=()=>document.documentElement.dataset.appearance==='custom'?1.33:1.5;
    const displaySelector='.next-card,.now-card,.agenda-card,.week-toolbar,.settings-card,.week-grid-wrap,.empty-state,.pending-course';
    let refreshing=false,refreshAgain=false,resized=null;
    // "Reduce Transparency" asks for opaque material; the CSS fallback covers it without optics.
    const lowTransparency=()=>!!(window.matchMedia&&matchMedia('(prefers-reduced-transparency: reduce)').matches);
    const enabled=()=>SuikeLiquidUI.isEnabled()&&!lowTransparency();
    // Blur radii come from the user's frost curve (appearance.js); the tab bar centre stays
    // clear through the lower half of the slider, sheets always keep enough blur to read.
    function backdropFor(el,id){
      const levels=window.SuikeAppearance&&SuikeAppearance.frostLevels?SuikeAppearance.frostLevels():{navBlur:.65,sheetBlur:28};
      const blur=el.tagName==='DIALOG'?levels.sheetBlur:levels.navBlur;
      return 'blur('+(+blur.toFixed(2))+'px) url(#'+id+')';
    }
    function svgElement(tag,attributes){
      const el=document.createElementNS(namespace,tag);
      Object.keys(attributes).forEach(key=>el.setAttribute(key,String(attributes[key])));
      return el;
    }
    function encodeImage(image){
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      // CPU-backed canvas avoids a GPU readback stall during PNG encoding.
      const context=canvas.getContext('2d',{willReadFrequently:true});
      if(!context)throw new Error('Optional glass canvas unavailable');
      const pixels=image instanceof ImageData?image:new ImageData(image.data,image.width,image.height);
      context.putImageData(pixels,0,0);return canvas.toDataURL('image/png');
    }
    function encodeImageAsync(image){
      if(typeof FileReader!=='function')return Promise.resolve(encodeImage(image));
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      if(typeof canvas.toBlob!=='function')return Promise.resolve(encodeImage(image));
      const context=canvas.getContext('2d',{willReadFrequently:true});
      if(!context)return Promise.reject(new Error('Optional glass canvas unavailable'));
      context.putImageData(image instanceof ImageData?image:new ImageData(image.data,image.width,image.height),0,0);
      return new Promise((resolve,reject)=>canvas.toBlob(blob=>{
        if(!blob){reject(new Error('Optional glass encoding unavailable'));return;}
        const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Optional glass encoding failed'));reader.readAsDataURL(blob);
      },'image/png'));
    }
    function vectorSheen(width,height,radius){
      // A scalable rim keeps subpixel corners smooth even when the cached lens stretches.
      // The SVG itself stretches with the card, including its corner radii. No fixed frame.
      const r=Math.max(0,radius-.5),w=width-1,h=height-1;
      const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'" preserveAspectRatio="none">'+
        '<defs><linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop stop-color="white" stop-opacity=".92"/><stop offset=".3" stop-color="white" stop-opacity=".48"/><stop offset=".55" stop-color="white" stop-opacity=".14"/><stop offset="1" stop-color="white" stop-opacity=".62"/></linearGradient>'+
        '<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.1"/></filter></defs>'+
        '<rect vector-effect="non-scaling-stroke" x="1.5" y="1.5" width="'+(width-3)+'" height="'+(height-3)+'" rx="'+Math.max(0,r-1)+'" fill="none" stroke="url(#rim)" stroke-width="2" opacity=".28" filter="url(#soft)"/>'+
        '<rect vector-effect="non-scaling-stroke" x=".5" y=".5" width="'+w+'" height="'+h+'" rx="'+r+'" fill="none" stroke="url(#rim)" stroke-width=".85"/></svg>';
      return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
    }
    async function buildMaps(width,height,radius,ior){
      const start=performance.now(),shape={width:width,height:height,radius:radius};
      const bezel=Math.max(6,Math.min(Math.min(width,height)*.2,12,radius));
      const options={bezel:bezel,thickness:bezel*1.5,ior:ior,profile:'squircle',clear:ior===1.33};
      const offthread=options.clear&&window.SuikeOpticsWorker?await SuikeOpticsWorker.build(shape,options):null;
      let displacement,specular,scale,resolution;
      if(offthread){
        displacement=offthread.displacement;specular=vectorSheen(width,height,radius);scale=offthread.scale;resolution=offthread.resolution;
        status.workerBuilds++;status.maxWorkerEncodingMs=Math.max(status.maxWorkerEncodingMs,offthread.encodingMs);
        status.visitedPixels+=offthread.visitedPixels;status.totalPixels+=offthread.totalPixels;
      }else{
        const raw=await window.SuikeScheduledOptics.buildRaw(shape,options);
        await window.SuikeScheduledOptics.pause();
        let encoding=performance.now();displacement=await encodeImageAsync(raw.displacement);
        status.maxEncodingMs=Math.max(status.maxEncodingMs,performance.now()-encoding);
        await window.SuikeScheduledOptics.pause();
        encoding=performance.now();specular=options.clear?vectorSheen(width,height,radius):await encodeImageAsync(raw.specular);
        status.maxEncodingMs=Math.max(status.maxEncodingMs,performance.now()-encoding);
        status.maxMapSliceMs=Math.max(status.maxMapSliceMs,raw.maxSliceMs);status.yields+=raw.yields;
        status.fallbackBuilds++;status.visitedPixels+=raw.visitedPixels;status.totalPixels+=raw.totalPixels;
        scale=raw.scale;resolution=raw.resolution;
      }
      status.mapBuilds++;status.maxMapBuildMs=Math.max(status.maxMapBuildMs,performance.now()-start);
      return {displacement:displacement,specular:specular,width:width,height:height,scale:scale,resolution:resolution};
    }
    function mapsFor(width,height,radius){
      const ior=opticalIndex(),key=width+'|'+height+'|'+radius+'|'+ior;
      if(cache.has(key)){const existing=cache.get(key);cache.delete(key);cache.set(key,existing);status.cacheHits++;return existing;}
      const result=buildMaps(width,height,radius,ior).catch(error=>{if(cache.get(key)===result)cache.delete(key);throw error;});
      cache.set(key,result);if(cache.size>16){cache.delete(cache.keys().next().value);status.cacheEvictions++;}
      return result;
    }
    async function attach(el,measurement){
      if(!enabled() || !el)return;
      const epoch=generation;
      observeSurface(el);
      const width=measurement?measurement.width:el.offsetWidth,height=measurement?measurement.height:el.offsetHeight;
      if(width<2 || height<2 || width*height>640000 || el.classList.contains('closing'))return;
      if(el.classList.contains('lg-glass-motion'))return;
      const radius=measurement?measurement.radius:Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius)||24,width/2,height/2);
      const key=width+'|'+height+'|'+radius+'|'+opticalIndex(),previous=installed.get(el);
      if(previous && previous.key===key || pending.get(el)===key)return;
      // Keep stretching the optical rim while a disclosure is moving; rebuild only after settling.
      if(shapeMoving(el))return;
      pending.set(el,key);
      let maps;
      try{maps=await mapsFor(width,height,radius);}catch(error){if(epoch===generation)pending.delete(el);throw error;}
      if(!enabled() || epoch!==generation || pending.get(el)!==key)return;
      if(shapeMoving(el)){pending.delete(el);return;}
      pending.delete(el);
      if(!el.isConnected || el.offsetWidth!==width || el.offsetHeight!==height || el.tagName==='DIALOG'&&!el.open){schedule();return;}
      const id='suike-clear-'+(++sequence);
      const filter=svgElement('filter',{id:id,x:0,y:0,width:width,height:height,
        filterUnits:'userSpaceOnUse',primitiveUnits:'userSpaceOnUse','color-interpolation-filters':'sRGB'});
      const image=svgElement('feImage',{href:maps.displacement,x:0,y:0,width:width,height:height,preserveAspectRatio:'none',result:'map'});
      image.setAttributeNS('http://www.w3.org/1999/xlink','xlink:href',maps.displacement);
      filter.appendChild(image);filter.appendChild(svgElement('feDisplacementMap',{
        in:'SourceGraphic',in2:'map',scale:maps.scale,xChannelSelector:'R',yChannelSelector:'G'}));
      definitions.appendChild(filter);
      // Sheets are thick frosted glass with a refracting rim; the tab bar is clear unless frosted.
      const backdrop=backdropFor(el,id);
      el.style.backdropFilter=backdrop;el.style.webkitBackdropFilter=backdrop;
      if(previous)previous.filter.remove();else status.surfaces++;
      let sheen=previous&&previous.sheen;
      // Dialog content scrolls; its border reflections stay in CSS at the frame.
      if(el.tagName!=='DIALOG'){
        if(!sheen){sheen=document.createElement('span');sheen.className='lg-optical-sheen';sheen.setAttribute('aria-hidden','true');el.insertBefore(sheen,el.firstChild);}
        sheen.style.backgroundImage='url("'+maps.specular+'")';
        sheen.dataset.vectorRim=String(opticalIndex()===1.33);sheen.dataset.lensResolution=String(maps.resolution);
      }
      installed.set(el,{key:key,filter:filter,image:image,sheen:sheen,visualWidth:width,visualHeight:height});surfaces.add(el);
      if(window.SuikeGlassScene)SuikeGlassScene.register(el,maps,{width:width,height:height,radius:radius});
      if(el.matches(displaySelector))el.classList.add('lg-refracted-card');
      if(sheen&&!previous&&sheen.animate&&!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)){
        sheen.animate([{opacity:0},{opacity:getComputedStyle(sheen).opacity}],{duration:160,easing:'ease-out'});
      }
      document.documentElement.classList.add('lg-optics-ready');
    }
    function shapeMoving(el){
      return !!el.querySelector('details.lg-folding') || !!(el.getAnimations&&el.getAnimations().some(a=>a.effect&&a.effect.getKeyframes().some(f=>f.height)));
    }
    function observeSurface(el){
      if(!resized||!el)return;
      try{resized.observe(el,{box:'border-box'});}catch(_){resized.observe(el);}
    }
    function stretchFrame(el,width,height){
      if(!el.isConnected||width<2||height<2){detach(el);return;}
      const entry=installed.get(el);
      if(!entry||entry.visualWidth===width&&entry.visualHeight===height)return;
      // Both optical maps follow the changing box; no second stationary outline.
      entry.filter.setAttribute('width',width);entry.filter.setAttribute('height',height);
      entry.image.setAttribute('width',width);entry.image.setAttribute('height',height);
      entry.visualWidth=width;entry.visualHeight=height;pending.delete(el);
    }
    function detach(el){
      if(window.SuikeGlassScene)SuikeGlassScene.unregister(el);
      const entry=installed.get(el);if(entry){entry.filter.remove();if(entry.sheen)entry.sheen.remove();}
      el.style.removeProperty('backdrop-filter');el.style.removeProperty('-webkit-backdrop-filter');
      el.classList.remove('lg-refracted-card');
      if(resized)resized.unobserve(el);installed.delete(el);pending.delete(el);surfaces.delete(el);status.surfaces=surfaces.size;
    }
    function visible(el){const rect=el.getBoundingClientRect();return el.isConnected&&rect.width>1&&rect.height>1&&rect.bottom>0&&rect.top<window.innerHeight;}
    async function refresh(){
      queued=false;if(!enabled())return;
      if(refreshing){refreshAgain=true;return;}refreshing=true;
      try{
        surfaces.forEach(el=>{if(!el.isConnected||!el.offsetWidth||!el.offsetHeight)detach(el);});
        const primary=[document.querySelector('.bottom-nav')].concat(Array.from(document.querySelectorAll('dialog[open]')));
        const display=(standardDisplayGlass||document.documentElement.dataset.appearance==='custom'?Array.from(document.querySelectorAll(displaySelector)):[]).filter(visible).filter(el=>!el.parentElement.closest(displaySelector)).slice(0,6);
        const targets=primary.concat(display).filter(Boolean);
        // Read geometry in one phase before filter writes. Keep recently visited,
        // connected lenses so scrolling back does not recompile or fade their rims.
        const measured=targets.map(el=>{const width=el.offsetWidth,height=el.offsetHeight;return {el:el,width:width,height:height,radius:Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius)||24,width/2,height/2)};});
        let parked=0;surfaces.forEach(el=>{if(targets.indexOf(el)<0&&(el.tagName==='DIALOG'||++parked>2))detach(el);});
        for(const measurement of measured)await attach(measurement.el,measurement);
      }catch(error){status.failures++; /* CSS material remains usable when optics are unavailable. */}
      finally{refreshing=false;if(refreshAgain){refreshAgain=false;schedule();}}
    }
    function schedule(){
      if(!enabled() || queued)return;queued=true;
      requestAnimationFrame(()=>{
        if(window.requestIdleCallback)requestIdleCallback(refresh,{timeout:120});else requestAnimationFrame(refresh);
      });
    }
    const observer=new MutationObserver(records=>{
      if(records.some(record=>record.attributeName==='open'||record.type==='childList'&&!host.contains(record.target)&&Array.from(record.addedNodes||[]).concat(Array.from(record.removedNodes||[])).some(n=>n.nodeType===1&&!(n.classList&&n.classList.contains('lg-optical-sheen')))))schedule();
    });
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
    if(window.ResizeObserver){
      resized=new ResizeObserver(entries=>{
        const measurements=entries.map(entry=>{const box=entry.borderBoxSize&&(entry.borderBoxSize[0]||entry.borderBoxSize);return {el:entry.target,width:box?Math.round(box.inlineSize):entry.target.offsetWidth,height:box?Math.round(box.blockSize):entry.target.offsetHeight};});
        measurements.forEach(m=>stretchFrame(m.el,m.width,m.height));clearTimeout(resizeTimer);resizeTimer=setTimeout(schedule,120);
      });
      observeSurface(document.querySelector('.bottom-nav'));document.querySelectorAll('dialog').forEach(observeSurface);
    }
    document.addEventListener('scroll',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(schedule,100);},{passive:true,capture:true});
    window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(schedule,120);},{passive:true});
    document.addEventListener('suike-glass-change',()=>{
      generation++;
      clearTimeout(resizeTimer); resizeTimer=null;
      if(!enabled()){
        pending=new WeakMap();
        surfaces.forEach(el=>{
          if(window.SuikeGlassScene)SuikeGlassScene.unregister(el);
          const entry=installed.get(el);
          el.style.removeProperty('backdrop-filter');el.style.removeProperty('-webkit-backdrop-filter');
          if(entry){entry.filter.remove();if(entry.sheen)entry.sheen.remove();}
          el.classList.remove('lg-refracted-card');installed.delete(el);pending.delete(el);
        });
        surfaces.clear();status.surfaces=0;
        document.documentElement.classList.remove('lg-optics-ready');
      }else schedule();
    });
    document.addEventListener('suike-appearance-change',()=>{generation++;surfaces.forEach(detach);schedule();});
    // Frost changes reuse the installed maps; only the blur radius in front of them changes.
    document.addEventListener('suike-glass-frost',()=>{
      if(!enabled())return;
      surfaces.forEach(el=>{
        const entry=installed.get(el);
        if(!entry)return;
        const backdrop=backdropFor(el,entry.filter.id);
        el.style.backdropFilter=backdrop;el.style.webkitBackdropFilter=backdrop;
      });
    });
    SuikeLiquidUI.refreshOptics=schedule;
    schedule();
  })();
