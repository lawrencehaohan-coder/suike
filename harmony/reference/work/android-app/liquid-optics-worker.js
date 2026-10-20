// Runs only bundled geometry and local PNG encoding. No documents or API data.
let queue=Promise.resolve();
self.onmessage=function(event){
  const job=event.data;
  queue=queue.then(async function(){
    try{
      self.devicePixelRatio=job.dpr||1;
      const options=Object.assign({},job.options,{offthread:true});
      const started=performance.now();
      const raw=await self.SuikeScheduledOptics.buildRaw(job.shape,options);
      const generated=performance.now();
      const canvas=new OffscreenCanvas(raw.displacement.width,raw.displacement.height);
      const context=canvas.getContext('2d',{willReadFrequently:true});
      if(!context)throw Error('Worker canvas unavailable');
      context.putImageData(new ImageData(raw.displacement.data,raw.displacement.width,raw.displacement.height),0,0);
      const blob=await canvas.convertToBlob({type:'image/png'});
      const displacement=new FileReaderSync().readAsDataURL(blob);
      self.postMessage({id:job.id,result:{displacement:displacement,scale:raw.scale,resolution:raw.resolution,
        visitedPixels:raw.visitedPixels,totalPixels:raw.totalPixels,buildMs:generated-started,encodingMs:performance.now()-generated}});
    }catch(error){self.postMessage({id:job.id,error:String(error&&error.message||error)});}
  });
};
