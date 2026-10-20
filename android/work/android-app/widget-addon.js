  // The existing in-app controls own both app and widget appearance.
  (function installWidgetAppearance(){
    let timer=null,last='';
    function sync(){
      timer=null;const native=window.SuikeNative,A=window.SuikeAppearance;
      if(!native||typeof native.syncWidgetAppearance!=='function'||!A)return;
      const reduced=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      const values=[A.isEnabled(),A.getFrost(),reduced],fingerprint=JSON.stringify(values);
      if(fingerprint===last)return;
      try{if(native.syncWidgetAppearance(values[0],values[1],values[2])===true)last=fingerprint;}catch(_){}
    }
    function schedule(){if(timer!==null)clearTimeout(timer);timer=setTimeout(sync,150);}
    document.addEventListener('suike-glass-change',schedule);
    document.addEventListener('suike-glass-frost',schedule);
    const media=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)');
    if(media&&typeof media.addEventListener==='function')media.addEventListener('change',schedule);
    else if(media&&typeof media.addListener==='function')media.addListener(schedule);
    window.SuikeWidgetAppearance={sync};schedule();
  })();
