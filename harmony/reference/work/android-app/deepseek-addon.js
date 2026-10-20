  // Explicit send -> clarify -> preview -> atomic local commit. No API Key in web storage.
  (function installDeepSeek(){
    const Core=window.SuikeDeepSeekCore;
    const Protocol=window.SuikeDeepSeekProtocol;
    const dialog=node('dialog','product-dialog ai-dialog');dialog.id='deepSeekDialog';dialog.setAttribute('aria-labelledby','deepSeekTitle');
    const icon=button('icon-button ai-entry','',()=>{readConfig();showDialog(dialog);});icon.id='deepSeekEntry';
    icon.setAttribute('aria-label','DeepSeek 接入');icon.title='DeepSeek';
    const DEEPSEEK_PATH = /* SUIKE_DEEPSEEK_PATH */ "";
    icon.append(pfIcon([DEEPSEEK_PATH]));
    $('settingsView').querySelector('.section-heading').append(icon);
    const heading=node('div','pd-head ai-head'),title=node('h2','','DeepSeek');title.id='deepSeekTitle';
    const close=button('icon-button','×',()=>closeDialog(dialog));close.setAttribute('aria-label','关闭 DeepSeek');
    heading.append(title,close);dialog.append(heading,node('p','pd-sub','导入门户之外的课程：QQ群通知、表格、PDF 或图片。识别后核对导入。'));
    const body=node('div');body.id='deepSeekSettings';
    const configStatus=node('p','ai-state');configStatus.id='deepSeekConfigStatus';body.append(configStatus);
    function field(label,input){const wrap=node('label','field ai-field');wrap.append(node('span','',label),input);return wrap;}
    const key=document.createElement('input');key.id='deepSeekApiKey';key.type='password';key.autocomplete='off';
    key.spellcheck=false;key.maxLength=256;key.placeholder='粘贴你的 API Key';
    const keyRow=node('div','ai-key-row'),show=button('button button-outline','显示',()=>{
      key.type=key.type==='password'?'text':'password';show.textContent=key.type==='password'?'显示':'隐藏';
      show.setAttribute('aria-pressed',String(key.type==='text'));
    });show.setAttribute('aria-label','显示或隐藏 API Key');show.setAttribute('aria-pressed','false');
    keyRow.append(key,show);body.append(field('API Key',keyRow));
    const model=document.createElement('input');model.id='deepSeekModel';model.value='deepseek-flash';model.maxLength=80;
    body.append(field('模型（保存后生效）',model));
    const configActions=node('div','ai-actions');
    const save=button('button button-primary','保存设置',()=>{
      try{
        const result=JSON.parse(bridge('saveDeepSeekConfig')(key.value,model.value));
        if(!result.ok)throw new Error(errorText(result.code));
        invalidate();key.value='';key.type='password';show.textContent='显示';show.setAttribute('aria-pressed','false');
        readConfig();message('密钥已加密保存在本机。',false);
      }catch(error){message(error.message,true);}
    });save.id='deepSeekSave';
    const test=button('button button-outline','验证连接',()=>request('test',{}));test.id='deepSeekTest';
    const remove=button('button button-outline','移除密钥',()=>{
      try{const result=JSON.parse(bridge('clearDeepSeekConfig')());if(!result.ok)throw new Error(errorText(result.code));
        invalidate();key.value='';key.type='password';show.textContent='显示';show.setAttribute('aria-pressed','false');
        readConfig();message('已移除本机密钥。',false);
      }catch(error){message(error.message,true);}
    });remove.id='deepSeekRemove';configActions.append(save,test,remove);body.append(configActions);
    body.append(node('p','ai-message','发送本次内容及学期作息，使用你的 API 额度。密钥仅存本机；图片使用 Flash。'));
    const monday=document.createElement('input');monday.type='date';monday.id='deepSeekMonday';monday.value=state.settings.startMonday||'';
    body.append(field('学期首周周一',monday));
    const source=document.createElement('textarea');source.id='deepSeekCourseText';source.maxLength=12000;
    source.placeholder='发消息，或添加课程文件';
    const composer=node('div','ai-composer'),sourceField=field('发送消息',source);sourceField.classList.add('ai-compose-field');composer.append(sourceField);
    const file=button('button button-outline','导入文件',readDocument);file.id='deepSeekFile';
    const fileHint=node('small','ai-file-hint','Excel · Word · PDF · 图片');const attachments=node('div','ai-attachments');attachments.append(file,fileHint);composer.append(attachments);
    const parse=button('button button-primary','发送',()=>{
      const text=source.value.trim();
      if(!text&&!attachmentId&&!inputText){message('发一条课程消息，或添加文件。',true);return;}
      if(!configured){message(errors.KEY_MISSING,true);configFold.open=true;return;}
      if(base!==null&&base!==JSON.stringify(state)){message('课表已变化，请新建对话后继续。',true);return;}
      if(answers.length>=32){message('本次对话较长，请新建对话后继续。',true);return;}
      invalidate();rounds=0;resetScope();rememberTarget=true;
      if(base===null){base=JSON.stringify(state);inputText=text;sessionMonday=monday.value;answers=[];}
      else if(text){if(text.length>1000){message('补充消息请控制在 1000 字以内。',true);return;}answers.push({id:'followup-'+(++serial),question:'用户补充',answer:text});}
      chat('user',text||(attachmentId?'已添加 '+fileHint.textContent:inputText));source.value='';sendCourses();
    });parse.id='deepSeekParse';
    const cancel=button('button button-outline','取消解析',()=>{invalidate();message('已取消，本地课表没有改动。',false);});cancel.id='deepSeekCancel';cancel.hidden=true;
    const parseActions=node('div','ai-actions');parseActions.append(parse,cancel);composer.append(parseActions);
    const status=node('p','ai-message');status.id='deepSeekStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');body.append(status);
    const questions=node('form','ai-questions');questions.id='deepSeekQuestions';questions.hidden=true;
    const questionFields=node('div');questions.append(questionFields);
    const answerButton=node('button','button button-primary','提交补充');answerButton.type='submit';answerButton.id='deepSeekAnswer';
    questions.append(answerButton);body.append(questions);
    const preview=node('section','ai-preview');preview.id='deepSeekPreview';preview.hidden=true;
    preview.append(node('h4','','课程预览'));
    const previewList=node('div','ai-preview-list');previewList.id='deepSeekPreviewList';
    const notes=node('p','ai-message');preview.append(previewList,notes);
    const confirm=button('button button-primary','确认导入',confirmCourses);confirm.id='deepSeekConfirm';
    const revise=button('button button-outline','继续对话',()=>{invalidate();source.focus();message('发送补充信息后重新核对。',false);});
    const previewActions=node('div','ai-actions');previewActions.append(confirm,revise);preview.append(previewActions);body.append(preview);
    const configFold=node('details','ai-config');configFold.id='deepSeekConfig';
    const configSummary=node('summary','','API 设置');configSummary.id='deepSeekConfigSummary';configFold.append(configSummary);
    // The old settings form stays available inside one disclosure.
    Array.from(body.children).forEach(child=>{if(child!==questions&&child!==preview&&child!==status)configFold.append(child);});
    const chatLog=node('div','ai-chat-log');chatLog.id='deepSeekChat';chatLog.setAttribute('role','log');chatLog.setAttribute('aria-live','polite');
    chatLog.append(questions,preview);const scrollContent=node('div','ai-scroll-content');scrollContent.append(configFold,chatLog,status);body.replaceChildren(scrollContent,composer);
    const fresh=button('text-button','新对话',()=>newConversation());fresh.id='deepSeekNewChat';heading.insertBefore(fresh,close);
    dialog.append(body);document.body.append(dialog);armDialogCancel(dialog);
    dialog.addEventListener('close',()=>{newConversation();key.value='';key.type='password';});
    let pending=null,pendingDocument=null,attachmentId='',serial=0,timer=null,configured=false,answers=[],rounds=0,base=null,inputText='',sessionMonday='',drafts=[],questionInputs=[];
    let transcript=[];
    let stage='inspect',scope=null,target=null,repairs=0,questionKind='remote',rememberTarget=true;
    const scopeSummary=node('div','ai-scope-summary');scopeSummary.hidden=true;scopeSummary.id='deepSeekScopeSummary';
    const scopeLabel=node('span'),changeScope=button('text-button','更改',()=>{invalidate();repairs=0;if(scope&&scope.mode==='classes')showScope();else{scope=null;target=null;stage='inspect';sendCourses();}});
    changeScope.id='deepSeekChangeScope';scopeSummary.append(scopeLabel,changeScope);composer.insertBefore(scopeSummary,parseActions);
    const errors={
      KEY_MISSING:'请先保存你的 API Key。',KEY_INVALID:'API Key 格式不正确，请重新粘贴。',KEY_UNREADABLE:'密钥无法读取，请重新保存。',
      MODEL_INVALID:'模型名称格式不正确。',MODEL_UNAVAILABLE:'密钥有效，但当前模型不可用，请修改模型名称后验证。',
      AUTH:'API Key 无效或已失效，请重新保存。',BALANCE:'DeepSeek 账户余额不足，请充值后重试。',
      RATE_LIMIT:'请求过于频繁，请稍后重试。',TIMEOUT:'DeepSeek 响应超时，请检查网络后重试。',NETWORK:'无法连接 DeepSeek，请检查当前 VPN 或网络后重试。',
      SERVER:'DeepSeek 服务暂时不可用，请稍后重试。',BUSY:'上一条请求尚未结束，请稍后再试。',
      OUTPUT_TRUNCATED:'课程内容较多，结果未生成完整。请按班级或学期分批导入。',
      SETTINGS_FAILED:'密钥未能保存，请重新尝试。',TERM_INVALID:'请先确认正确的学期首周周一。',
      TEXT_INVALID:'请粘贴课程文字或添加附件，文字单次不超过 12000 字。',RESPONSE_INVALID:'DeepSeek 未返回完整结果，请补充课程信息后重试。',
      ATTACHMENT_EXPIRED:'附件已失效，请重新添加后解析。',REQUEST_FAILED:'此模型或附件未被接受，请使用 DeepSeek Flash 后重试。',
      RESPONSE_TOO_LARGE:'返回内容较多，请减少本次课程后重试。'
    };
    function chat(role,text){
      text=String(text||'').slice(0,4000);const bubble=node('div','ai-bubble ai-bubble-'+role);bubble.append(node('small','',role==='user'?'你':'DeepSeek'),node('p','',text));
      chatLog.insertBefore(bubble,questions);transcript.push({role,content:text});if(transcript.length>16)transcript=transcript.slice(-16);reveal(bubble);
    }
    function newConversation(){invalidate();clearAttachment();answers=[];rounds=0;base=null;inputText='';source.value='';sessionMonday='';transcript=[];Array.from(chatLog.querySelectorAll('.ai-bubble')).forEach(item=>item.remove());message('',false);}
    function errorText(code){return errors[code]||'此次请求未完成，请稍后重试；课表没有改动。';}
    function bridge(name){if(!window.SuikeNative||typeof window.SuikeNative[name]!=='function')throw new Error('请在随课应用中使用 DeepSeek。');return function(){return window.SuikeNative[name].apply(window.SuikeNative,arguments);};}
    function message(text,error){status.textContent=text;status.classList.toggle('is-error',!!error);}
    function reveal(element){requestAnimationFrame(()=>{if(dialog.open&&typeof element.scrollIntoView==='function')element.scrollIntoView({block:'start',behavior:window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});});}
    function readConfig(){
      try{const c=JSON.parse(bridge('getDeepSeekConfig')());configured=c.ok===true&&c.configured===true;model.value=c.model||'deepseek-flash';}
      catch(_){configured=false;}
      configStatus.textContent=configured?'已配置':'未配置';
      configSummary.textContent=configured?'API 设置 · 已配置':'API 设置 · 未配置';if(!configured)configFold.open=true;
      key.placeholder=configured?'已保存；更换时粘贴新密钥':'粘贴你的 API Key';
      remove.disabled=!configured;
    }
    function busy(value){parse.disabled=value;file.disabled=value;test.disabled=value;answerButton.disabled=value;changeScope.disabled=value;cancel.hidden=!value;save.disabled=value;remove.disabled=value||!configured;}
    function invalidate(){
      if(pending){try{bridge('cancelDeepSeek')();}catch(_){}}
      if(pendingDocument){try{bridge('cancelDeepSeekDocument')();}catch(_){}}
      pending=null;pendingDocument=null;if(timer)clearTimeout(timer);timer=null;busy(false);questions.hidden=true;preview.hidden=true;drafts=[];
    }
    function request(action,payload){
      if(pending)return;
      try{
        if(!configured)throw new Error(errors.KEY_MISSING);
        const id='ds-'+Date.now()+'-'+(++serial);pending={id,action};busy(true);
        message(action==='test'?'正在验证连接…':stage==='inspect'?'正在识别班级范围…':'正在读取所选课程…',false);
        if(bridge('requestDeepSeek')(id,action,JSON.stringify(payload))!==true)throw new Error('请求未能启动，请稍后重试。');
        timer=setTimeout(()=>{if(pending&&pending.id===id){invalidate();message(errors.TIMEOUT,true);}},95000);
      }catch(error){pending=null;busy(false);message(error.message,true);}
    }
    function sendCourses(){
      if((!inputText&&!attachmentId)||inputText.length>12000){message(errors.TEXT_INVALID,true);return;}
      try{if(Core.date(sessionMonday)!==1)throw new Error();}catch(_){message(errors.TERM_INVALID,true);return;}
      if(JSON.stringify(state)!==base){invalidate();message('课表已发生变化，请重新解析后核对。',true);return;}
      const prefs=Product.settings(state);
      request('parse',{protocol:2,stage,text:inputText,answers,attachmentId,scope,target,context:{startMonday:sessionMonday,totalWeeks:state.settings.totalWeeks,periods:state.periods,profile:prefs.profile,identity:prefs.aiIdentity||null,today:chinaToday(),conversation:transcript.slice(-12),program:{schemaVersion:1,maxPeriods:state.periods.length,timeFormat:'HH:MM-HH:MM',dateAuthority:'local-validator',writePolicy:'preview-and-confirm',sourceEvidenceRequired:true,clockOnlyArrangements:true,clockOnlyExample:{name:'团组织会议',periods:'',clock:'06:40-06:50'},clockPlacement:'proportional-no-period-change'}}});
    }
    questions.addEventListener('submit',event=>{
      event.preventDefault();
      if(questionKind==='scope'){
        try{const classId=$('deepSeekClassSelect').value,groupId=$('deepSeekGroupSelect').value;target={classId,groupId};Protocol.identity(scope,target);rememberTarget=$('deepSeekRememberScope').checked;questions.hidden=true;stage='extract';repairs=0;renderScopeSummary();sendCourses();}
        catch(error){message(error.message,true);}return;
      }
      const next=[];
      for(const item of questionInputs){
        const value=item.input.value.trim();
        if(!value){message('请回答每个问题；不确定时可以填写你的疑问。',true);item.input.focus();return;}
        if(value.length>1000){message('单个回答请控制在 1000 字以内。',true);return;}
        next.push({id:item.question.id,question:item.question.question,answer:value});
      }
      answers=answers.concat(next);chat('user',next.map(a=>a.question+'：'+a.answer).join('\n'));questions.hidden=true;sendCourses();
    });
    function showQuestions(result){
      questionKind='remote';answerButton.textContent='继续';
      if(rounds>=5){questions.hidden=true;message('仍有信息需要确认。请把日期和节次补充到原文后重新解析。',true);return;}
      rounds++;chat('assistant',result.questions.map(q=>q.question).join('\n'));questionFields.replaceChildren();questionInputs=[];
      result.questions.forEach(q=>{
        let input;
        if(q.choices.length){input=node('select');const blank=node('option','','请选择，也可在下方补充');blank.value='';input.append(blank);q.choices.forEach(value=>{const o=node('option','',value);o.value=value;input.append(o);});
          input.setAttribute('aria-label',q.question);
          const free=document.createElement('input');free.type='text';free.maxLength=1000;free.placeholder='或直接填写你的答案';free.setAttribute('aria-label',q.question+'（自定义答案）');
          const wrap=field(q.question,input);wrap.append(free);questionFields.append(wrap);
          questionInputs.push({question:q,input:{get value(){return free.value||input.value;},focus(){free.focus();}}});
        }else{input=document.createElement('input');input.type='text';input.maxLength=1000;input.placeholder='填写具体日期、周次或时间';questionFields.append(field(q.question,input));questionInputs.push({question:q,input});}
      });
      questions.hidden=false;preview.hidden=true;message('还需要确认以下信息。',false);reveal(questions);
    }
    function renderScopeSummary(){
      scopeSummary.hidden=!scope;scopeLabel.textContent=scope&&scope.mode==='classes'&&target?Object.values(Protocol.identity(scope,target)).filter(Boolean).join(' · '):'本次课程';
    }
    function showScope(){
      questionKind='scope';questionFields.replaceChildren();questionInputs=[];answerButton.textContent='继续';scopeSummary.hidden=true;
      const select=node('select');select.id='deepSeekClassSelect';const blank=node('option','','选择你的班级');blank.value='';select.append(blank);
      scope.candidates.forEach(c=>{const o=node('option','',c.label);o.value=c.id;select.append(o);});
      questionFields.append(field('班级',select));
      const group=node('select');group.id='deepSeekGroupSelect';const groupWrap=field('批次 / 分组',group);questionFields.append(groupWrap);
      function updateGroups(){group.replaceChildren();const c=scope.candidates.find(c=>c.id===select.value);groupWrap.hidden=!c||!c.groups.length;const empty=node('option','','选择你的分组');empty.value='';group.append(empty);if(c)c.groups.forEach(g=>{const o=node('option','',g.label);o.value=g.id;group.append(o);});}
      select.addEventListener('change',updateGroups);
      if(target)select.value=target.classId;updateGroups();if(target)group.value=target.groupId;
      const keep=node('label','ai-remember'),check=document.createElement('input');check.type='checkbox';check.id='deepSeekRememberScope';check.checked=rememberTarget;keep.append(check,node('span','','记住选择'));questionFields.append(keep);
      questions.hidden=false;preview.hidden=true;message('只导入所选班级和分组的课程。',false);reveal(questions);
    }
    function receiveScope(result){
      scope=Protocol.inspect(result);target=null;
      if(scope.mode==='unknown'){scope=null;showQuestions({questions:[{id:'scope-unknown-'+rounds,question:'需要导入哪个班级的课程？',choices:[]}]});return;}
      if(scope.mode==='classes'){
        target=Protocol.remembered(scope,Product.settings(state).aiIdentity);
        if(!target){showScope();return;}
      }
      stage='extract';repairs=0;renderScopeSummary();sendCourses();
    }
    function showPreview(result){
      drafts=result.courses;chat('assistant','识别到 '+result.courses.length+' 项课程安排，请核对日期、时间和班级。');previewList.replaceChildren();
      drafts.forEach((course,index)=>{
        const row=node('label','ai-course-row'),check=document.createElement('input');check.type='checkbox';check.checked=true;check.dataset.aiIndex=String(index);
        const dateText=course.dates.length>5?course.dates[0]+' — '+course.dates[course.dates.length-1]+' · 共 '+course.dates.length+' 次':course.dates.join('、');
        const detail=node('div');detail.append(node('strong','',course.name),node('p','',dateText),
          node('p','','星期'+WEEKDAYS[course.day-1]+' · '+M.timeRange(course,state.periods).text+(course.timeMode==='clock'?'':' · 第 '+course.start+'–'+course.end+' 节')),
          node('p','',[course.room,course.teacher].filter(Boolean).join(' · ')));
        if(course.dates.length>5){const dates=node('details','ai-source');dates.append(node('summary','','全部日期'),node('p','',course.dates.join('、')));detail.append(dates);}
        if(result.sources&&result.sources[index]){const proof=result.sources[index],details=node('details','ai-source');details.append(node('summary','','查看来源'),node('p','',proof.location+' · '+proof.quote));detail.append(details);}
        row.append(check,detail);previewList.append(row);
      });
      const plan=Core.plan(state,drafts,'ai-preview'),validated=M.validateState(plan.next);
      const conflicts=validated.courses.filter(c=>c.id.indexOf('ai-preview-')===0&&M.conflictsFor(validated.courses,c,validated.periods).length).length;
      notes.textContent=result.notes.concat(plan.duplicates?['已存在的 '+plan.duplicates+' 次课会跳过。']:[],conflicts?['有 '+conflicts+' 条安排与现有课程时间冲突，请核对日期和节次。']:[]).join(' ');
      questions.hidden=true;preview.hidden=false;confirm.disabled=plan.added===0;
      message(plan.added?'共 '+plan.added+' 次课。':'课程已存在，没有新增内容。',false);reveal(preview);
    }
    function confirmCourses(){
      try{
        if(JSON.stringify(state)!==base){invalidate();throw new Error('课表已发生变化，请重新解析后核对。');}
        const selected=Array.from(previewList.querySelectorAll('input')).filter(c=>c.checked).map(c=>drafts[Number(c.dataset.aiIndex)]);
        if(!selected.length)throw new Error('请至少选择一条课程。');
        const plan=Core.plan(state,selected,'ai-'+Date.now());
        if(scope&&scope.mode==='classes'&&target&&rememberTarget){plan.next.productSettings=Product.settings(plan.next);plan.next.productSettings.aiIdentity=Protocol.identity(scope,target);}
        if(!plan.added)throw new Error('所选课程已存在，没有新增内容。');
        if(productCommit(M.validateState(plan.next),'已导入 '+plan.added+' 次课程；可撤销')){
          invalidate();clearAttachment();source.value='';answers=[];base=null;closeDialog(dialog);
        }
      }catch(error){message(error.message,true);}
    }
    function receive(id,response){
      if(!pending||id!==pending.id)return false;
      const action=pending.action;pending=null;if(timer)clearTimeout(timer);timer=null;busy(false);
      if(!response||response.ok!==true){message(errorText(response&&response.code),true);return false;}
      if(action==='test'){message('连接正常，密钥与当前模型可用。',false);return true;}
      if(JSON.stringify(state)!==base){invalidate();message('课表已发生变化，请重新解析后核对。',true);return false;}
      try{
        if(response.result&&response.result.status==='message'){
          const result=response.result;if(result.protocol!==2||typeof result.message!=='string'||!result.message.trim()||result.message.length>2000||result.courses||result.questions)throw new Error('对话结果不完整，请重试。');
          chat('assistant',result.message);message('',false);return true;
        }
        if(response.result&&response.result.status==='clarify'){const result=Core.normalize(response.result,state.periods);showQuestions(result);return true;}
        if(stage==='inspect'){receiveScope(response.result);return true;}
        const result=Protocol.normalize(response.result,{scope,target,startMonday:sessionMonday,totalWeeks:state.settings.totalWeeks,periods:state.periods,hasAttachment:!!attachmentId,sourceText:[inputText,...answers.map(a=>a.answer)].join('\n')});
        showPreview(result);return true;
      }catch(error){
        if(repairs<2){repairs++;answers.push({id:'validation-'+stage+'-'+repairs,question:'软件校验',answer:error.message});sendCourses();}
        else message(error.message,true);return false;
      }
    }
    function resetScope(){scope=null;target=null;scopeSummary.hidden=true;stage='inspect';repairs=0;}
    source.addEventListener('input',()=>{if(base!==null){invalidate();message('',false);}});
    monday.addEventListener('change',()=>{invalidate();base=null;answers=[];resetScope();message('学期日期已修改，请重新解析。',false);});
    function readDocument(){
      const draft=source.value;newConversation();source.value=draft;
      try{
        const id='file-'+Date.now()+'-'+(++serial);pendingDocument=id;busy(true);message('正在读取文件…',false);
        if(bridge('pickDeepSeekDocument')(id)!==true)throw new Error('文件选择未能打开，请重试。');
      }catch(error){pendingDocument=null;busy(false);message(error.message,true);}
    }
    function receiveDocument(id,result){
      if(id!==pendingDocument)return false;pendingDocument=null;busy(false);
      if(result.error==='CANCELLED'){message('',false);return false;}
      if(result.error&&result.error!=='none'){message(result.error,true);return false;}
      attachmentId=result.attachmentId||'';
      fileHint.textContent=result.name||'附件已添加';
      detach.hidden=!attachmentId;
      message('附件已添加，发送后识别。',false);return true;
    }
    function clearAttachment(){
      attachmentId='';detach.hidden=true;fileHint.textContent='Excel · Word · PDF · 图片';
      resetScope();
      try{bridge('clearDeepSeekAttachments')();}catch(_){}
    }
    const detach=button('text-button','移除附件',()=>{invalidate();clearAttachment();message('附件已移除，保留文字。',false);});detach.hidden=true;fileHint.parentElement.insertBefore(detach,fileHint);
    window.SuikeDeepSeek={receive,receiveDocument};
    readConfig();
  })();
