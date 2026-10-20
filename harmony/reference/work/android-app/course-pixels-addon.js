  (function installCoursePixels(){
    const PixelObserver=window.MutationObserver||function(){this.observe=function(){};};
    const Core=window.SuikeCoursePixels,frames=/* SUIKE_PIXEL_FRAMES */null;
    const oldDetail=openDetail,oldRender=render;let progressCourse=null,lastProgress='',pulseTimer=0;
    const textCount=(p,e,hasPeriods)=>hasPeriods?(p+' 节'+(e?' + '+e+' 次':'')):e+' 次';
    function progress(){
      const dialog=$('courseDialog');if(!dialog.open||!progressCourse)return;
      const value=Core.summarize(state,progressCourse,Date.now());if(!value)return;
      const signature=JSON.stringify([progressCourse,value]);if(signature===lastProgress)return;lastProgress=signature;
      let section=$('courseTermProgress');if(!section){section=node('section','course-term-progress');section.id='courseTermProgress';section.setAttribute('aria-label','本学期课程进度');const sub=$('courseDetail').querySelector('.detail-subtitle');if(sub)sub.after(section);else $('courseDetail').prepend(section);}
      const head=node('div','course-term-head'),count=node('strong','course-term-count',textCount(value.remainingPeriods,value.remainingEvents,value.totalPeriods>0));head.append(node('span','','本学期剩余'),count);
      const complete=textCount(value.donePeriods,value.doneEvents,value.totalPeriods>0),total=textCount(value.totalPeriods,value.totalEvents,value.totalPeriods>0);
      const note=node('p','course-term-meta','已上 '+complete+' · 共 '+total+(value.current?(value.totalPeriods?' · 正在上课':' · 进行中'):''));
      const matrix=node('div','course-term-matrix'),packed=Core.pixels(value.units);matrix.setAttribute('role','img');matrix.setAttribute('aria-label',note.textContent+'；剩余 '+count.textContent);
      for(const item of packed.items){const dot=node('i','course-term-dot is-'+item.state+(item.event?' is-event':''));dot.setAttribute('aria-hidden','true');const unit=item.units[0];dot.title=unit.date+' '+(unit.index?'第 '+unit.index+' 节 ':'' )+(unit.begin?unit.begin+'–'+unit.end:'时间待确认');matrix.append(dot);}
      const footer=node('div','course-term-key');footer.append(node('span','term-key-done','已上'),node('span','term-key-upcoming','未上'));
      if(value.current)footer.append(node('span','term-key-current','正在上'));
      if(value.pending)footer.append(node('span','term-key-pending',value.pending+' 次时间待确认'));
      if(!value.units.length)note.textContent='本学期未录入这门课的上课日期';
      const extra=value.totalPeriods&&value.totalEvents?'实心为节次，空心为独立时段':packed.step>1?'每格最多 '+packed.step+' '+value.unit:'每格 1 '+value.unit;
      footer.append(node('span','term-key-scale',extra));section.replaceChildren(head,note,matrix,footer);
    }
    openDetail=function(id,date){lastProgress='';progressCourse=id;oldDetail(id,date);progress();};
    function scheduleProgress(){clearTimeout(pulseTimer);if(!document.hidden&&$('courseDialog').open)pulseTimer=setTimeout(()=>{progress();scheduleProgress();},1000);}
    $('courseDialog').addEventListener('close',()=>{clearTimeout(pulseTimer);progressCourse=null;lastProgress='';});
    const progressObserver=new PixelObserver(()=>{progress();scheduleProgress();});progressObserver.observe($('courseDialog'),{attributes:true,attributeFilter:['open']});
    // One animated original scene is loaded at a time, through native image
    // decoding. All offscreen, hidden and custom-wallpaper views use no animation.
    const motion=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)'),items=[];
    const labels={morning:'早晨',noon:'中午',afternoon:'下午',night:'晚上'};
    const stats={draws:0,running:false,view:null,phase:null,piece:null,decoderCount:0,framePixels:0};
    let clockTimer=0,current=null,loadedPiece='',staticImage=false,loadToken=0;
    const base=/^https:\/\/suike\.local\//.test(document.baseURI||'')||/(?:android_asset|rawfile|assets)\//.test(document.baseURI||'')||/^(?:resource|rawfile):/.test(document.baseURI||'')?'ambient-scenes/':'work/android-app/assets/ambient-scenes/';
    for(const view of ['today','week','settings']){
      const figure=node('figure','pixel-day-scene'),image=document.createElement('img'),caption=node('figcaption','pixel-day-caption');figure.dataset.pixelView=view;figure.setAttribute('aria-hidden','true');image.className='pixel-day-image';image.width=400;image.height=200;image.alt='';image.decoding='async';figure.append(image,caption);$(view+'View').append(figure);
      const item={view,figure,image,caption,inView:!window.IntersectionObserver,piece:null};items.push(item);
      if(window.IntersectionObserver){const watcher=new IntersectionObserver(entries=>{item.inView=entries.some(e=>e.isIntersecting);reconcile();},{threshold:.05});watcher.observe(figure);}
    }
    function phaseNow(){return Core.phase(new Date(Date.now()+28800000).getUTCHours());}
    function release(){loadToken++;if(current){current.image.onload=null;current.image.onerror=null;const p=frames.pieces[loadedPiece];if(p)current.image.src=base+p.poster;else current.image.removeAttribute('src');}current=null;loadedPiece='';stats.running=false;stats.decoderCount=0;stats.framePixels=0;}
    function load(item,still){
      release();current=item;loadedPiece=item.piece;staticImage=still;const token=loadToken,p=frames.pieces[item.piece];item.image.onload=()=>{if(token!==loadToken||current!==item)return;stats.running=!still;stats.decoderCount=still?0:1;stats.framePixels=item.image.naturalWidth*item.image.naturalHeight;stats.draws++;};
      item.image.onerror=()=>{if(token!==loadToken)return;if(!still)load(item,true);else release();};item.image.src=base+(still?p.poster:p.animation);
    }
    function reconcile(){
      const custom=document.documentElement.dataset.appearance==='custom',phase=phaseNow(),still=!window.MutationObserver||!!(motion&&motion.matches);let next=null;
      for(const item of items){item.figure.hidden=custom;item.piece=Core.choose(item.view,Date.now());item.figure.dataset.pixelPiece=item.piece;item.caption.textContent=labels[phase];
        if(!custom&&!$(item.view+'View').hidden&&item.inView&&!document.hidden&&!document.querySelector('dialog[open]'))next=item;
      }
      stats.view=next&&next.view;stats.phase=phase;stats.piece=next&&next.piece;
      if(!next){if(current)release();return;}
      if(current!==next||loadedPiece!==next.piece||staticImage!==still)load(next,still);
    }
    render=function(){oldRender();progress();reconcile();};
    document.addEventListener('suike-appearance-change',reconcile);document.addEventListener('visibilitychange',()=>{reconcile();scheduleProgress();clock();});
    window.addEventListener('pagehide',()=>{release();clearTimeout(pulseTimer);clearTimeout(clockTimer);});window.addEventListener('pageshow',()=>{reconcile();clock();});
    if(motion){if(motion.addEventListener)motion.addEventListener('change',reconcile);else if(motion.addListener)motion.addListener(reconcile);}
    const themeObserver=new PixelObserver(reconcile);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-appearance']});
    const modalObserver=new PixelObserver(records=>{if(records.some(r=>r.attributeName==='open'))reconcile();});modalObserver.observe(document.body,{attributes:true,subtree:true,attributeFilter:['open']});
    function clock(){clearTimeout(clockTimer);if(!document.hidden){reconcile();clockTimer=setTimeout(clock,60000-Date.now()%60000+20);}}
    window.SuikePixelAmbient=Object.freeze({status:stats,refresh:reconcile});clock();

  })();
