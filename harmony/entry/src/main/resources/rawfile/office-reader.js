/* Office structure for the local ArkWeb only. Nothing is inserted in the editor. */
(function(root){
  'use strict';
  const MAX_XML=4*1024*1024, MAX_TOTAL=16*1024*1024, MAX_TEXT=120000;
  function error(message){throw new Error(message);}
  function elements(node,name){return Array.from(node.getElementsByTagNameNS('*',name));}
  function children(node,name){return Array.from(node.children||[]).filter(e=>e.localName===name);}
  function attr(node,name){if(!node)return '';const a=Array.from(node.attributes).find(a=>a.localName===name);return a?a.value:'';}
  function xml(zip,path,optional){
    const bytes=zip[path];if(!bytes){if(optional)return null;error('文档结构不完整，请另存为 PDF 后添加。');}
    if(bytes.length>MAX_XML)error('文档内容较多，请拆分后添加。');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    if(/<!DOCTYPE|<!ENTITY/i.test(text))error('文档包含不支持的 XML 内容。');
    const document=new DOMParser().parseFromString(text,'application/xml');
    if(document.getElementsByTagName('parsererror').length)error('文档结构无法读取。');return document;
  }
  function checkedZip(data){
    if(data.length>24*1024*1024)error('文件超过 24 MB，请拆分后添加。');
    let size=0,count=0;
    return root.fflate.unzipSync(data,{filter(entry){
      if(++count>2000)error('文档内容过多，请拆分后添加。');
      if(entry.name.includes('..')||entry.name.startsWith('/')||entry.name.includes('\\'))error('文档路径无效。');
      const selected=/^(word|xl)\/.*\.(xml|rels)$/.test(entry.name)||/^(word|xl)\/media\/.*\.(png|jpe?g|webp)$/.test(entry.name);
      if(!selected)return false;
      size+=entry.originalSize;
      if(!Number.isFinite(size)||entry.originalSize>MAX_XML||size>MAX_TOTAL)error('文档内容较多，请拆分后添加。');return true;
    }});
  }
  function spreadsheet(zip){
    const workbook=xml(zip,'xl/workbook.xml'), rels=xml(zip,'xl/_rels/workbook.xml.rels'), shared=xml(zip,'xl/sharedStrings.xml',true), styles=xml(zip,'xl/styles.xml',true);
    const strings=shared?elements(shared,'si').map(n=>elements(n,'t').map(t=>t.textContent).join('')):[];
    const custom=new Map();if(styles)elements(styles,'numFmt').forEach(n=>custom.set(attr(n,'numFmtId'),attr(n,'formatCode')));
    const xfs=styles?elements(styles,'cellXfs').flatMap(n=>children(n,'xf')).map(n=>attr(n,'numFmtId')):[];
    const date1904=elements(workbook,'workbookPr').some(n=>['1','true'].includes(attr(n,'date1904')));
    function formatted(raw,index){
      const id=xfs[index],n=Number(id),f=(custom.get(id)||(n>=14&&n<=17?'yyyy-mm-dd':n>=18&&n<=21||n>=45&&n<=47?'hh:mm':n===22?'yyyy-mm-dd hh:mm':'')).replace(/"[^"]*"|\[[^\]]*\]/g,'').toLowerCase();
      if(!/[ydhs]/.test(f)||!Number.isFinite(Number(raw)))return raw;
      const serial=Number(raw);if(serial<0||serial>110000)return raw;
      const day=new Date(Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:30)+Math.floor(serial)*86400000).toISOString().slice(0,10);
      const mins=Math.round((serial-Math.floor(serial))*1440)%1440, clock=String(Math.floor(mins/60)).padStart(2,'0')+':'+String(mins%60).padStart(2,'0');
      return /[yd]/.test(f)?day+(/[hs]/.test(f)?' '+clock:''):clock;
    }
    const relation=new Map(elements(rels,'Relationship').map(n=>[attr(n,'Id'),attr(n,'Target')]));
    return {type:'excel',date1904,sheets:elements(workbook,'sheet').map(sheet=>{
      let target=relation.get(attr(sheet,'id'));if(!target||target.includes('..')||/^https?:/i.test(target))error('工作表关系无效。');
      const path=target.startsWith('/')?target.slice(1):'xl/'+target, doc=xml(zip,path);
      const rows=elements(doc,'row').map(row=>({row:Number(attr(row,'r')),cells:children(row,'c').map(c=>{
        const type=attr(c,'t'),values=elements(c,'v'),raw=values.length?values[0].textContent:'', inline=elements(c,'is');
        const text=type==='s'?strings[Number(raw)]:type==='inlineStr'?inline.flatMap(n=>elements(n,'t')).map(n=>n.textContent).join(''):type==='b'?(raw==='1'?'TRUE':'FALSE'):formatted(raw,Number(attr(c,'s')||0));
        if(text===undefined)error('工作表文本索引无效。');
        const formula=elements(c,'f');return {ref:attr(c,'r'),text,raw,formula:formula.length?formula[0].textContent:''};
      })}));
      return {name:attr(sheet,'name'),rows,mergedCells:elements(doc,'mergeCell').map(n=>attr(n,'ref'))};
    })};
  }
  function word(zip){
    const doc=xml(zip,'word/document.xml'),body=elements(doc,'body')[0];
    function blocks(parent,depth){
      if(depth>8)error('表格嵌套过多，请导出 PDF 后添加。');
      return Array.from(parent.children).flatMap(n=>{
        if(n.localName==='p')return [{type:'paragraph',text:elements(n,'t').map(t=>t.textContent).join(''),images:elements(n,'blip').map(b=>attr(b,'embed'))}];
        if(n.localName==='tbl')return [{type:'table',rows:children(n,'tr').map(tr=>children(tr,'tc').map(tc=>{
          const span=elements(tc,'gridSpan')[0],merge=elements(tc,'vMerge')[0];
          return {span:span?Number(attr(span,'val')||1):1,verticalMerge:merge?(attr(merge,'val')||'continue'):'',blocks:blocks(tc,depth+1)};
        }))}];return [];
      });
    }
    if(!body)error('Word 文档没有正文。');return {type:'word',blocks:blocks(body,0)};
  }
  function base64(bytes){let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));return btoa(result);}
  function read(data,name){
    const zip=checkedZip(data),document=zip['xl/workbook.xml']?spreadsheet(zip):zip['word/document.xml']?word(zip):error('请使用 .xlsx 或 .docx；旧格式可另存为 PDF。');
    document.filename=name;const json=JSON.stringify(document);
    if(json.length>MAX_TEXT)error('课程表内容较多，请拆分工作表后添加。');
    const parts=[{type:'text',text:json}];
    const images=Object.keys(zip).filter(n=>/^(word|xl)\/media\//.test(n));
    if(images.length>12)error('文档图片较多，请拆分后添加。');
    images.forEach(path=>{const ext=path.split('.').pop().toLowerCase(),mime=ext==='jpg'?'jpeg':ext;parts.push({type:'text',text:'文档内图片：'+path},{type:'image_url',image_url:{url:'data:image/'+mime+';base64,'+base64(zip[path])}});});
    return parts;
  }
  function receive(id,name,encoded){
    try {
      const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),parts=read(bytes,name);
      if(!root.SuikeNative.storeDeepSeekDocument(id,JSON.stringify(parts)))error('附件未能保存，请重新添加。');
      root.SuikeDeepSeek.receiveDocument(id,{name,attachmentId:id,error:'none'});
    }catch(e){root.SuikeDeepSeek.receiveDocument(id,{name,error:e.message||'附件读取失败。'});}
  }
  root.SuikeOffice={read,receive};
  if(typeof module==='object'&&module.exports)module.exports={read,checkedZip,spreadsheet,word};
})(typeof window==='object'?window:globalThis);
