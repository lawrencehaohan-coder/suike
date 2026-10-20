const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./safe-merge.js');
const M = require('../timetable/dist/model.js');
const F = require('./fixtures.cjs').evidenceFixture();
const clone = value => JSON.parse(JSON.stringify(value));
const source = {system:'just-jwglxt',term:'2026-2027-1'};
const original = F.initial.courses.find(c => c.id === 'imported-001');
const firstDate = original.dates[0];
const local = {...clone(original),dates:[firstDate]};
const stateOf = courses => M.validateState({...clone(F.initial),courses:clone(courses)});
function occurrence(c = local, date = c.dates[0], overrides = {}) {
  return {sourceOccurrenceId:'pattern-physics-1',sourceKey:'(2026-2027-1)-DEMO00001-01',week:M.weekNumber(date,F.initial.settings.startMonday),date,
    name:c.name,day:c.day,start:c.start,end:c.end,room:c.room,teacher:c.teacher,sourceTime:c.sourceTime||'',timeMode:c.timeMode||'periods',timeNote:c.timeNote||'',...overrides};
}
function incoming(rows, overrides = {}) {return {source,scope:{from:'2026-08-01',to:'2027-01-31',complete:true},occurrences:rows,...overrides};}
function commit(state,input,ledger,actions,options) {
  const plan=S.planMerge(state,input,ledger,options);
  return S.commitMerge(state,input,ledger,{planToken:plan.planToken,choices:Object.entries(actions||{}).map(([sourceOccurrenceId,action])=>({sourceOccurrenceId,action}))},options);
}
function bound() {return commit(stateOf([local]),incoming([occurrence()]),null);}
function frozen(value) {if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(frozen);}return value;}

test('first exact binding preserves courses, labs, settings and user eight periods without an addition',()=>{
  const state=frozen(clone(F.initial)), input=frozen(incoming([occurrence()]));
  const plan=S.planMerge(state,input,null);
  assert.equal(plan.preview[0].type,'bindExact');
  const result=S.commitMerge(state,input,null,{planToken:plan.planToken,choices:[]});
  assert.deepEqual(result.state,state);
  assert.equal(result.ledger.entries[0].association.courseId,original.id);
  assert.equal(result.state.courses.filter(c=>c.id.startsWith('notice-')).flatMap(c=>c.dates).length,13);
});

test('same source reimport is idempotent and ledger survives a strict JSON round trip',()=>{
  const first=bound(), ledger=S.parseLedger(JSON.stringify(first.ledger));
  const result=commit(first.state,incoming([occurrence()]),ledger);
  assert.deepEqual(result, {...result,state:first.state,ledger:first.ledger});
  assert.equal(result.summary.addedOccurrences,0);
  assert.equal(S.planMerge(result.state,incoming([occurrence()]),result.ledger).preview[0].type,'unchanged');
});

test('local rename, moved period, room, teacher and color edits remain associated and protected',()=>{
  const first=bound();
  const edited=clone(first.state);Object.assign(edited.courses[0],{name:'我的物理课',start:3,end:4,room:'自定教室',teacher:'自定教师',color:'#112233'});
  const plan=S.planMerge(edited,incoming([occurrence()]),first.ledger);
  assert.equal(plan.preview[0].type,'protectedLocal');
  const result=commit(edited,incoming([occurrence()]),first.ledger);
  assert.deepEqual(result.state,edited);assert.equal(result.summary.addedOccurrences,0);
});

test('deleting a bound occurrence persists a tombstone and repeated reads never revive it',()=>{
  const first=bound(), deleted=stateOf([]);
  const result=commit(deleted,incoming([occurrence()]),first.ledger);
  assert.equal(result.state.courses.length,0);assert.equal(result.ledger.entries[0].tombstone,true);
  assert.equal(result.ledger.entries[0].association,null);
  const repeated=commit(deleted,incoming([occurrence()]),S.parseLedger(JSON.stringify(result.ledger)));
  assert.equal(repeated.state.courses.length,0);assert.deepEqual(repeated.ledger,result.ledger);
});

test('moving a bound date preserves the moved local course and tombstones the old occurrence',()=>{
  const first=bound(), moved=clone(first.state);
  moved.courses[0].dates=[M.addDays(firstDate,7)];
  const result=commit(moved,incoming([occurrence()]),first.ledger);
  assert.deepEqual(result.state,moved);assert.equal(result.ledger.entries[0].tombstone,true);
});

