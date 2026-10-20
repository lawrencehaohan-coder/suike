// CPU DOM/event model. It executes the delivered JS; it does not render CSS.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../../..');
const html=fs.readFileSync(path.join(root,'work/android-app/assets/index.html'),'utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const source=fs.readFileSync(path.join(root,'work/android-app/test-import-integration.cjs'),'utf8');
let part=source.slice(source.indexOf('class TestNode {'),source.indexOf("test('real compiled app initializes"));
part=part.replace('const document=parseDom(), data=new Map()',`const timers=new Map();let elapsed=0,serial=0,base=Date.parse('2026-10-12T02:23:00Z');
  const schedule=(fn,delay)=>{const id=++serial;timers.set(id,{fn,due:elapsed+Math.max(0,Number(delay)||0)});return id;};
  const clock={tick(ms){const end=elapsed+ms;let steps=0;for(;;){const next=[...timers].filter(([,t])=>t.due<=end).sort((a,b)=>a[1].due-b[1].due||a[0]-b[0])[0];if(!next)break;if(++steps>10000)throw Error('Timer loop');elapsed=next[1].due;timers.delete(next[0]);next[1].fn();if(next[1].repeat)timers.set(next[0],{...next[1],due:elapsed+next[1].repeat});}elapsed=end;},setNow(iso){base=Date.parse(iso)-elapsed;},get elapsed(){return elapsed;}};
  const document=parseDom(), data=new Map()`);
part=part.replace('setTimeout(){return 1},clearTimeout(){},setInterval(){return 1}', 'setTimeout:schedule,clearTimeout(id){timers.delete(id)},setInterval(fn,delay){const id=schedule(fn,delay);timers.get(id).repeat=delay;return id;}');
part=part.replace('requestAnimationFrame(fn){fn();return 1},clearRequestAnimationFrame(){}', 'requestAnimationFrame(fn){return schedule(()=>fn(elapsed),16)},cancelAnimationFrame(id){timers.delete(id)},clearRequestAnimationFrame(id){timers.delete(id)}');
part=part.replace('Blob,FormData:TestFormData,Intl,Date,Promise,', 'Blob,FormData:TestFormData,Intl,Date:class extends Date{constructor(...args){super(...(args.length?args:[base+elapsed]));}static now(){return base+elapsed}},Promise,');
part=part.replace('return {context,document,data,exports,bridges,getState', 'return {clock,context,document,data,exports,bridges,getState');
// boot(state, storage): optional extra localStorage entries present before startup.
part=part.replace("if(stored)data.set('suike.timetable.v1',JSON.stringify(stored));", "if(stored)data.set('suike.timetable.v1',JSON.stringify(stored));if(arguments[1])Object.keys(arguments[1]).forEach(key=>data.set(key,arguments[1][key]));");
part=part.replace('scripts.forEach', 'if(arguments[2])arguments[2](context);scripts.forEach');
part+=`\nTestNode.prototype.cloneNode=function(deep){const n=this.ownerDocument.createElement(this.tagName.toLowerCase());n._text=this._text;n.attributes={...this.attributes};n.dataset={...this.dataset};Object.assign(n.style,this.style);if(deep)this.children.forEach(child=>n.append(child.cloneNode(true)));return n;};`;
function evaluate(context,code){return vm.runInContext(code,context,{timeout:10000});}
function put(context,name,value){evaluate(context,'globalThis['+JSON.stringify(name)+']=JSON.parse('+JSON.stringify(JSON.stringify(value))+')');}
const boot=new Function('html','scripts','vm','evaluate','put',part+'\nreturn appHarness;')(html,scripts,vm,evaluate,put);
module.exports={root,html,scripts,boot,evaluate,put};
