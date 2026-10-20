const test=require('node:test'),assert=require('node:assert/strict');
const {boot}=require('./interaction-harness.cjs');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(saved=new Map(),fail=false,storage){
 let played=0,paused=0,revoked=0;const media=[];
 function prepare(context){
  const database={createObjectStore(){},close(){},transaction(){const tx={};tx.objectStore=()=>({get(key){const r={};queueMicrotask(()=>{r.result=saved.get(key);r.onsuccess&&r.onsuccess();});return r;},put(value,key){queueMicrotask(()=>{if(fail){tx.onerror&&tx.onerror();return;}saved.set(key,value);tx.oncomplete&&tx.oncomplete();});},delete(key){queueMicrotask(()=>{saved.delete(key);tx.oncomplete&&tx.oncomplete();});}});return tx;}};
  context.indexedDB={open(){const request={result:database};queueMicrotask(()=>{request.onupgradeneeded&&request.onupgradeneeded();request.onsuccess&&request.onsuccess();});return request;}};
  context.URL={createObjectURL:()=> 'blob:synthetic-media',revokeObjectURL(){revoked++;}};
  const create=context.document.createElement.bind(context.document);
  context.document.createElement=tag=>{const element=create(tag);if(tag==='img'||tag==='video'){
   Object.defineProperty(element,'src',{get(){return this._src||'';},set(v){this._src=v;queueMicrotask(()=>element.fire(tag==='video'?'loadeddata':'load'));}});
   element.play=()=>{played++;return Promise.resolve();};element.pause=()=>{paused++;};media.push(element);
  }return element;};
 }
 const h=boot(undefined,storage,prepare),by=id=>h.document.getElementById(id);
 async function select(kind,type){await settle();const file=new Blob(['synthetic media'],{type});file.name=kind==='video'?'本地.mp4':'壁纸.png';const input=by(kind==='video'?'wallpaperVideo':'wallpaperImage');input.files=[file];await input.fire('change');await settle();}
 return Object.assign(h,{by,saved,select,stats:()=>({played,paused,revoked}),media});
}
test('a selected local image persists its blob and enables glass without changing timetable data',async()=>{
 const h=fixture(),before=h.getState();await h.select('image','image/png');assert.equal(h.saved.get('current').kind,'image');assert.equal(h.context.SuikeAppearance.isEnabled(),true);assert.equal(h.document.documentElement.dataset.wallpaper,'on');assert.deepEqual(h.getState(),before);
 assert.equal(JSON.stringify(h.getState()).includes('synthetic media'),false);assert.equal(h.by('removeWallpaper').hidden,false);
});
test('stored wallpaper restores on startup and removing it revokes the object URL and preserves courses',async()=>{
 const first=fixture();await first.select('image','image/png');const h=fixture(first.saved),before=h.getState();await settle();await settle();assert.equal(h.document.documentElement.dataset.wallpaper,'on');await h.by('removeWallpaper').click();await settle();assert.equal(h.saved.has('current'),false);assert.equal(h.document.documentElement.dataset.wallpaper,'off');assert.ok(h.stats().revoked>0);assert.deepEqual(h.getState(),before);
});
test('quota or transaction failure keeps the previous appearance and reports a save failure',async()=>{
 const h=fixture(new Map(),true),before=h.getState();await h.select('image','image/png');assert.equal(h.saved.has('current'),false);assert.notEqual(h.document.documentElement.dataset.wallpaper,'on');assert.match(h.by('wallpaperStatus').textContent,/未能保存/);assert.equal(h.context.SuikeAppearance.isEnabled(),false);assert.deepEqual(h.getState(),before);
});
test('unsupported files never reach storage and background videos pause until the app becomes visible',async()=>{
 const h=fixture();await h.select('image','text/html');assert.equal(h.saved.size,0);assert.match(h.by('wallpaperStatus').textContent,/请选择/);await h.select('video','video/mp4');assert.ok(h.stats().played>0);assert.equal(h.saved.get('current').kind,'video');const before=h.stats().paused;h.document.hidden=true;await h.document.fire('visibilitychange');assert.ok(h.stats().paused>before);h.document.hidden=false;const played=h.stats().played;await h.document.fire('visibilitychange');assert.ok(h.stats().played>played);
});

test('custom wallpaper is an exclusive appearance mode and keeps glass enabled',async()=>{
 const h=fixture();await h.select('image','image/png');assert.equal(h.document.documentElement.dataset.appearance,'custom');assert.equal(h.document.documentElement.dataset.theme,'custom');assert.equal(h.by('theme').value,'custom');assert.equal(h.by('glassEnabled').disabled,true);
 h.context.SuikeAppearance.setEnabled(false);assert.equal(h.context.SuikeAppearance.isEnabled(),true);
 h.by('theme').value='dark';await h.by('theme').fire('change');assert.equal(h.document.documentElement.dataset.wallpaper,'off');assert.equal(h.document.documentElement.dataset.theme,'dark');assert.equal(h.getState().settings.theme,'dark');assert.equal(h.saved.has('current'),true);assert.equal(h.by('glassEnabled').disabled,false);
 h.by('theme').value='custom';await h.by('theme').fire('change');assert.equal(h.document.documentElement.dataset.appearance,'custom');assert.equal(h.document.documentElement.dataset.wallpaper,'on');assert.equal(h.context.SuikeAppearance.isEnabled(),true);
});
test('returning to a standard theme remains standard after restart, without losing the saved background',async()=>{
 const first=fixture();await first.select('video','video/mp4');first.by('theme').value='light';await first.by('theme').fire('change');const h=fixture(first.saved,false,Object.fromEntries(first.data));await settle();await settle();
 assert.equal(h.document.documentElement.dataset.wallpaper,'off');assert.equal(h.document.documentElement.dataset.appearance,'standard');assert.equal(h.getState().settings.theme,'light');assert.equal(h.saved.get('current').kind,'video');
 h.by('theme').value='custom';await h.by('theme').fire('change');assert.equal(h.document.documentElement.dataset.wallpaper,'on');
});
test('semester save in custom mode never writes an unsupported theme into course data',async()=>{
 const h=fixture();await h.select('image','image/png');const courses=h.getState().courses;await h.by('settingsForm').fire('submit');
 assert.ok(['auto','light','dark'].includes(h.getState().settings.theme));assert.equal(h.document.documentElement.dataset.theme,'custom');assert.deepEqual(h.getState().courses,courses);
});