test('source-only room/teacher changes require an explicit choice',()=>{
  const first=bound(), input=incoming([occurrence(local,firstDate,{room:'新教室',teacher:'新老师'})]);
  const plan=S.planMerge(first.state,input,first.ledger);
  assert.equal(plan.preview[0].type,'sourceUpdate');
  assert.throws(()=>S.commitMerge(first.state,input,first.ledger,{planToken:plan.planToken,choices:[]}),/CHOICE_REQUIRED/);
  const kept=commit(first.state,input,first.ledger,{'pattern-physics-1':'keepLocal'});
  assert.deepEqual(kept.state,first.state);assert.equal(kept.ledger.entries[0].baseline.room,'新教室');
  assert.equal(S.planMerge(kept.state,input,kept.ledger).preview[0].type,'protectedLocal');
  const accepted=commit(first.state,input,first.ledger,{'pattern-physics-1':'acceptSource'});
  assert.equal(accepted.state.courses[0].room,'新教室');assert.equal(accepted.summary.updatedOccurrences,1);
  const skipped=commit(first.state,input,first.ledger,{'pattern-physics-1':'skip'});
  assert.deepEqual(skipped.state,first.state);assert.deepEqual(skipped.ledger,first.ledger);
  assert.equal(S.planMerge(skipped.state,input,skipped.ledger).preview[0].type,'sourceUpdate');
});

test('one occurrence source update splits a multi-date group and preserves all other dates and mappings',()=>{
  const secondDate=original.dates[1], group={...clone(original),dates:[firstDate,secondDate]};
  const a=occurrence(group,firstDate), b=occurrence(group,secondDate,{sourceOccurrenceId:'pattern-physics-2'});
  const first=commit(stateOf([group]),incoming([a,b]),null);
  const updated={...a,room:'只改这一次'};
  const result=commit(first.state,incoming([updated,b]),first.ledger,{'pattern-physics-1':'acceptSource'});
  assert.equal(result.state.courses.length,2);
  const untouched=result.state.courses.find(c=>c.id===original.id);
  assert.deepEqual(untouched.dates,[secondDate]);assert.equal(untouched.room,original.room);
  const split=result.state.courses.find(c=>c.id!==original.id);
  assert.deepEqual(split.dates,[firstDate]);assert.equal(split.room,'只改这一次');
  assert.equal(result.ledger.entries.find(e=>e.sourceOccurrenceId===b.sourceOccurrenceId).association.courseId,original.id);
  assert.equal(S.planMerge(result.state,incoming([updated,b]),result.ledger).stats.unchanged,2);
});

test('both local and source edits conflict; accepting source is forbidden',()=>{
  const first=bound(), edited=clone(first.state);edited.courses[0].room='用户教室';
  const input=incoming([occurrence(local,firstDate,{room:'学校教室'})]), plan=S.planMerge(edited,input,first.ledger);
  assert.equal(plan.preview[0].reason,'LOCAL_AND_SOURCE_CHANGED');
  assert.throws(()=>commit(edited,input,first.ledger,{'pattern-physics-1':'acceptSource'}),/CHOICE_NOT_ALLOWED/);
  const result=commit(edited,input,first.ledger,{'pattern-physics-1':'keepLocal'});
  assert.equal(result.state.courses[0].room,'用户教室');
});

test('derived pattern key changing in the same teaching class and week is not a new course',()=>{
  const first=bound(), changed=occurrence(local,firstDate,{sourceOccurrenceId:'derived-changed',start:3,end:4});
  const input=incoming([changed]), plan=S.planMerge(first.state,input,first.ledger);
  assert.equal(plan.preview[0].reason,'RELATED_PATTERN_CHANGED');
  assert.deepEqual(plan.preview[0].relatedSourceIds,['pattern-physics-1']);
  assert.throws(()=>commit(first.state,input,first.ledger,{'derived-changed':'add'}),/CHOICE_NOT_ALLOWED/);
  const result=commit(first.state,input,first.ledger,{'derived-changed':'skip'});
  assert.deepEqual(result.state,first.state);assert.deepEqual(result.ledger,first.ledger);
});

