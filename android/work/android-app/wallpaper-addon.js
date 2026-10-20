  // Media belongs to this device's appearance, never to a course backup or AI request.
  (function installWallpaper(){
    const card=$('displaySettings'),content=card.querySelector('.settings-fold-content');
    const area=node('div','wallpaper-settings'),label=node('strong','','壁纸');
    const meta=node('p','period-time-hint','图片或本地视频，添加后开启液态玻璃。');meta.id='wallpaperStatus';meta.setAttribute('role','status');
    const actions=node('div','ai-actions');
    const image=document.createElement('input');image.type='file';image.accept='image/png,image/jpeg,image/webp';image.hidden=true;image.id='wallpaperImage';
    const movie=document.createElement('input');movie.type='file';movie.accept='video/mp4,video/webm';movie.hidden=true;movie.id='wallpaperVideo';
    const chooseImage=button('button button-outline','选择图片',()=>image.click()),chooseVideo=button('button button-outline','选择视频',()=>movie.click());
    chooseImage.id='chooseWallpaperImage';chooseVideo.id='chooseWallpaperVideo';
    const remove=button('text-button','移除',()=>removeMedia());remove.id='removeWallpaper';remove.hidden=true;
    actions.append(chooseImage,chooseVideo,remove);area.append(label,meta,actions,image,movie,node('small','ai-message','仅保存在本机；图片 ≤8 MB，视频 ≤32 MB。'));content.append(area);
    const layer=node('div','suike-wallpaper');layer.id='suikeWallpaper';layer.setAttribute('aria-hidden','true');document.body.insertBefore(layer,document.body.firstChild);
    let current=null,storedMedia=null,media=null,url='',serial=0,db=null;
    const MODE_KEY='suike.wallpaper.mode.v1',theme=$('theme'),customOption=node('option','','自定义背景');customOption.value='custom';theme.append(customOption);
    let custom=false;
    function syncMode(){const before=document.documentElement.dataset.appearance;document.documentElement.dataset.appearance=custom?'custom':'standard';if(before!==document.documentElement.dataset.appearance&&typeof CustomEvent==='function')document.dispatchEvent(new CustomEvent('suike-appearance-change'));if(custom){document.documentElement.dataset.theme='custom';theme.value='custom';}else{document.documentElement.dataset.theme=state.settings.theme;theme.value=state.settings.theme;}const toggle=$('glassEnabled');toggle.disabled=custom;if(custom)$('glassStatus').textContent='自定义背景使用液态玻璃';}
    const previousRender=render;render=function(){previousRender();syncMode();};
    function setMode(active,persistMode){custom=!!(active&&storedMedia);syncMode();apply(custom?storedMedia:null);if(custom)window.SuikeAppearance.setEnabled(true);else window.SuikeAppearance.setEnabled(window.SuikeAppearance.isEnabled());if(window.SuikeFeatures)SuikeFeatures.syncNative();if(persistMode)try{localStorage.setItem(MODE_KEY,custom?'custom':'standard');}catch(_){meta.textContent+=' · 外观模式未能保存';}}
    window.SuikeWallpaper={mediaForGlass:()=>current&&media?{kind:current.kind,element:media}:null,isCustom:()=>custom,selectTheme(value){if(value==='custom'){if(storedMedia)setMode(true,true);else{theme.value=state.settings.theme;$('settingsDisplayDetails').open=true;meta.textContent='选择图片或视频作为背景。';chooseImage.focus();}return true;}setMode(false,true);return false;}};
    const reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)');
    function openDb(){
      if(db)return Promise.resolve(db);
      return new Promise((resolve,reject)=>{
        if(!window.indexedDB){reject(new Error('当前系统无法保存壁纸。'));return;}
        const request=window.indexedDB.open('suike.wallpaper.v1',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('media');
        request.onerror=()=>reject(new Error('壁纸存储不可用，请检查设备空间。'));
        request.onblocked=()=>reject(new Error('请关闭其他随课预览后重试。'));
        request.onsuccess=()=>{db=request.result;db.onversionchange=()=>{db.close();db=null;};resolve(db);};
      });
    }
    function read(){return openDb().then(database=>new Promise((resolve,reject)=>{const tx=database.transaction('media','readonly'),request=tx.objectStore('media').get('current');request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(new Error('壁纸未能读取。'));}));}
    function persist(value){return openDb().then(database=>new Promise((resolve,reject)=>{
      const tx=database.transaction('media','readwrite');if(value)tx.objectStore('media').put(value,'current');else tx.objectStore('media').delete('current');
      tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(new Error('壁纸未能保存，原壁纸保留。'));
    }));}
    function playback(){if(media&&current&&current.kind==='video'){if(document.hidden||(reduced&&reduced.matches)){media.pause();}else{const play=media.play();if(play&&play.catch)play.catch(()=>{meta.textContent='视频已保存，当前显示静止画面。';});}}}
    function notifyGlass(){if(typeof CustomEvent==='function')document.dispatchEvent(new CustomEvent('suike-wallpaper-media'));}
    function apply(value){
      if(media&&typeof media.pause==='function'){media.pause();media.removeAttribute('src');if(typeof media.load==='function')media.load();}layer.replaceChildren();if(url)URL.revokeObjectURL(url);url='';media=null;current=value;
      document.documentElement.dataset.wallpaper=value?'on':'off';remove.hidden=!value;
      if(!value){meta.textContent='图片或本地视频，添加后开启液态玻璃。';notifyGlass();return;}
      url=URL.createObjectURL(value.blob);media=document.createElement(value.kind==='video'?'video':'img');media.src=url;
      if(value.kind==='video'){media.muted=true;media.loop=true;media.playsInline=true;media.preload='auto';media.setAttribute('playsinline','');media.addEventListener('loadeddata',()=>{playback();notifyGlass();});media.addEventListener('resize',notifyGlass);}
      else{media.alt='';media.addEventListener('load',notifyGlass,{once:true});}layer.append(media);meta.textContent=(value.kind==='video'?'视频 · ':'图片 · ')+value.name;playback();notifyGlass();
    }
    function validate(file,kind){return new Promise((resolve,reject)=>{
      if(!file||!file.size){reject(new Error('文件为空。'));return;}
      if(file.size>(kind==='video'?32:8)*1024*1024){reject(new Error(kind==='video'?'请选择 32 MB 以内的视频。':'请选择 8 MB 以内的图片。'));return;}
      const allowed=kind==='video'?['video/mp4','video/webm']:['image/png','image/jpeg','image/webp'];
      if(!allowed.includes(file.type)){reject(new Error('请选择 PNG、JPG、WebP 图片或 MP4、WebM 视频。'));return;}
      const probe=document.createElement(kind==='video'?'video':'img'),probeUrl=URL.createObjectURL(file);
      let ended=false;const timer=setTimeout(()=>finish(false),12000);
      function finish(ok){if(ended)return;ended=true;clearTimeout(timer);probe.removeAttribute('src');if(probe.load)probe.load();URL.revokeObjectURL(probeUrl);ok?resolve():reject(new Error('系统无法读取这个媒体文件，请换一个文件。'));}
      probe.addEventListener(kind==='video'?'loadeddata':'load',()=>finish(true),{once:true});probe.addEventListener('error',()=>finish(false),{once:true});probe.muted=true;probe.preload='auto';probe.src=probeUrl;
    });}
    function busy(value){chooseImage.disabled=value;chooseVideo.disabled=value;remove.disabled=value;}
    async function select(file,kind){
      if(!file)return;const token=++serial;busy(true);meta.textContent='正在保存壁纸…';
      try{await validate(file,kind);if(token!==serial)return;const value={version:1,kind,name:file.name.slice(0,120),blob:file};await persist(value);if(token!==serial)return;storedMedia=value;setMode(true,true);}
      catch(error){meta.textContent=error.message;}
      finally{if(token===serial)busy(false);image.value='';movie.value='';}
    }
    async function removeMedia(){const token=++serial;busy(true);try{await persist(null);if(token===serial){storedMedia=null;setMode(false,true);}}catch(error){meta.textContent=error.message;}finally{if(token===serial)busy(false);}}
    image.addEventListener('change',()=>select(image.files&&image.files[0],'image'));movie.addEventListener('change',()=>select(movie.files&&movie.files[0],'video'));
    document.addEventListener('visibilitychange',playback);window.addEventListener('pageshow',playback);window.addEventListener('pagehide',()=>{if(media&&media.pause)media.pause();});
    if(reduced){if(reduced.addEventListener)reduced.addEventListener('change',playback);else if(reduced.addListener)reduced.addListener(playback);}
    // In-memory test harnesses and devices without IndexedDB retain classic appearance.
    if(window.indexedDB)read().then(value=>{if(serial===0){storedMedia=value;let active=true;try{active=localStorage.getItem(MODE_KEY)!=='standard';}catch(_){}setMode(active,false);}}).catch(error=>{meta.textContent=error.message;});
  })();
