/*! Geometry/specular formulas adapted from LeonardSEO/liquid-glass-react,
 * Copyright (c) 2026 Leonard van Hemert, MIT. Full source/license bundled.
 * Suike: identical optical pixels, sparse neutral centre and cooperative fallback.
 */
window.SuikeScheduledOptics=(function(){
  function pause(){return new Promise(resolve=>setTimeout(resolve,0));}
  function field(px,py,w,h,r,f){
    const dx=px-w/2,dy=py-h/2,sx=dx<0?-1:1,sy=dy<0?-1:1;
    const qx=Math.abs(dx)-(w/2-r),qy=Math.abs(dy)-(h/2-r);
    if(qx>0&&qy>0){const length=Math.hypot(qx,qy);f.dist=r-length;f.nx=sx*qx/length;f.ny=sy*qy/length;}
    else if(qx>qy){f.dist=r-qx;f.nx=sx;f.ny=0;}else{f.dist=r-qy;f.nx=0;f.ny=sy;}
  }
  async function buildRaw(shape,options){
    const O=window.SuikeGlassOptics;
    // Keep beta18's resolution, refraction profile and strength exactly.
    const resolution=options.clear?Math.min(Math.max(2,Math.min(3,window.devicePixelRatio||1)),Math.sqrt(1200000/(shape.width*shape.height))):Math.min(1,Math.sqrt(90000/(shape.width*shape.height)));
    const geometry=O.clampShape({width:shape.width*resolution,height:shape.height*resolution,radius:shape.radius*resolution});
    const width=geometry.width,height=geometry.height,radius=geometry.radius;
    const bezel=Math.max(1,Math.min(options.bezel*resolution,width/2,height/2));
    const profile=O.refractionProfile({bezel:bezel,thickness:options.thickness*resolution,ior:options.ior,profile:options.profile});
    let peak=0;for(let i=0;i<profile.length;i++)peak=Math.max(peak,Math.abs(profile[i]));peak=peak||1;
    const data=new Uint8ClampedArray(width*height*4);
    // A neutral texel is [128,128,128,255] in native byte order.
    const neutral=new Uint32Array(new Uint8Array([128,128,128,255]).buffer)[0];
    if(options.clear)new Uint32Array(data.buffer).fill(neutral);
    // Custom glass already draws the exact beta18 vector sheen. No bitmap copy is used.
    const specular=options.clear?null:new ImageData(width,height),spec=specular&&specular.data;
    const f={dist:0,nx:0,ny:0},angle=-135*Math.PI/180,lx=Math.cos(angle),ly=Math.sin(angle);
    const rim=.8*resolution,glow=Math.min(6,options.bezel*.45)*resolution,cutoff=Math.max(rim*6,glow*3.5);
    let sliceStart=performance.now(),maxSliceMs=0,yields=0,visitedPixels=0;
    for(let y=0;y<height;y++){
      const py=y+.5;
      // Only skip points safely inside the flat centre; corner and edge pixels
      // still use the original formula. An extra pixel avoids boundary rounding.
      let band=width;
      if(options.clear&&py>bezel+1&&py<height-bezel-1){
        band=Math.ceil((py>radius+1&&py<height-radius-1?bezel:Math.max(radius,bezel))+1);
      }
      for(let x=0;x<width;x++){
        if(options.clear&&x>=band&&x<width-band){x=width-band;if(x>=width)break;}
        visitedPixels++;
        const offset=(y*width+x)*4;field(x+.5,py,width,height,radius,f);
        let vx=0,vy=0;
        if(f.dist>=0&&f.dist<bezel){const magnitude=profile[Math.min(255,Math.floor(f.dist/bezel*256))]/peak;vx=-f.nx*magnitude;vy=-f.ny*magnitude;}
        data[offset]=128+vx*127;data[offset+1]=128+vy*127;data[offset+2]=128;data[offset+3]=255;
        if(spec&&f.dist>=0&&f.dist<=cutoff){
          const facing=f.nx*lx+f.ny*ly,lit=Math.pow(Math.abs(facing),1.6),directional=facing<0?lit:lit*.7;
          const line=Math.exp(-Math.pow(f.dist/rim,2)),inner=Math.exp(-Math.pow((f.dist-rim*2.2)/rim,2))*.35;
          const diffuse=Math.exp(-f.dist/glow)*(.06+.3*directional),aa=Math.min(1,f.dist+.5);
          const alpha=((line+inner)*(.3+directional*.7)+diffuse)*aa;
          spec[offset]=spec[offset+1]=spec[offset+2]=255;spec[offset+3]=Math.min(255,alpha*255);
        }
      }
      const elapsed=performance.now()-sliceStart;
      if(!options.offthread&&elapsed>=2){maxSliceMs=Math.max(maxSliceMs,elapsed);yields++;await pause();sliceStart=performance.now();}
    }
    maxSliceMs=Math.max(maxSliceMs,performance.now()-sliceStart);
    return {displacement:{data:data,width:width,height:height,scale:peak*2/resolution},specular:specular,
      scale:peak*2/resolution,resolution:resolution,maxSliceMs:maxSliceMs,yields:yields,
      visitedPixels:visitedPixels,totalPixels:width*height};
  }
  return {buildRaw:buildRaw,pause:pause};
})();