test('same pattern key reused for a different source class or week cannot acknowledge a new baseline',()=>{
  const first=bound(), row=occurrence(local,firstDate,{sourceKey:'OTHER-CLASS'}), input=incoming([row]);
  assert.equal(S.planMerge(first.state,input,first.ledger).preview[0].reason,'SOURCE_KEY_REUSED');
  const result=commit(first.state,input,first.ledger,{'pattern-physics-1':'skip'});
  assert.deepEqual(result.ledger,first.ledger);
});

test('unmatched additions exist only in preview until explicitly selected; cancel and skip do not add',()=>{
  const state=stateOf([]), input=incoming([occurrence()]), before=clone(state), plan=S.planMerge(state,input,null);
  assert.equal(plan.preview[0].type,'addition');assert.deepEqual(state,before);
  assert.throws(()=>S.validateLedger(plan.proposedLedger),/UNKNOWN_FIELD/);
  assert.equal(commit(state,input,null,{'pattern-physics-1':'skip'}).state.courses.length,0);
  const added=commit(state,input,null,{'pattern-physics-1':'add'});
  assert.equal(added.state.courses.length,1);assert.match(added.state.courses[0].id,/^just-occ-/);
  assert.equal(commit(added.state,input,added.ledger).state.courses.length,1);
});

test('first import with a fuzzy local match or two exact local matches cannot guess a binding/addition',()=>{
  const edited={...local,name:'用户改名'}, input=incoming([occurrence()]);
  const fuzzy=S.planMerge(stateOf([edited]),input,null);
  assert.equal(fuzzy.preview[0].reason,'POSSIBLE_EXISTING_LOCAL_COURSE');
  assert.deepEqual(fuzzy.preview[0].allowedActions,['skip']);
  const duplicate=S.planMerge(stateOf([local,{...local,id:'other-local'}]),input,null);
  assert.equal(duplicate.preview[0].reason,'AMBIGUOUS_OR_ALREADY_BOUND_EXACT_MATCH');
});

test('trusted original source baseline preserves edits and deletions in the first upgrade',()=>{
  const options={trustedLegacyBaseline:stateOf([local])}, input=incoming([occurrence()]);
  const edited=stateOf([{...local,name:'改名后的物理',start:3,end:4}]);
  assert.equal(S.planMerge(edited,input,null,options).preview[0].type,'protectedLocal');
  const kept=commit(edited,input,null,{},options);assert.deepEqual(kept.state,edited);
  const deleted=commit(stateOf([]),input,null,{},options);
  assert.equal(deleted.state.courses.length,0);assert.equal(deleted.ledger.entries[0].tombstone,true);
});

test('legacy association is never guessed when two source classes match the same old course',()=>{
  const options={trustedLegacyBaseline:stateOf([local])}, edited=stateOf([{...local,name:'改过名'}]);
  const input=incoming([occurrence(),occurrence(local,firstDate,{sourceOccurrenceId:'other-pattern',sourceKey:'OTHER-CLASS'})]);
  const plan=S.planMerge(edited,input,null,options);
  assert.ok(plan.preview.every(p=>p.type==='conflict'));
  assert.equal(plan.proposedLedger.entries.length,0);
  const unedited=S.planMerge(stateOf([local]),input,null,options);
  assert.ok(unedited.preview.every(p=>p.type==='conflict'));assert.equal(unedited.proposedLedger.entries.length,0);
});

test('two different source identities for one identical new occurrence are both conflicts',()=>{
  const input=incoming([occurrence(),occurrence(local,firstDate,{sourceOccurrenceId:'other-identity',sourceKey:'OTHER-CLASS'})]);
  const plan=S.planMerge(stateOf([]),input,null);
  assert.ok(plan.preview.every(p=>p.reason==='AMBIGUOUS_SOURCE_OR_LEGACY_IDENTITY'));
  assert.equal(plan.stats.additions,0);
});

test('additional weeks of a known teaching class are preview additions after a partial read',()=>{
  const first=bound(), laterDate=M.addDays(firstDate,7), later=occurrence(local,laterDate,{sourceOccurrenceId:'new-week',week:2});
  const input=incoming([occurrence(),later]);
  assert.equal(S.planMerge(first.state,input,first.ledger).preview.find(p=>p.sourceOccurrenceId==='new-week').type,'addition');
  const result=commit(first.state,input,first.ledger,{'new-week':'add'});
  assert.equal(result.ledger.entries.length,2);assert.equal(result.summary.addedOccurrences,1);
  assert.equal(S.planMerge(result.state,input,result.ledger).stats.unchanged,2);
});

