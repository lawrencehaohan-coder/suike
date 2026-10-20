const test=require('node:test'),assert=require('node:assert/strict');
const P=require('./period-times.js');
const periods=()=>[
  ['08:00','08:45'],['08:55','09:40'],['10:00','10:45'],['10:55','11:40'],
  ['14:00','14:45'],['14:55','15:40'],['16:00','16:45'],['16:55','17:40'],['19:00','19:45'],['19:55','20:40']
].map(([start,end])=>({start,end}));
test('partial school times change only explicitly supplied periods and do not mutate input',()=>{
 const before=periods(),raw=JSON.stringify(before),plan=P.preview(before,[{period:1,start:'08:05',end:'08:50'}]);
 assert.equal(JSON.stringify(before),raw);assert.deepEqual(plan.periods[0],{start:'08:05',end:'08:50'});
 assert.deepEqual(plan.periods.slice(1),before.slice(1));assert.equal(plan.changes.length,1);
});
test('unchanged times produce no changes and repeated application is idempotent',()=>{
 const rows=[{period:1,start:'08:05',end:'08:50'}],once=P.preview(periods(),rows);
 assert.deepEqual(P.preview(once.periods,rows).changes,[]);
});
test('invalid clocks, reversed intervals, duplicate numbers and private fields are rejected',()=>{
 for(const row of [{period:1,start:'8:00',end:'08:45'},{period:0,start:'08:00',end:'08:45'},{period:1,start:'25:00',end:'26:00'},{period:1,start:'09:00',end:'08:00'},{period:1,start:'08:00',end:'08:45',studentId:'sentinel'}])assert.throws(()=>P.validateRows([row]));
 assert.throws(()=>P.validateRows([{period:1,start:'08:00',end:'08:45'},{period:1,start:'08:00',end:'08:45'}]));
});
test('edits must not overlap their preceding or following period; touching boundaries are valid',()=>{
 assert.throws(()=>P.preview(periods(),[{period:2,start:'08:30',end:'09:40'}]),e=>e.code==='PERIOD_OVERLAP');
 assert.throws(()=>P.preview(periods(),[{period:1,start:'08:00',end:'09:00'}]),e=>e.code==='PERIOD_OVERLAP');
 assert.doesNotThrow(()=>P.preview(periods(),[{period:1,start:'08:00',end:'08:55'}]));
});
test('time records never invoke accessors or synthesize missing intermediate periods',()=>{
 const row={period:1,start:'08:00',end:'08:45'};Object.defineProperty(row,'start',{enumerable:true,get(){throw new Error('private getter');}});
 assert.throws(()=>P.validateRows([row]),e=>e.code==='PERIOD_FIELDS_INVALID');
 assert.throws(()=>P.preview(periods().slice(0,8),[{period:10,start:'20:00',end:'20:45'}]),e=>e.code==='PERIOD_GAP');
});
test('ordinary night times follow changed slots while separately specified night and pending labs stay intact',()=>{
 const current={periods:periods(),courses:[{id:'routine',start:9,end:10,sourceTime:'19:00-20:40'},{id:'special',start:9,end:10,sourceTime:'18:30-20:05'},{id:'pending',start:null,end:null,timeMode:'pending',timeNote:'时间待确认'}],importLedger:{entries:[]}};
 const nextPeriods=P.preview(current.periods,[{period:9,start:'19:05',end:'19:50'},{period:10,start:'20:00',end:'20:45'}]).periods;
 const before=JSON.stringify(current),next=P.applyToState(current,nextPeriods);
 assert.equal(JSON.stringify(current),before);assert.equal(next.courses[0].sourceTime,'19:05-20:45');assert.equal(next.courses[1].sourceTime,'18:30-20:05');assert.deepEqual(next.courses[2],current.courses[2]);assert.deepEqual(next.importLedger,current.importLedger);
});
