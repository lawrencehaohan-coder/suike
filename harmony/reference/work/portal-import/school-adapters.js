/* Bundled adapters only. The catalog is injected from schools.json at build time. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./schools.json'),require('./teaching-parser.js'),require('./adapters/jsxsd/parser.js'));
  else root.SuikeSchoolAdapters=factory(/* SUIKE_SCHOOL_CATALOG */ null,root.TeachingParser,root.SuikeJsxsdParser);
})(typeof globalThis!=='undefined'?globalThis:this,function(catalog,just,jsxsd){
  'use strict';
  function fail(code){const error=new TypeError(code);error.code=code;throw error;}
  const profiles=new Map(catalog.schools.map(profile=>[profile.id,Object.freeze(profile)]));
  const parsers={jwglxt:(capture,settings,periods,references)=>just.normalizeCapture(capture,settings,periods,references),jsxsd:(capture,settings,periods,references,profile)=>jsxsd.normalizeCapture(capture,settings,profile,periods)};
  function get(id){const profile=profiles.get(id);if(!profile)fail('UNKNOWN_SCHOOL');return profile;}
  function accepts(id,capture){const profile=get(id);return !!capture&&capture.source===profile.captureSource&&capture.adapterVersion===profile.adapterVersion;}
  function normalize(id,capture,settings,periods,references){
    const profile=get(id);if(!accepts(id,capture))fail('CAPTURE_SCHOOL_MISMATCH');
    const parser=parsers[profile.protocol];if(!parser)fail('PROTOCOL_UNSUPPORTED');
    const result=parser(capture,settings,periods,references,profile);
    // Both legacy and new protocols use the same safe-merge data contract.
    if(!result||!result.source||result.source.system!==profile.system||result.source.term!==capture.term.year+'-'+capture.term.semester||!result.scope||typeof result.scope.complete!=='boolean'||!Array.isArray(result.occurrences)||result.occurrences.length>10000||!Number.isInteger(result.rejectedCount)||result.rejectedCount<0)fail('NORMALIZED_TIMETABLE_INVALID');
    return result;
  }
  return Object.freeze({defaultSchool:catalog.defaultSchool,list:()=>Array.from(profiles.values()),get,accepts,normalize});
});
