const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),expected=require('./fixtures/beta18-visual-hashes.json');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
test('beta18 material and disclosure/navigation motion remain byte-for-byte unchanged',()=>{
 for(const file of ['liquid-ui.js','liquid-ui.css'])assert.equal(sha(fs.readFileSync(path.join(root,file))),expected[file],file);
});
test('native permits bundled workers and exact scene image names while preserving other restrictions',()=>{
 const file='src/cn/suike/timetable/MainActivity.java',source=fs.readFileSync(path.join(root,file),'utf8');
 assert.match(source,/worker-src blob:;/);assert.match(source,/connect-src 'none'/);assert.match(source,/child-src 'none'/);
 assert.equal(sha(source.replace('worker-src blob:;',"worker-src 'none';").replace('if (!ASSETS.contains(name) && !AmbientAssets.allows(name)) return denied();','if (!ASSETS.contains(name)) return denied();').replace('mime.startsWith("image/png") || mime.startsWith("image/webp") || mime.startsWith("font/")','mime.startsWith("image/png") || mime.startsWith("font/")').replace('        if (name.endsWith(".webp")) return "image/webp";\n','')),expected[file]);
});
