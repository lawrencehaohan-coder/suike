/* Fixed DOM-only HHU trial collector. Run only after a user's Read action. */
(function collectJsxsd(profile){
  'use strict';
  const SOURCE=profile.captureSource,VERSION=profile.adapterVersion;
  function stop(code){const e=new Error();e.collectorCode=code;throw e;}
  function text(element,max,required){if(!element)stop('COURSE_FIELDS_INVALID');const raw=element.textContent;if(typeof raw!=='string'||raw.length>max*4||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw))stop('COURSE_FIELDS_INVALID');const value=raw.replace(/\s+/g,' ').trim();if(value.length>max||required&&!value)stop('COURSE_FIELDS_INVALID');return value;}
  try{
    const path=location.pathname;
    const supported=location.protocol==='https:'&&(!location.port||location.port==='443')&&profile.capturePages.some(page=>location.hostname===page.host&&(!page.webVpn?path===page.path:path.startsWith('/http/')&&path.endsWith(page.path)&&path.length>6+page.path.length&&/^[A-Za-z0-9_-]{1,256}$/.test(path.slice(6,-page.path.length))));
    if(!supported)stop('UNSUPPORTED_PAGE');
    const table=document.querySelector(profile.collectorLayout==='hhu-groups'?'#timetable':'#kbtable');if(!table||!table.rows)stop('TABLE_MISSING');
    const termText=text(document.querySelector('#xnxq01id option:checked')||document.querySelector('select[name="xnxq01id"] option:checked'),40,true),term=/^(\d{4}-\d{4})-([123])$/.exec(termText);if(!term)stop('TERM_INVALID');
    const weekOption=document.querySelector('#zc option:checked');if(profile.collectorLayout==='hhu-groups'&&!weekOption)stop('WEEK_FILTER_ACTIVE');if(weekOption&&!/全部|全学期/.test(text(weekOption,30,true)))stop('WEEK_FILTER_ACTIVE');
    if(table.rows.length<2||table.rows.length>20)stop('TABLE_INVALID');
    const days=['星期一','星期二','星期三','星期四','星期五','星期六','星期日'];let header=-1;
    for(let r=0;r<table.rows.length;r++){const cells=table.rows[r].cells;if(cells.length===8&&days.every((day,i)=>text(cells[i+1],20,true).startsWith(day))){header=r;break;}}
    if(header<0)stop('DAY_HEADERS_INVALID');
    const periodGroups=[],paragraphs=table.rows[0].querySelectorAll('p');
    paragraphs.forEach(p=>{const raw=text(p,2000,true),re=/第[一二三四五六七八九十\d]+大节\s*[（(]\s*(\d{1,2})\s*[-–—]\s*(\d{1,2})\s*小节\s*((?:[01]\d|2[0-3]):[0-5]\d)\s*[-–—]\s*((?:[01]\d|2[0-3]):[0-5]\d)\s*[)）]/g;let m;while((m=re.exec(raw)))periodGroups.push({group:periodGroups.length+1,first:Number(m[1]),last:Number(m[2]),start:m[3],end:m[4]});});
    if(profile.collectorLayout==='hhu-groups'&&(periodGroups.length<2||periodGroups.length>12))stop('PERIOD_HEADERS_INVALID');
    if(profile.collectorLayout!=='hhu-groups')periodGroups.length=0;
    const rows=[],seen=new Set();
    function collect(block,cell){
      let current={name:'',teacher:'',weekText:'',room:'',building:''};
      function flush(){
        if(!current.weekText)return;
        if(!current.name||current.name.length>80||current.teacher.length>120)stop('COURSE_FIELDS_INVALID');
        const room=current.building&&!current.room.includes(current.building)?(current.building+' '+current.room).trim():current.room;
        const row={cell,name:current.name,weekText:current.weekText,teacher:current.teacher,room};if(room.length>120)stop('COURSE_FIELDS_INVALID');
        const key=JSON.stringify(row);if(!seen.has(key)){seen.add(key);rows.push(row);if(rows.length>500)stop('TOO_MANY_COURSES');}
      }
      function next(keepName){const name=keepName?current.name:'',teacher=keepName?current.teacher:'';current={name,teacher,weekText:'',room:'',building:''};}
      function walk(element){
        if(element.nodeType===3){const value=text(element,80,false);if(!value||/^[-—_]+$/.test(value))return;if(current.weekText){flush();next(false);}current.name=(current.name+' '+value).trim();return;}
        if(element.nodeType!==1)return;
        if(element.tagName==='FONT'){
          const title=element.getAttribute('title');
          // Do not read class/identity, notification IDs, groups, comments or inputs.
          if(!['教师','老师','周次(节次)','教学楼','教室'].includes(title))return;
          const value=text(element,title==='周次(节次)'?200:120,false);
          if(title==='教师'||title==='老师'){if(current.weekText){flush();next(true);}current.teacher=value;}
          else if(title==='周次(节次)'){if(!/\[[\d\s,，、-]+节\]/.test(value))return;if(current.weekText){flush();next(true);}current.weekText=value;}
          else if(title==='教学楼')current.building=value;else current.room=value;
          return;
        }
        if(['DIV','SPAN','B','STRONG','A'].includes(element.tagName))Array.from(element.childNodes).forEach(walk);
      }
      Array.from(block.childNodes).forEach(walk);flush();
    }
    const gridGroups=periodGroups.length?periodGroups:Array.from(table.rows).slice(header+1).filter(row=>row.cells.length===8).map((row,index)=>({group:index+1}));
    if(!gridGroups.length||gridGroups.length>12)stop('TABLE_INVALID');
    gridGroups.forEach((group,index)=>{
      const row=table.rows[header+index+1];if(!row||row.cells.length!==8)stop('TABLE_INVALID');
      for(let day=1;day<=7;day++){
        const blocks=row.cells[day].querySelectorAll('div.kbcontent');
        blocks.forEach(block=>{const full=Array.from(block.querySelectorAll('font')).some(font=>font.getAttribute('title')==='周次(节次)'&&/\[[\d\s,，、-]+节\]/.test(text(font,200,false)));if(full)collect(block,day+'-'+group.group);});
      }
    });
    if(!rows.length)stop('NO_COURSES');
    const result=JSON.stringify({source:SOURCE,adapterVersion:VERSION,term:{year:term[1],semester:term[2]},rows,periodGroups,unscheduledPresent:false});if(result.length>512*1024)stop('CAPTURE_TOO_LARGE');return result;
  }catch(error){const allowed=['UNSUPPORTED_PAGE','TABLE_MISSING','TABLE_INVALID','TERM_INVALID','WEEK_FILTER_ACTIVE','DAY_HEADERS_INVALID','PERIOD_HEADERS_INVALID','COURSE_FIELDS_INVALID','TOO_MANY_COURSES','NO_COURSES','CAPTURE_TOO_LARGE'];return JSON.stringify({source:SOURCE,adapterVersion:VERSION,error:allowed.includes(error.collectorCode)?error.collectorCode:'COLLECTOR_FAILED'});}
})
