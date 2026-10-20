/* Synchronous native checkpoint is authoritative; WebView storage remains a compatibility mirror. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SuikeWorkspaceStorage=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const KEYS=['suike.timetable.v1','suike.history.v1','suike.semesters.v1','suike.workspace.transaction.v1'];
  function fail(code){const error=new Error(code==='CHECKPOINT_INVALID'?'本地持久化记录无法读取，请保留数据后检查备份':'保存结果未能确认，请重新打开应用后检查课表');error.code=code;throw error;}
  function validate(value){
    if(!value||value.version!==1||!value.values||Array.isArray(value.values)||Object.keys(value).sort().join('|')!=='values|version'||Object.keys(value.values).sort().join('|')!==KEYS.slice().sort().join('|'))fail('CHECKPOINT_INVALID');
    KEYS.forEach(key=>{if(value.values[key]!==null&&typeof value.values[key]!=='string')fail('CHECKPOINT_INVALID');});
    return value.values;
  }
  function createStorage(mirror,native){
    const durable=!!(native&&typeof native.getWorkspaceCheckpoint==='function'&&typeof native.persistWorkspaceCheckpoint==='function');
    if(!durable)return mirror;
    let values, blocked=false;
    // Android's Java bridge maps a Java String null to JS undefined; use an explicit JSON null token.
    const response=native.getWorkspaceCheckpoint(), saved=response==='null'?null:response;
    let persisted=saved!==null;
    if(saved===null){values={};KEYS.forEach(key=>{const v=mirror.getItem(key);values[key]=v===undefined?null:v;});}
    else{try{values=validate(JSON.parse(saved));}catch(_){fail('CHECKPOINT_INVALID');}}
    function keyCheck(key){if(!KEYS.includes(key))fail('CHECKPOINT_KEY_INVALID');}
    function mirrorWrite(key,value){try{if(value===null)mirror.removeItem(key);else mirror.setItem(key,value);}catch(_){/* Native checkpoint already committed. */}}
    function write(key,value){
      keyCheck(key);if(blocked)fail('CHECKPOINT_WRITE_FAILED');if(persisted&&values[key]===value)return;
      const next=Object.assign({},values);next[key]=value;
      try{if(native.persistWorkspaceCheckpoint(JSON.stringify({version:1,values:next}))!==true)throw new Error('CHECKPOINT_WRITE_FAILED');}
      catch(_){blocked=true;fail('CHECKPOINT_WRITE_FAILED');}
      values=next;persisted=true;mirrorWrite(key,value);
    }
    return {durable:true,hydrateMirror:()=>KEYS.forEach(key=>mirrorWrite(key,values[key])),getItem:key=>{keyCheck(key);return values[key];},setItem:(key,value)=>write(key,String(value)),removeItem:key=>write(key,null)};
  }
  return {KEYS,createStorage,validate};
});
