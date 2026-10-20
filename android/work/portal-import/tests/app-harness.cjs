// CPU event model executing the generated asset. No CSS rendering or device claims.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=path.resolve(__dirname,'../../android-app');
const html=fs.readFileSync(path.join(app,'assets/index.html'),'utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const source=fs.readFileSync(path.join(app,'test-import-integration.cjs'),'utf8');
const part=source.slice(source.indexOf('class TestNode {'),source.indexOf("test('real compiled app initializes"));
function evaluate(context,code){return vm.runInContext(code,context,{timeout:10000});}
function put(context,name,value){evaluate(context,'globalThis['+JSON.stringify(name)+']=JSON.parse('+JSON.stringify(JSON.stringify(value))+')');}
const boot=new Function('html','scripts','vm','evaluate','put',part+'\nreturn appHarness;')(html,scripts,vm,evaluate,put);
module.exports={boot,evaluate,put};
