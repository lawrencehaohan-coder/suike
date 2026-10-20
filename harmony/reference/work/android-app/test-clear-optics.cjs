const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const test=require('node:test'),assert=require('node:assert/strict');
class ImageDataShim{constructor(width,height){this.width=width;this.height=height;this.data=new Uint8ClampedArray(width*height*4);}}
const context={window:{},ImageData:ImageDataShim};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'liquid-optics.js'),'utf8'),context);
const optics=context.window.SuikeGlassOptics;
let simulatedTime=0;context.performance={now:()=>simulatedTime+=.5};context.setTimeout=setTimeout;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'liquid-map-scheduler.js'),'utf8'),context);
const scheduled=context.window.SuikeScheduledOptics;
test('cooperative map generation preserves the upstream optical pixels',async()=>{
  const shape={width:120,height:60,radius:26},options={bezel:12,thickness:18,ior:1.5,profile:'squircle'};
  const result=await scheduled.buildRaw(shape,options),reference=optics.buildDisplacementMap(shape,options);
  assert.deepEqual(Array.from(result.displacement.data),Array.from(reference.data));
  assert.equal(result.scale,reference.scale);assert.ok(result.yields>0);assert.ok(result.maxSliceMs<=3);
});
test('large dialog maps cap texture work while retaining their CSS displacement scale',async()=>{
  const result=await scheduled.buildRaw({width:400,height:800,radius:24},{bezel:12,thickness:18,ior:1.5,profile:'squircle'});
  assert.ok(result.displacement.width*result.displacement.height<=90500);
  assert.ok(result.resolution<1&&Number.isFinite(result.scale)&&result.scale>0);
  assert.ok(result.yields>0);
});
test('shape-matched refraction keeps the center flat and bends opposing edges inward',()=>{
  const map=optics.buildDisplacementMap({width:240,height:60,radius:26},{bezel:12,thickness:18,ior:1.5,profile:'squircle'});
  const pixel=(x,y)=>Array.from(map.data.slice((y*map.width+x)*4,(y*map.width+x)*4+4));
  assert.deepEqual(pixel(120,30),[128,128,128,255]);
  assert.ok(pixel(3,30)[0]>128);assert.ok(pixel(236,30)[0]<128);
  assert.ok(pixel(120,3)[1]>128);assert.ok(pixel(120,56)[1]<128);
  assert.ok(Number.isFinite(map.scale)&&map.scale>0&&map.scale<40);
});
test('specular light is neutral white and fades out before the flat center',()=>{
  const image=optics.buildSpecularMap({width:120,height:60,radius:26},{angle:-135,rimWidth:.8,glowWidth:5},1);
  let lit=0;
  for(let i=0;i<image.data.length;i+=4){
    if(image.data[i+3]){lit++;assert.equal(image.data[i],image.data[i+1]);assert.equal(image.data[i+1],image.data[i+2]);}
  }
  assert.ok(lit>30);assert.equal(image.data[(30*120+60)*4+3],0);
});
test('invalid optical inputs fail without silently producing malformed textures',()=>{
  for(const override of [{bezel:0},{ior:0},{thickness:-1},{ior:NaN}]){
    assert.throws(()=>optics.refractionProfile({...{bezel:12,thickness:18,ior:1.5,profile:'squircle'},...override}),{name:'RangeError'});
  }
});
test('material colors remain neutral and all established CSS animation timings are preserved',()=>{
  const css=fs.readFileSync(path.join(__dirname,'liquid-ui.css'),'utf8').split('/* SUIKE_CUSTOM_WATER_V1 */')[0];
  for(const match of css.matchAll(/rgba?\((\d+),(\d+),(\d+)/g)){
    assert.equal(match[1],match[2]);assert.equal(match[2],match[3]);
  }
  assert.match(css,/--lg-floor:#000/);assert.match(css,/--lg-floor:#fff/);
  assert.match(css,/background-image:none/);
  assert.match(css,/transition:transform 360ms var\(--lg-ease\)/);
  assert.match(css,/lg-dialog-in 280ms/);assert.match(css,/lg-dialog-out 170ms/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});

test('custom lenses use bounded device-scale textures while standard material keeps its old pixels',async()=>{
 const shape={width:360,height:800,radius:28},options={bezel:12,thickness:18,ior:1.33,profile:'squircle',clear:true};
 const raw=await scheduled.buildRaw(shape,options);assert.ok(raw.resolution>=2);assert.ok(raw.displacement.width*raw.displacement.height<=1205000);assert.ok(raw.yields>0);
 const large=await scheduled.buildRaw({width:600,height:1000,radius:28},options);assert.ok(large.displacement.width*large.displacement.height<=1205000);assert.ok(large.resolution>1);
});