test('new occurrences with identical metadata group by source class while each date gets its own ledger association',()=>{
  const laterDate=M.addDays(firstDate,7), input=incoming([occurrence(),occurrence(local,laterDate,{sourceOccurrenceId:'new-week',week:2})]);
  const result=commit(stateOf([]),input,null,{'pattern-physics-1':'add','new-week':'add'});
  assert.equal(result.state.courses.length,1);assert.deepEqual(result.state.courses[0].dates,[firstDate,laterDate]);
  assert.equal(result.ledger.entries[0].association.courseId,result.ledger.entries[1].association.courseId);
  assert.equal(result.summary.addedOccurrences,2);
});

test('partial, rejected, invalid and empty source reads cannot remove unseen local courses',()=>{
  const first=bound(), state=stateOf([...first.state.courses,{...local,id:'manual-extra',name:'实验安排'}]);
  for(const input of [incoming([]),incoming([],{scope:{from:'2026-08-01',to:'2027-01-31',complete:false}}),incoming([{...occurrence(),sourceOccurrenceId:''}])]) {
    const plan=S.planMerge(state,input,first.ledger);
    assert.equal(plan.canCommit,false);assert.deepEqual(state.courses.map(c=>c.id),[original.id,'manual-extra']);
    assert.throws(()=>S.commitMerge(state,input,first.ledger,{planToken:plan.planToken,choices:[]}),/NO_VALID_OCCURRENCES/);
  }
  const partial=incoming([occurrence()],{rejectedCount:3});
  const plan=S.planMerge(state,partial,first.ledger);assert.equal(plan.scope.complete,false);assert.equal(plan.stats.invalidOccurrences,3);
  assert.deepEqual(commit(state,partial,first.ledger).state,state);
});

test('duplicate source ID variants reject every variant rather than selecting DOM order',()=>{
  const input=incoming([occurrence(),occurrence(local,firstDate,{room:'冲突教室'})]);
  const a=S.planMerge(stateOf([]),input,null), b=S.planMerge(stateOf([]),incoming([...input.occurrences].reverse()),null);
  assert.equal(a.canCommit,false);assert.equal(a.invalid[0].reason,'SOURCE_ID_VARIANTS');assert.equal(b.canCommit,false);
  const identical=S.planMerge(stateOf([]),incoming([occurrence(),occurrence()]),null);assert.equal(identical.stats.duplicateRows,1);assert.equal(identical.stats.validOccurrences,1);
});

test('stale preview cannot overwrite a new local edit, addition, settings or ledger change',()=>{
  const state=stateOf([]), input=incoming([occurrence()]), plan=S.planMerge(state,input,null);
  const changed=stateOf([{...local,name:'刚刚加入的课程'}]);
  const decision={planToken:plan.planToken,choices:[{sourceOccurrenceId:'pattern-physics-1',action:'add'}]};
  assert.throws(()=>S.commitMerge(changed,input,null,decision),/PLAN_STALE/);
  const settings=clone(state);settings.settings.theme='dark';assert.throws(()=>S.commitMerge(settings,input,null,decision),/PLAN_STALE/);
});

test('strict ledger rejects unknown JSON fields, duplicate identities/associations, bad dates and malformed tombstones',()=>{
  const ledger=bound().ledger;
  assert.deepEqual(S.parseLedger(JSON.stringify(ledger)),ledger);
  for(const mutate of [l=>l.extra=true,l=>l.entries.push(clone(l.entries[0])),l=>l.entries.push({...clone(l.entries[0]),sourceOccurrenceId:'other'}),l=>l.entries[0].baseline.date='2026-02-30',l=>l.entries[0].tombstone=true,l=>l.entries[0].week=0,l=>l.entries[0].baseline.room=123]) {
    const value=clone(ledger);mutate(value);assert.throws(()=>S.validateLedger(value));
  }
  assert.throws(()=>S.parseLedger('{"__proto__":{}}'));
  assert.throws(()=>S.parseLedger('bad-json'),/LEDGER_JSON_INVALID/);
  assert.throws(()=>S.planMerge(bound().state,incoming([occurrence()],{source:{system:'just-jwglxt',term:'OTHER'}}),ledger),/LEDGER_SOURCE_MISMATCH/);
  assert.equal(S.validateLedger(undefined),null);assert.equal(S.validateLedger(null),null);assert.equal(S.parseLedger('null'),null);
  const sparse=clone(ledger);sparse.entries=new Array(1);assert.throws(()=>S.validateLedger(sparse),/SPARSE_ARRAY_INVALID/);
});

