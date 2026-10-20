const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const A=require('../school-adapters.js'),F=require('./fixtures.cjs');
const privateText='PRIVATE_ID_PASSWORD_COOKIE_TOKEN';
function text(value){return {nodeType:3,get textContent(){return value;}};}
function element(tag,children=[],attrs={}){
  const el={nodeType:1,tagName:tag.toUpperCase(),childNodes:children,getAttribute:key=>attrs[key]||null,
    get textContent(){return children.map(n=>n.textContent).join('');},
    querySelectorAll(selector){return children.flatMap(child=>child.nodeType===1?[...(selector==='font'&&child.tagName==='FONT'||selector==='p'&&child.tagName==='P'||selector==='div.kbcontent'&&child.tagName==='DIV'&&child.getAttribute('class')==='kbcontent'?[child]:[]),...child.querySelectorAll(selector)]:[]);}};
  return el;
}
function dom(school){
  const profile=A.get(school),capture=school==='hhu'?F.hhu():F.njust(),reads=[];
  const rows=[];
  if(school==='hhu'){const clockRow=element('tr',capture.periodGroups.map(g=>element('p',[text('第一大节（'+g.first+'-'+g.last+'小节 '+g.start+'-'+g.end+'）')])));clockRow.cells=[];rows.push(clockRow);}
  const head=element('tr');head.cells=[element('th',[text('节次')]),...['星期一','星期二','星期三','星期四','星期五','星期六','星期日'].map(s=>element('th',[text(s)]))];rows.push(head);
  const blocks=[];
  for(let group=1;group<=5;group++){
    const row=element('tr');row.cells=[element('th',[text('第'+group+'大节')])];
    for(let day=1;day<=7;day++){
      const children=[];
      capture.rows.filter(c=>c.cell===day+'-'+group).forEach(c=>{
        const hidden=element('font',[],{title:'备注'});Object.defineProperty(hidden,'textContent',{get(){throw Error(privateText);}});
        const input=element('input');Object.defineProperty(input,'textContent',{get(){throw Error(privateText);}});
        const block=element('div',[text(c.name),element('br'),element('font',[text(c.teacher)],{title:school==='hhu'?'教师':'老师'}),element('br'),element('font',[text(c.weekText)],{title:'周次(节次)'}),element('font',[text(c.room)],{title:'教室'}),hidden,input],{class:'kbcontent'});
        blocks.push(block);children.push(block);
      });
      row.cells.push(element('td',children));
    }
    rows.push(row);
  }
  const table=element('table');table.rows=rows;
  const document={querySelector(selector){reads.push(selector);if(selector===(school==='hhu'?'#timetable':'#kbtable'))return table;if(selector==='#xnxq01id option:checked')return element('option',[text('2026-2027-1')]);if(selector==='#zc option:checked')return element('option',[text('全部')]);throw Error(privateText);}};
  for(const key of ['cookie','forms'])Object.defineProperty(document,key,{get(){throw Error(privateText);}});
  const context={document,location:{protocol:'https:',hostname:school==='hhu'?'jwxt.hhu.edu.cn':'webvpn.njust.edu.cn',port:'',pathname:school==='hhu'?'/jsxsd/xskb/xskb_list.do':'/http/synthetic_vpn_map/njlgdx/xskb/xskb_list.do'}};
  for(const key of ['localStorage','sessionStorage','fetch','XMLHttpRequest'])Object.defineProperty(context,key,{get(){throw Error(privateText);}});
  return {profile,capture,table,blocks,context,reads};
}
function collect(d){const code=fs.readFileSync(path.join(__dirname,'../../android-app/assets',d.profile.collectorAsset),'utf8');return JSON.parse(vm.runInNewContext(code,d.context,{timeout:1000}));}
test('bundled HHU collector reads only course fields and the displayed term/clocks, never private fields',()=>{
  const d=dom('hhu'),out=collect(d);assert.deepEqual(out,d.capture);assert.equal(JSON.stringify(out).includes(privateText),false);
  assert.deepEqual(d.reads,['#timetable','#xnxq01id option:checked','#zc option:checked']);
});
test('bundled NJUST collector uses kbtable and 老师 while leaving missing clocks absent',()=>{
  const d=dom('njust'),out=collect(d);assert.deepEqual(out,d.capture);assert.deepEqual(out.periodGroups,[]);assert.equal(out.rows[0].teacher,'测试教师甲');
});
test('wrong school, scheme, port, login path and malformed VPN mapping return bounded errors only',()=>{
  for(const school of ['hhu','njust'])for(const mutate of [d=>d.context.location.hostname='evil.invalid',d=>d.context.location.protocol='http:',d=>d.context.location.port='8443',d=>d.context.location.pathname='/authserver/login',d=>d.context.location.pathname='/http/../njlgdx/xskb/xskb_list.do']){
    const d=dom(school);mutate(d);const out=collect(d);assert.deepEqual(Object.keys(out),['source','adapterVersion','error']);assert.equal(out.error,'UNSUPPORTED_PAGE');
  }
});
test('a filtered week, missing table or malformed field does not return partial course data',()=>{
  const d=dom('hhu'),before=d.context.document.querySelector;d.context.document.querySelector=s=>s==='#zc option:checked'?element('option',[text('第9周')]):before(s);assert.equal(collect(d).error,'WEEK_FILTER_ACTIVE');
  const e=dom('njust');e.context.document.querySelector=()=>null;assert.equal(collect(e).error,'TABLE_MISSING');
  const f=dom('njust');f.blocks[0].childNodes[0]=text('x'.repeat(81));const out=collect(f);assert.ok(out.error);assert.equal(out.rows,undefined);
});
test('unexpected page exceptions never copy their text into collector errors',()=>{
  const d=dom('njust');d.context.document.querySelector=()=>{throw Error(privateText);};assert.equal(collect(d).error,'COLLECTOR_FAILED');assert.equal(JSON.stringify(collect(d)).includes(privateText),false);
});
