  // Shared in-app choices. Native controls remain the source of form values and validation.
  (function installPickers(){
    const records=new WeakMap(),live=new Set();let sequence=0,session=null,refreshPending=false;
    const panel=node('dialog','product-dialog suike-picker');panel.id='suikePicker';panel.setAttribute('aria-labelledby','suikePickerTitle');
    const head=node('div','pd-head'),title=node('h2');title.id='suikePickerTitle';
    const close=button('icon-button picker-close','×',dismiss);close.setAttribute('aria-label','关闭选择');head.append(title,close);
    const body=node('div','picker-body'),error=node('p','picker-error');error.id='suikePickerError';error.setAttribute('role','status');error.hidden=true;
    const foot=node('div','picker-foot');panel.append(head,body,error,foot);document.body.append(panel);armDialogCancel(panel);
    function opened(){return panel.getAttribute('open')!==null;}
    function connected(element){return typeof element.isConnected==='boolean'?element.isConnected:!!element.closest('body');}
    function kind(source){return source.tagName==='SELECT'?'select':source.type||source.getAttribute('type');}
    function label(source){
      if(source.id==='weekSelect')return '周次';
      const wrap=source.closest('label'),text=wrap&&wrap.querySelector('span');
      return (text&&text.textContent||source.getAttribute('aria-label')||'选择').replace(/（选填）|\(选填\)/g,'').trim();
    }
    function options(source){return Array.from(source.querySelectorAll('option')).map(option=>{
      const group=option.closest('optgroup');
      return {value:option.value,text:option.textContent,
        disabled:option.disabled||option.getAttribute('disabled')!==null||!!(group&&(group.disabled||group.getAttribute('disabled')!==null)),
        group:group?(group.getAttribute('label')||''):''};
    });}
    function sync(source){
      const record=records.get(source);if(!record)return;
      const type=kind(source),selected=type==='select'?options(source).find(option=>option.value===source.value):null;
      const text=selected?selected.text:source.value||(type==='date'?'选择日期':type==='time'?'选择时间':'请选择');
      if(record.text.textContent!==text)record.text.textContent=text;
      const disabled=!!(source.disabled||source.readOnly);if(record.trigger.disabled!==disabled)record.trigger.disabled=disabled;
      record.trigger.setAttribute('aria-label',label(source)+'，'+text);
    }
    function bind(source){
      if(records.has(source)){live.add(source);sync(source);return;}
      if(source.multiple||source.hidden||source.classList.contains('pf-vhidden')||source.getAttribute('aria-hidden')==='true')return;
      if(!source.id)source.id='suikePickerField'+(++sequence);
      const wrap=node('span','suike-control-wrap'),trigger=button('suike-control-trigger','',()=>open(source)),text=node('span','suike-control-value');
      trigger.dataset.pickerFor=source.id;trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');
      trigger.append(text,pfIcon(['m6 9 6 6 6-6']));
      source.parentElement.insertBefore(wrap,source);wrap.append(source,trigger);
      records.set(source,{trigger,text});live.add(source);source.classList.add('suike-picker-source');source.tabIndex=-1;source.setAttribute('aria-hidden','true');
      source.addEventListener('click',event=>{event.preventDefault();open(source);});
      source.addEventListener('focus',()=>trigger.focus());
      source.addEventListener('input',()=>sync(source));source.addEventListener('change',()=>sync(source));
      source.addEventListener('invalid',event=>{event.preventDefault();trigger.focus();open(source);});
      sync(source);
    }
    function refresh(){
      Array.from(live).forEach(source=>{if(!connected(source))live.delete(source);});
      Array.from(document.querySelectorAll('select')).concat(Array.from(document.querySelectorAll('input')).filter(source=>['date','time'].indexOf(kind(source))>=0)).forEach(bind);
      if(session&&!connected(session.source))dismiss();
    }
    function queueRefresh(){if(refreshPending)return;refreshPending=true;Promise.resolve().then(()=>{refreshPending=false;refresh();});}
    function finish(){
      const previous=session;session=null;
      if(previous){const record=records.get(previous.source);if(record){record.trigger.setAttribute('aria-expanded','false');if(connected(previous.source))record.trigger.focus();}}
      body.replaceChildren();foot.replaceChildren();
    }
    function dismiss(){if(opened())closeDialog(panel);else finish();}
    panel.addEventListener('close',finish);
    panel.addEventListener('click',event=>{if(event.target!==panel)return;const r=panel.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dismiss();});
    function commit(value){
      if(!session||!connected(session.source)||session.source.disabled)return;
      const source=session.source,before=source.value;source.value=value;
      if(typeof source.checkValidity==='function'&&!source.checkValidity()){
        source.value=before;error.textContent='请选择允许范围内的值。';error.hidden=false;return;
      }
      if(source.value!==before){source.dispatchEvent(new Event('input',{bubbles:true}));source.dispatchEvent(new Event('change',{bubbles:true}));}
      refresh();dismiss();
    }
    function open(source){
      if(source.disabled||source.readOnly||!connected(source))return;
      bind(source);const record=records.get(source);if(!record)return;
      if(session&&opened())return;
      const active=document.activeElement;if(active&&typeof active.blur==='function')active.blur();
      session={source,type:kind(source)};record.trigger.setAttribute('aria-expanded','true');title.textContent=label(source);error.hidden=true;error.textContent='';body.replaceChildren();foot.replaceChildren();
      panel.dataset.kind=session.type;
      if(session.type==='select')renderOptions();else if(session.type==='date')renderDate();else renderTime();
      showDialog(panel);
      requestAnimationFrame(()=>{
        if(!session)return;
        const selected=body.querySelector('.is-selected'),focus=selected&&!selected.disabled?selected:Array.from(body.querySelectorAll('button')).find(item=>!item.disabled&&item.tabIndex===0);if(focus)focus.focus();
        Array.from(body.querySelectorAll('.picker-scroll')).forEach(list=>{const choice=list.querySelector('.is-selected');if(choice)list.scrollTop=Math.max(0,choice.offsetTop-list.clientHeight/2+choice.offsetHeight/2);});
      });
    }
    function renderOptions(){
      const list=node('div','picker-options picker-scroll');list.setAttribute('role','listbox');list.setAttribute('aria-labelledby',title.id);let group='';
      options(session.source).forEach(option=>{
        if(option.group&&option.group!==group){group=option.group;list.append(node('p','picker-group',group));}
        const selected=option.value===session.source.value,item=button('picker-option'+(selected?' is-selected':''),'',()=>{if(!option.disabled)commit(option.value);});
        item.disabled=option.disabled;item.dataset.pickerValue=option.value;item.setAttribute('role','option');item.setAttribute('aria-selected',String(selected));item.tabIndex=selected?0:-1;
        const check=node('span','picker-check');check.append(pfIcon(['m5 12 4 4L19 6']));item.append(node('span','picker-option-text',option.text),check);list.append(item);
      });
      const current=list.querySelector('.is-selected');if(!current||current.disabled){const first=Array.from(list.querySelectorAll('button')).find(item=>!item.disabled);if(first)first.tabIndex=0;}
      body.append(list);
      list.addEventListener('keydown',event=>{
        const items=Array.from(list.querySelectorAll('button')).filter(item=>!item.disabled),index=items.indexOf(event.target);
        let next=-1;if(event.key==='ArrowDown')next=Math.min(items.length-1,index+1);if(event.key==='ArrowUp')next=Math.max(0,index-1);if(event.key==='Home')next=0;if(event.key==='End')next=items.length-1;
        if(next>=0&&items[next]){event.preventDefault();items.forEach(item=>item.tabIndex=-1);items[next].tabIndex=0;items[next].focus();}
      });
    }
    function pad(value){return String(value).padStart(2,'0');}
    function iso(year,month,day){return String(year)+'-'+pad(month+1)+'-'+pad(day);}
    function dateParts(value){
      const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value||'');if(!match)return null;
      const year=Number(match[1]),month=Number(match[2])-1,day=Number(match[3]),date=new Date(Date.UTC(year,month,day));
      return iso(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate())===value?{year,month,day}:null;
    }
    function dateAllowed(value){const source=session.source,min=source.min||source.getAttribute('min'),max=source.max||source.getAttribute('max');return (!min||value>=min)&&(!max||value<=max);}
    function renderDate(){
      const original=dateParts(session.source.value),today=dateParts(chinaToday());session.dateDraft=original?session.source.value:'';
      session.month=original||today;session.monthChooser=false;const toolbar=node('div','picker-month-nav');
      const previous=button('icon-button','‹',()=>moveMonth(-1)),month=button('picker-month-label','',()=>{session.monthChooser=!session.monthChooser;paint();}),next=button('icon-button','›',()=>moveMonth(1));
      previous.setAttribute('aria-label','上个月');next.setAttribute('aria-label','下个月');month.setAttribute('aria-label','回到本月');toolbar.append(previous,month,next);
      const calendar=node('div','picker-calendar');body.append(toolbar,calendar);
      const clear=button('text-button','清除',()=>commit(''));clear.hidden=!!(session.source.required||session.source.getAttribute('required')!==null);
      const todayButton=button('text-button','今天',()=>{const value=chinaToday();if(dateAllowed(value)){session.dateDraft=value;session.month=dateParts(value);session.monthChooser=false;paint();}});
      const cancel=button('button button-outline','取消',dismiss),confirm=button('button button-primary','确定',()=>commit(session.dateDraft));
      foot.append(clear,todayButton,cancel,confirm);
      function moveMonth(amount){const value=new Date(Date.UTC(session.month.year+(session.monthChooser?amount:0),session.month.month+(session.monthChooser?0:amount),1));session.month={year:value.getUTCFullYear(),month:value.getUTCMonth(),day:1};paint();}
      function paint(){
        const {year,month:m}=session.month;month.textContent=year+'年'+(session.monthChooser?'':(m+1)+'月');month.setAttribute('aria-label',session.monthChooser?'返回日期':'选择年月');confirm.disabled=!session.dateDraft;
        previous.setAttribute('aria-label',session.monthChooser?'上一年':'上个月');next.setAttribute('aria-label',session.monthChooser?'下一年':'下个月');
        previous.disabled=year<=1900&&(session.monthChooser||m===0);next.disabled=year>=2200&&(session.monthChooser||m===11);
        calendar.replaceChildren();
        if(session.monthChooser){
          const grid=node('div','picker-month-grid'),source=session.source,min=source.min||source.getAttribute('min'),max=source.max||source.getAttribute('max');
          for(let index=0;index<12;index++){
            const last=new Date(Date.UTC(year,index+1,0)).getUTCDate(),item=button('picker-day'+(index===m?' is-selected':''),(index+1)+'月',()=>{
              const day=(dateParts(session.dateDraft)||today).day;let value=iso(year,index,Math.min(day,last));if(min&&value<min)value=min;if(max&&value>max)value=max;
              session.dateDraft=value;session.month=dateParts(value);session.monthChooser=false;paint();
            });item.dataset.pickerMonth=String(index+1);item.disabled=!!(min&&iso(year,index,last)<min||max&&iso(year,index,1)>max);grid.append(item);
          }calendar.append(grid);return;
        }
        const table=node('table');table.setAttribute('role','grid');table.setAttribute('aria-label',month.textContent);
        const header=node('thead'),headerRow=node('tr');['一','二','三','四','五','六','日'].forEach(text=>{const cell=node('th','',text);cell.setAttribute('scope','col');headerRow.append(cell);});header.append(headerRow);table.append(header);
        const rows=node('tbody'),first=(new Date(Date.UTC(year,m,1)).getUTCDay()+6)%7,count=new Date(Date.UTC(year,m+1,0)).getUTCDate(),weeks=Math.ceil((first+count)/7);
        for(let week=0;week<weeks;week++){const row=node('tr');for(let col=0;col<7;col++){
          const day=week*7+col-first+1,cell=node('td');cell.setAttribute('role','gridcell');
          if(day>0&&day<=count){const value=iso(year,m,day),selected=value===session.dateDraft,item=button('picker-day'+(selected?' is-selected':'')+(value===chinaToday()?' is-today':''),String(day),()=>{session.dateDraft=value;paint();const current=calendar.querySelector('.is-selected');if(current)current.focus();});
            item.dataset.pickerDate=value;item.disabled=!dateAllowed(value);item.tabIndex=selected||!session.dateDraft&&day===1?0:-1;item.setAttribute('aria-label',value);item.setAttribute('aria-pressed',String(selected));cell.append(item);}
          row.append(cell);
        }rows.append(row);}table.append(rows);calendar.append(table);
        const current=calendar.querySelector('.is-selected');if(!current||current.disabled){const first=Array.from(calendar.querySelectorAll('button')).find(item=>!item.disabled);if(first)first.tabIndex=0;}
      }
      calendar.addEventListener('keydown',event=>{
        const value=event.target.dataset&&event.target.dataset.pickerDate,current=dateParts(value);if(!current)return;
        const offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7},offset=offsets[event.key];if(offset===undefined)return;
        const moved=new Date(Date.UTC(current.year,current.month,current.day+offset)),target=iso(moved.getUTCFullYear(),moved.getUTCMonth(),moved.getUTCDate());
        if(!dateAllowed(target))return;event.preventDefault();session.dateDraft=target;session.month=dateParts(target);paint();const selected=calendar.querySelector('.is-selected');if(selected)selected.focus();
      });paint();
    }
    function renderTime(){
      const match=/^(\d{2}):(\d{2})/.exec(session.source.value||'');session.hour=match?Number(match[1]):8;session.minute=match?Number(match[2]):0;
      const display=node('p','picker-time-value'),columns=node('div','picker-time-columns');body.append(display,columns);
      function column(name,count,labelText){
        const wrap=node('div'),label=node('p','picker-time-label',labelText),list=node('div','picker-time-list picker-scroll');list.setAttribute('role','listbox');list.setAttribute('aria-label',labelText);
        for(let value=0;value<count;value++){
          const item=button('picker-time-option',pad(value),()=>{session[name]=value;syncTime();});item.dataset.pickerTime=name+'-'+value;item.setAttribute('role','option');list.append(item);
        }
        list.addEventListener('keydown',event=>{
          const items=Array.from(list.querySelectorAll('button')),index=items.indexOf(event.target);let target=index;
          if(event.key==='ArrowDown')target=Math.min(count-1,index+1);else if(event.key==='ArrowUp')target=Math.max(0,index-1);else return;
          event.preventDefault();items[target].focus();
        });wrap.append(label,list);columns.append(wrap);
      }
      column('hour',24,'时');column('minute',60,'分');
      function syncTime(){
        display.textContent=pad(session.hour)+' : '+pad(session.minute);
        Array.from(columns.querySelectorAll('button')).forEach(item=>{const parts=item.dataset.pickerTime.split('-'),selected=session[parts[0]]===Number(parts[1]);item.classList.toggle('is-selected',selected);item.setAttribute('aria-selected',String(selected));item.tabIndex=selected?0:-1;});
      }
      foot.append(button('button button-outline','取消',dismiss),button('button button-primary','确定',()=>commit(pad(session.hour)+':'+pad(session.minute))));syncTime();
    }
    const previousRender=render;render=function(){const result=previousRender.apply(this,arguments);refresh();return result;};
    const previousShow=showDialog;showDialog=function(dialog){if(dialog!==panel)refresh();return previousShow(dialog);};
    document.addEventListener('change',queueRefresh,true);document.addEventListener('reset',queueRefresh,true);
    if(typeof MutationObserver==='function')new MutationObserver(queueRefresh).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','readonly','value','min','max','step']});
    window.SuikePickers={refresh,open,dismiss};refresh();
  })();
