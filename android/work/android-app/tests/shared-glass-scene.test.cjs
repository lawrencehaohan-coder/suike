const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./shared-scene-harness.cjs');
test('scroll reuses preprocessed wallpaper textures and draws only main-page surfaces',async()=>{
 const h=fixture();await h.drain();const initial=h.stats();assert.equal(h.ctx.SuikeGlassScene.status.active,true);assert.equal(h.ctx.SuikeGlassScene.status.backgroundBuilds,1);assert.equal(h.ctx.SuikeGlassScene.status.surfaces,3);assert.equal(h.ignored.classList.contains('lg-scene-surface'),false);
 for(let i=0;i<20;i++){h.a.rect.top-=2;h.a.rect.bottom-=2;h.emit('scroll');await h.drain();}
 assert.equal(h.stats().uniformQueries,initial.uniformQueries);assert.equal(h.stats().attributeQueries,initial.attributeQueries);assert.equal(h.stats().classWrites,initial.classWrites);assert.equal(h.stats().uploads,initial.uploads);assert.equal(h.stats().textureCount,initial.textureCount);assert.equal(h.ctx.SuikeGlassScene.status.backgroundBuilds,1);assert.ok(h.stats().draws>initial.draws);
});
test('equal optical maps share a GPU texture and deformation keeps the same map',async()=>{
 const h=fixture();await h.drain();const scene=h.ctx.SuikeGlassScene,maps={displacement:'data:image/png;base64,same',scale:9.7};scene.register(h.a,maps,{width:330,height:220,radius:22});scene.register(h.b,maps,{width:330,height:350,radius:22});await h.drain();assert.equal(h.stats().decodes,1);
 const before=h.stats();h.a.rect.height=320;h.a.rect.bottom=380;h.resizers.forEach(fn=>fn([]));await h.drain();assert.equal(h.stats().uploads,before.uploads);assert.equal(h.stats().decodes,before.decodes);assert.equal(scene.status.backgroundBuilds,1);
 scene.unregister(h.a);scene.unregister(h.b);await h.drain();assert.equal(scene.status.lenses,0);
});
test('standard appearance, unready videos and diagnostic off mode restore live glass instead of removing effects',async()=>{
 const h=fixture();await h.drain();h.ctx.SuikeGlassScene.setEnabled(false);assert.equal(h.root.dataset.glassScene,undefined);assert.equal(h.a.classList.contains('lg-scene-surface'),false);
 h.ctx.SuikeGlassScene.setEnabled(true);await h.drain();assert.equal(h.ctx.SuikeGlassScene.status.active,true);
 h.setMedia({kind:'video',element:{}});h.emit('suike-wallpaper-media');await h.drain();assert.equal(h.ctx.SuikeGlassScene.status.active,false);
 h.root.dataset.appearance='standard';h.emit('suike-appearance-change');await h.drain();assert.equal(h.root.dataset.glassScene,undefined);
});
test('unavailable WebGL never suppresses the existing CSS/SVG material',async()=>{
 const h=fixture(true);await h.drain();assert.equal(h.ctx.SuikeGlassScene.status.active,false);assert.equal(h.root.dataset.glassScene,undefined);assert.equal(h.a.classList.contains('lg-scene-surface'),false);
});
test('context loss releases stale texture bindings and restores the shared layer after recovery',async()=>{
 const h=fixture();await h.drain();const canvas=h.layer.children[0];canvas.listeners.webglcontextlost({preventDefault(){}});assert.equal(h.ctx.SuikeGlassScene.status.active,false);assert.equal(h.root.dataset.glassScene,undefined);
 canvas.listeners.webglcontextrestored();await h.drain();assert.equal(h.ctx.SuikeGlassScene.status.active,true);assert.equal(h.layer.children.length,1);
});

test('opening a modal leaves the unchanged page still so its backdrop can be reused',async()=>{
 const h=fixture();await h.drain();const before=h.ctx.SuikeGlassScene.status.frames;h.setDialogOpen(true);h.emit('click');await h.drain();assert.equal(h.ctx.SuikeGlassScene.status.frames-before,1);
});
