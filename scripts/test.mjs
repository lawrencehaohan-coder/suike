import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const env={...process.env,SUIKE_ESBUILD_MODULE:process.env.SUIKE_ESBUILD_MODULE||path.join(root,'node_modules/esbuild'),HARMONY_TYPESCRIPT:process.env.HARMONY_TYPESCRIPT||path.join(root,'node_modules/typescript'),SUIKE_TYPESCRIPT:process.env.SUIKE_TYPESCRIPT||path.join(root,'node_modules/typescript')};
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()&&!['vendor','node_modules','build'].includes(e.name)?walk(path.join(dir,e.name)):e.isFile()&&(e.name.endsWith('.test.cjs')||e.name.startsWith('test-')&&e.name.endsWith('.cjs'))?[path.join(dir,e.name)]:[]);}
const a=path.join(root,'android/work/android-app'),p=path.join(root,'android/work/portal-import');
const batches=[walk(a),['android/work/timetable/tests/model.test.js',...['safe-merge.test.cjs','teaching-parser.test.cjs','portal-parser.test.cjs'].map(f=>'android/work/portal-import/'+f)].map(f=>path.join(root,f)),walk(path.join(root,'harmony/tests'))];
for(const files of batches){const result=spawnSync(process.execPath,['--test',...files],{cwd:root,env,stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
