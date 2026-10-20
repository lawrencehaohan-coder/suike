const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const context = {window:{}};
vm.runInNewContext(fs.readFileSync(__dirname+'/liquid-vendor.js','utf8'),context);
const vendor = context.window.SuikeLiquidGlassVendor;
test('upstream filter and displacement map are bundled with no remote fetch',()=>{
  assert.equal(vendor.commit,'ac48eab18d1f7f444ae30002d240cae29c863a21');
  assert.equal((vendor.svgMarkup.match(/<feDisplacementMap /g)||[]).length,3);
  assert.match(vendor.svgMarkup,/href="data:image\/jpeg;base64,/);
  assert.doesNotMatch(vendor.svgMarkup,/href="https?:/);
  assert.match(fs.readFileSync(__dirname+'/assets/licenses/liquid-glass-react/LICENSE','utf8'),/Copyright 2025 MAX ROVENSKY/);
});
test('elastic response stays finite and bounded at center, edges and far away',()=>{
  const rect={left:20,top:30,width:96,height:44};
  for(const x of [-10000,20,68,116,10000]) for(const y of [-10000,30,52,74,10000]) {
    const result=vendor.directionalScale(rect,x,y,.15);
    Object.values(result).forEach(v=>assert.equal(Number.isFinite(v),true));
    assert.ok(Math.abs(result.x)<=2&&Math.abs(result.y)<=2);
    assert.ok(result.sx>=.8&&result.sx<=1.05&&result.sy>=.8&&result.sy<=1.05);
  }
  assert.equal(vendor.directionalScale(rect,68,52,.15).sx,1);
  assert.equal(vendor.directionalScale(rect,10000,10000,.15).x,0);
  assert.equal(vendor.directionalScale({left:0,top:0,width:0,height:0},0,0,.15).sy,1);
});