test('baseFingerprint decision alias still rechecks the latest state',()=>{
  const state=stateOf([]), input=incoming([occurrence()]), plan=S.planMerge(state,input,null);
  assert.equal(plan.baseFingerprint,plan.planToken);
  const result=S.commitMerge(state,input,null,{baseFingerprint:plan.baseFingerprint,choices:[{sourceOccurrenceId:'pattern-physics-1',action:'add'}]});
  assert.equal(result.state.courses.length,1);
  assert.throws(()=>S.commitMerge(state,input,null,{baseFingerprint:plan.baseFingerprint,planToken:'different',choices:[]}),/PLAN_STALE/);
});

test('unknown new source schedule changes retain local data and skip retains the original comparison baseline',()=>{
  const first=bound(), input=incoming([occurrence(local,firstDate,{start:3,end:4})]);
  const plan=S.planMerge(first.state,input,first.ledger);assert.equal(plan.preview[0].reason,'SOURCE_SCHEDULE_CHANGED');
  const skipped=commit(first.state,input,first.ledger,{'pattern-physics-1':'skip'});
  assert.deepEqual(skipped.state,first.state);assert.deepEqual(skipped.ledger,first.ledger);
});

test('a deleted legacy occurrence stays deleted even if new source metadata changed on first upgrade',()=>{
  const options={trustedLegacyBaseline:stateOf([local])}, input=incoming([occurrence(local,firstDate,{room:'后来换过的教室'})]);
  const result=commit(stateOf([]),input,null,{},options);
  assert.equal(result.state.courses.length,0);assert.equal(result.ledger.entries[0].tombstone,true);
  assert.equal(S.planMerge(stateOf([]),input,result.ledger,options).preview[0].type,'deletedLocally');
});

test('pending nighttime source arrangements remain pending instead of inventing times or periods',()=>{
  const row=occurrence(local,firstDate,{sourceOccurrenceId:'pending-night',sourceKey:'NIGHT',name:'新夜课',start:null,end:null,sourceTime:'',timeMode:'pending',timeNote:'原网页第9–10节，实际时间待确认'});
  const result=commit(stateOf([]),incoming([row]),null,{'pending-night':'add'});
  assert.equal(result.state.courses[0].timeMode,'pending');assert.equal(result.state.courses[0].start,null);
  assert.match(M.timeRange(result.state.courses[0],result.state.periods).text,/实际时间待确认/);
  const invalid={...row,sourceOccurrenceId:'bad-night',timeMode:'periods',start:9,end:10,timeNote:''};
  assert.equal(S.planMerge(stateOf([]),incoming([invalid]),null).invalid[0].reason,'NIGHT_TIME_REQUIRED');
});

test('all source text stays literal model data and never becomes executable HTML',()=>{
  const row=occurrence(local,firstDate,{name:'<img src=x onerror=alert(1)>',room:'<script>evil()</script>'}), state=stateOf([]), input=incoming([row]);
  const result=commit(state,input,null,{'pattern-physics-1':'add'});
  assert.equal(result.state.courses[0].name,row.name);assert.equal(result.state.courses[0].room,row.room);
});

test('comparison ignores old daytime source clocks and only the observed campus prefix without mutating stored course metadata',()=>{
  const state=stateOf([local]), row=occurrence(local,firstDate,{sourceTime:'',room:'张家港  '+local.room});
  const plan=S.planMerge(state,incoming([row]),null,{trustedLegacyBaseline:state});
  assert.equal(plan.preview[0].type,'unchanged');assert.equal(plan.stats.sourceUpdates,0);assert.equal(plan.stats.conflicts,0);
  const result=commit(state,incoming([row]),null,{}, {trustedLegacyBaseline:state});
  assert.deepEqual(result.state,state);assert.equal(result.state.courses[0].sourceTime,local.sourceTime);
  assert.equal(result.ledger.entries[0].baseline.sourceTime,'');assert.equal(result.ledger.entries[0].baseline.room,local.room);
  const different=occurrence(local,firstDate,{sourceTime:'',room:'张家港 示例教学楼BE-203'});
  assert.equal(S.planMerge(state,incoming([different]),null,{trustedLegacyBaseline:state}).preview[0].type,'sourceUpdate');
});
