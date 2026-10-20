const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./shared-scene-harness.cjs');
test('HD video uses one bounded raster, shared blur targets and no live card backdrop',async()=>{
 const h=fixture();await h.drain();const v=h.video();await h.drain();const s=h.ctx.SuikeGlassScene.status;
 assert.equal(s.active,true);assert.equal(s.mediaKind,'video');assert.equal(s.videoSourceWidth,3840);assert.equal(s.videoSourceHeight,2160);assert.ok(s.pixelRatio<=2);assert.ok(360*780*s.pixelRatio*s.pixelRatio<=1200001);assert.equal(h.root.dataset.glassVideo,'on');assert.equal(h.foregrounds().length,1);assert.equal(v.pending(),1);assert.equal(h.foregrounds()[0].parentElement,h.nav().parentElement);
});
test('scrolling reuses a paused decoded frame and does not upload, blur or allocate each card again',async()=>{
 const h=fixture();await h.drain();const v=h.video();await h.drain();v.pause();await h.drain();const before=h.stats(),frames=h.ctx.SuikeGlassScene.status.videoFrames,copies=h.ctx.SuikeGlassScene.status.foregroundCopies;
 for(let i=0;i<15;i++){h.a.rect.top-=2;h.a.rect.bottom-=2;h.emit('scroll');await h.drain();}
 assert.equal(h.stats().uploads,before.uploads);assert.equal(h.stats().textureCount,before.textureCount);assert.equal(h.ctx.SuikeGlassScene.status.videoFrames,frames);assert.equal(h.ctx.SuikeGlassScene.status.foregroundCopies,copies);
});
test('60Hz decoded video is rate limited while texture allocation remains constant',async()=>{
 const h=fixture();await h.drain();const v=h.video();await h.drain();const before=h.stats(),s=h.ctx.SuikeGlassScene.status,initial=s.videoFrames,start=h.now();
 for(let i=0;i<120;i++){v.frame();await h.drain();}
 assert.ok(s.videoFrames>initial+10);assert.ok(s.videoFrames-initial<=Math.ceil((h.now()-start)*24/1000)+2);assert.equal(h.stats().textureCount,before.textureCount);assert.equal(h.stats().uploads-before.uploads,s.videoFrames-initial);assert.ok(s.foregroundCopies<=s.videoFrames+1);
});
test('backgrounding stops callbacks and removing the video restores the unchanged image path',async()=>{
 const h=fixture();await h.drain();const v=h.video();await h.drain();h.ctx.document.hidden=true;h.emit('visibilitychange');assert.equal(v.pending(),0);
 h.ctx.document.hidden=false;h.emit('visibilitychange');await h.drain();assert.equal(v.pending(),1);
 h.setMedia({kind:'image',element:{naturalWidth:900,naturalHeight:1600}});h.emit('suike-wallpaper-media');await h.drain();assert.equal(v.pending(),0);assert.equal(h.ctx.SuikeGlassScene.status.mediaKind,'image');assert.equal(h.foregrounds().length,0);assert.equal(h.root.dataset.glassVideo,undefined);assert.equal(h.ctx.SuikeGlassScene.status.pixelRatio,3);
});
test('a context failure makes the original video visible again and never traps the UI',async()=>{
 const h=fixture();await h.drain();const v=h.video();await h.drain();h.layer.children[0].listeners.webglcontextlost({preventDefault(){}});assert.equal(v.pending(),0);assert.equal(h.ctx.SuikeGlassScene.status.active,false);assert.equal(h.foregrounds().length,0);
 h.layer.children[0].listeners.webglcontextrestored();await h.drain();assert.equal(h.ctx.SuikeGlassScene.status.active,true);assert.equal(v.pending(),1);
});
