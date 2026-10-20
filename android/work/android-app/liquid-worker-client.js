window.SuikeOpticsWorker=(function(){
  const source=/* SUIKE_OPTICS_WORKER_SOURCE */null;
  let worker=null,disabled=false,sequence=0;
  const jobs=new Map(),status={jobs:0,completed:0,fallbacks:0,pending:0};
  function stop(){
    if(worker)worker.terminate();worker=null;disabled=true;
    jobs.forEach(job=>{clearTimeout(job.timer);job.resolve(null);status.fallbacks++;});jobs.clear();status.pending=0;
  }
  function ensure(){
    if(disabled||typeof Worker!=='function'||typeof OffscreenCanvas!=='function'||!source)return null;
    if(worker)return worker;
    let url='';
    try{
      url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
      worker=new Worker(url);URL.revokeObjectURL(url);url='';
      worker.onerror=event=>{if(event&&event.preventDefault)event.preventDefault();stop();};
      worker.onmessage=event=>{
        const message=event.data,job=jobs.get(message.id);if(!job)return;
        clearTimeout(job.timer);jobs.delete(message.id);status.pending=jobs.size;
        if(message.error){status.fallbacks++;job.resolve(null);stop();}else{status.completed++;job.resolve(message.result);}
      };
      return worker;
    }catch(_){if(url)URL.revokeObjectURL(url);stop();return null;}
  }
  function build(shape,options){
    const target=ensure();if(!target)return Promise.resolve(null);
    return new Promise(resolve=>{
      const id=++sequence;
      // A broken/unsupported worker must never prevent a usable CSS fallback.
      const timer=setTimeout(stop,15000);jobs.set(id,{resolve:resolve,timer:timer});status.jobs++;status.pending=jobs.size;
      try{target.postMessage({id:id,shape:shape,options:options,dpr:window.devicePixelRatio||1});}catch(_){stop();}
    });
  }
  window.addEventListener('pagehide',stop,{once:true});
  return {build:build,status:status};
})();
