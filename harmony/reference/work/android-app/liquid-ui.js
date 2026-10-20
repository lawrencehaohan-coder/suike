  // UI only. No persistence, import decisions or native interfaces are changed.
  (function installLiquidUI() {
    if (!window.SuikeLiquidGlassVendor || typeof window.requestAnimationFrame !== 'function' ||
        typeof window.MutationObserver !== 'function' || typeof window.WeakMap !== 'function') return;
    const V = window.SuikeLiquidGlassVendor;
    const enabled = () => !window.SuikeAppearance || SuikeAppearance.isEnabled();
    const reduced = () => !enabled() || window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animations = new Set(), folds = new WeakMap(), closeTimers = new WeakMap(), elementAnimations=new WeakMap(), glassTimers=new WeakMap();
    // A disclosure belongs to its card, not a second moving glass surface.
    const controls = 'button:not(:disabled)';
    let pressed = null, hovered = null, pointerFrame = 0, pendingPointer = null;
    let lastView = null, lastDate = null, lastWeek = null;
    const defs = document.createElement('div'); defs.innerHTML = V.svgMarkup;
    if (!defs.firstElementChild) return; // Layout-free model harnesses do not parse SVG.
    document.body.appendChild(defs.firstElementChild);
    const nav = document.querySelector('.bottom-nav');
    const lens = node('span', 'lg-nav-lens'); lens.setAttribute('aria-hidden', 'true');
    lens.append(node('span', 'lg-warp'), node('span', 'lg-border')); nav.insertBefore(lens, nav.firstChild);
    // Claude's tab symbols remain visible with either glass preference.
    const TAB_ICONS = {
      today:'<rect class="lg-tab-fill" x="4" y="5.5" width="16" height="14.5" rx="3.6"/><rect x="4" y="5.5" width="16" height="14.5" rx="3.6"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/><circle cx="12" cy="15" r="1.7" fill="currentColor" stroke="none"/>',
      week:'<rect class="lg-tab-fill" x="3.5" y="5" width="17" height="15" rx="3.6"/><rect x="3.5" y="5" width="17" height="15" rx="3.6"/><path d="M3.5 10h17M9.2 10v10M14.8 10v10"/>',
      settings:'<path d="M4 7.5h8.6M17.4 7.5H20M4 12.5h2.6M11.4 12.5H20M4 17.5h10.1M18.9 17.5H20"/><circle class="lg-tab-fill" cx="15" cy="7.5" r="2.4"/><circle cx="15" cy="7.5" r="2.4"/><circle class="lg-tab-fill" cx="9" cy="12.5" r="2.4"/><circle cx="9" cy="12.5" r="2.4"/><circle class="lg-tab-fill" cx="16.5" cy="17.5" r="2.4"/><circle cx="16.5" cy="17.5" r="2.4"/>'
    };
    nav.querySelectorAll('.nav-item').forEach(item => {
      const markup = TAB_ICONS[item.dataset.view], label = item.querySelector('.nav-label');
      if (!markup || !label || item.querySelector('.lg-tab-icon')) return;
      const icon = node('span', 'lg-tab-icon'); icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = '<svg viewBox="0 0 24 24" focusable="false">' + markup + '</svg>';
      item.insertBefore(icon, label);
    });
    // Scroll edge effect: content fades and softens before it reaches the floating bar.
    const scrollEdge = node('div', 'lg-scroll-edge'); scrollEdge.setAttribute('aria-hidden', 'true');
    nav.parentElement.insertBefore(scrollEdge,nav);

    function animate(el, frames, options) {
      if (!el || reduced() || typeof el.animate !== 'function') return null;
      const previous=elementAnimations.get(el);
      if(previous && previous.playState!=='finished'){
        const current=getComputedStyle(el),first=Object.assign({},frames[0]);
        if(first.opacity!==undefined)first.opacity=current.opacity;
        if(first.transform!==undefined)first.transform=current.transform;
        frames=[first].concat(frames.slice(1));previous.cancel();
      }
      const animation = el.animate(frames, Object.assign({duration:220,easing:'cubic-bezier(.22,1,.36,1)'}, options));
      animations.add(animation);elementAnimations.set(el,animation);
      const done = () => {animations.delete(animation);if(elementAnimations.get(el)===animation)elementAnimations.delete(el);};
      animation.addEventListener('finish', done, {once:true}); animation.addEventListener('cancel', done, {once:true});
      return animation;
    }
    // Selection lens. A tab change stretches the droplet toward the new tab: the leading
    // edge springs ahead, the trailing edge follows, and the lens thins while stretched.
    const lensState = {view:null, anim:null};
    let navDrag = null;
    function lensTarget() {
      const selected = nav.querySelector('.nav-item.active');
      if (!selected) return null;
      const rect=selected.getBoundingClientRect(), frame=nav.getBoundingClientRect(), style=getComputedStyle(nav);
      return {view:selected.dataset.view, x:rect.left-frame.left-parseFloat(style.borderLeftWidth||0),
        y:rect.top-frame.top-parseFloat(style.borderTopWidth||0), w:rect.width, h:rect.height,
        r:getComputedStyle(selected).borderRadius};
    }
    function placeLens(b) {
      lens.style.width=b.w+'px'; lens.style.height=b.h+'px'; lens.style.top=b.y+'px';
      lens.style.borderRadius=b.r; lens.style.transform='translateX('+b.x+'px)';
    }
    function lensVisual() {
      const r=lens.getBoundingClientRect(), frame=nav.getBoundingClientRect(), style=getComputedStyle(nav);
      return {x:r.left-frame.left-parseFloat(style.borderLeftWidth||0), w:r.width};
    }
    function cancelLensMotion() {
      const running = lensState.anim;
      if (!running) return;
      lensState.anim = null; running.cancel(); lens.style.transition = '';
    }
    const leadEase = u => u >= 1 ? 1 : 1 - Math.exp(-8 * u) * Math.cos(7 * u);
    const trailEase = u => { u = Math.max(0, Math.min(1, (u - .1) / .72)); return u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
    function stretchFrames(from, to) {
      const right = to.x > from.x, frames = [], steps = 18;
      const l0 = from.x, r0 = from.x + from.w, l1 = to.x, r1 = to.x + to.w;
      for (let i = 0; i < steps; i++) {
        const u = i / steps, lead = leadEase(u), trail = trailEase(u);
        const l = right ? l0 + (l1 - l0) * trail : l0 + (l1 - l0) * lead;
        const r = right ? r0 + (r1 - r0) * lead : r0 + (r1 - r0) * trail;
        const w = Math.max(to.w * .6, r - l), stretch = Math.max(0, Math.min(1, (w - to.w) / to.w));
        frames.push({offset:u, width:w.toFixed(2) + 'px', transform:'translateX(' + l.toFixed(2) + 'px) scaleY(' + (1 - stretch * .12).toFixed(4) + ')'});
      }
      frames.push({offset:1, width:to.w + 'px', transform:'translateX(' + to.x + 'px) scaleY(1)'});
      return frames;
    }
    function moveLens(from, to) {
      cancelLensMotion();
      lens.style.transition = 'none';
      placeLens(to);
      const motion = lens.animate(stretchFrames(from, to), {duration:340, easing:'linear'});
      lensState.anim = motion; animations.add(motion);
      const done = () => {
        animations.delete(motion);
        if (lensState.anim === motion) { lensState.anim = null; lens.style.transition = ''; }
      };
      motion.addEventListener('finish', done, {once:true}); motion.addEventListener('cancel', done, {once:true});
    }
    function syncLens() {
      const target = lensTarget();
      if (!target) return;
      const changed = lensState.view !== null && lensState.view !== target.view;
      lensState.view = target.view;
      if (navDrag && navDrag.active) return;
      if (!changed || reduced() || typeof lens.animate !== 'function') { cancelLensMotion(); placeLens(target); return; }
      moveLens(lensVisual(), target);
    }
    // Press and slide along the tab bar: the lens lifts, follows the finger and drops on a tab.
    function tabNearest(x) {
      let best = null, distance = Infinity;
      nav.querySelectorAll('.nav-item').forEach(item => {
        const r = item.getBoundingClientRect(), d = Math.abs(x - (r.left + r.width / 2));
        if (d < distance) { distance = d; best = item; }
      });
      return best;
    }
    nav.addEventListener('pointerdown', event => {
      navDrag = null;
      if (!enabled() || reduced() || event.button !== 0 || !event.isPrimary) return;
      const item = event.target.closest && event.target.closest('.nav-item');
      if (item) navDrag = {id:event.pointerId, x:event.clientX, y:event.clientY, active:false};
    }, {passive:true});
    nav.addEventListener('pointermove', event => {
      if (!navDrag || event.pointerId !== navDrag.id) return;
      if (!navDrag.active) {
        const dx = Math.abs(event.clientX - navDrag.x), dy = Math.abs(event.clientY - navDrag.y);
        if (dx < 8 || dx < dy) return;
        navDrag.active = true; cancelLensMotion();
        lens.style.transition = 'none'; lens.classList.add('lg-lifted');
        try { nav.setPointerCapture(event.pointerId); } catch (_) { /* Capture is an enhancement only. */ }
      }
      const target = lensTarget(), frame = nav.getBoundingClientRect(), pad = parseFloat(getComputedStyle(nav).paddingLeft) || 0;
      if (!target) return;
      const x = Math.max(pad, Math.min(frame.width - pad - target.w, event.clientX - frame.left - target.w / 2));
      lens.style.transform = 'translateX(' + x.toFixed(2) + 'px) scale(1.08)';
    }, {passive:true});
    function endNavDrag(event, commit) {
      const drag = navDrag; navDrag = null;
      if (!drag || !drag.active) return;
      lens.classList.remove('lg-lifted');
      try { nav.releasePointerCapture(drag.id); } catch (_) { /* Already released. */ }
      const dropped = commit ? tabNearest(event.clientX) : null, current = nav.querySelector('.nav-item.active');
      if (dropped && dropped !== current) { dropped.click(); return; }
      const target = lensTarget();
      if (target) { if (reduced() || typeof lens.animate !== 'function') { lens.style.transition = ''; placeLens(target); } else moveLens(lensVisual(), target); }
    }
    nav.addEventListener('pointerup', event => endNavDrag(event, true), {passive:true});
    nav.addEventListener('pointercancel', event => endNavDrag(event, false), {passive:true});
    // Specular light follows device tilt. Steps of 2° ignore hand tremor, so a phone
    // held still never repaints the refracting bar.
    if (typeof window.DeviceOrientationEvent === 'function') {
      let tiltFrame = 0, tiltShown = 0, tiltWanted = 0;
      const applyTilt = () => {
        tiltFrame = 0; tiltShown = tiltWanted;
        nav.style.setProperty('--lg-tilt', (tiltShown * .8).toFixed(1) + 'deg');
        nav.style.setProperty('--lg-tilt-x', (tiltShown * 1.2).toFixed(1) + '%');
      };
      window.addEventListener('deviceorientation', event => {
        if (!enabled() || reduced() || document.hidden || typeof event.gamma !== 'number') return;
        tiltWanted = Math.round(Math.max(-30, Math.min(30, event.gamma)) / 2) * 2;
        if (tiltWanted !== tiltShown && !tiltFrame) tiltFrame = requestAnimationFrame(applyTilt);
      }, {passive:true});
    }
    function clearControl(el) {
      if (!el) return;
      el.classList.remove('lg-pressed','lg-hovered');
      ['--lg-x','--lg-y','--lg-sx','--lg-sy','--lg-px','--lg-py','--lg-angle'].forEach(key => el.style.removeProperty(key));
    }
    function release() {
      clearControl(pressed);pressed=null;
      if(pointerFrame){cancelAnimationFrame(pointerFrame);pointerFrame=0;}
      pendingPointer=null;
    }
    function track(el, event, active) {
      if (!el || reduced()) return;
      const rect = el.getBoundingClientRect();
      const optical = V.directionalScale(rect, event.clientX, event.clientY, .15);
      // Glass swells under the finger by about 4px, so small controls flex more than wide ones.
      const grow = active ? Math.max(1.01, Math.min(1.08, 1 + 4 / Math.max(rect.width, rect.height, 1))) : 1;
      el.style.setProperty('--lg-x', optical.x.toFixed(2) + 'px');
      el.style.setProperty('--lg-y', optical.y.toFixed(2) + 'px');
      el.style.setProperty('--lg-sx', (optical.sx * grow).toFixed(4));
      el.style.setProperty('--lg-sy', (optical.sy * grow).toFixed(4));
      el.style.setProperty('--lg-px', Math.max(0,Math.min(100,(event.clientX-rect.left)/rect.width*100)) + '%');
      el.style.setProperty('--lg-py', Math.max(0,Math.min(100,(event.clientY-rect.top)/rect.height*100)) + '%');
      el.style.setProperty('--lg-angle', optical.angle + 'deg');
    }
    function controlFrom(event) {
      return event.target && typeof event.target.closest === 'function' ? event.target.closest(controls) : null;
    }
    document.addEventListener('pointerdown', event => {
      if (!enabled() || event.button !== 0 || !event.isPrimary) return;
      release(); clearControl(hovered); hovered = null;
      pressed = controlFrom(event);
      if (pressed && !reduced()) { pressed.classList.add('lg-pressed'); track(pressed,event,true); }
    }, {passive:true});
    document.addEventListener('pointermove', event => {
      if (!enabled()) return;
      if (pressed && event.pointerType !== 'mouse') {
        // A finger beginning to scroll should release the visual press immediately.
        const rect = pressed.getBoundingClientRect();
        if (event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom) release();
      }
      pendingPointer = {event:event,el:pressed || (event.pointerType==='mouse' ? controlFrom(event) : null)};
      if (pointerFrame) return;
      pointerFrame = requestAnimationFrame(() => {
        pointerFrame = 0;
        const item = pendingPointer;
        if(!item)return;
        if (!pressed && hovered !== item.el) { clearControl(hovered); hovered = item.el; }
        if (item.el && !reduced()) { if(!pressed) item.el.classList.add('lg-hovered'); track(item.el,item.event,!!pressed); }
      });
    }, {passive:true});
    document.addEventListener('pointerup', release, {passive:true});
    document.addEventListener('pointercancel', release, {passive:true});
    document.addEventListener('scroll', release, {capture:true,passive:true});
    window.addEventListener('blur', () => {release();clearControl(hovered);hovered=null;});
    document.addEventListener('keydown', event => {
      if (event.key!=='Enter' && event.key!==' ') return;
      const el = controlFrom(event);
      if (el && !reduced()) { release(); pressed=el; el.classList.add('lg-pressed'); }
    });
    document.addEventListener('keyup', release);

    function settleFoldSurface(fold) {
      if(window.SuikeLiquidUI&&SuikeLiquidUI.refreshOptics)SuikeLiquidUI.refreshOptics();
    }
    function finishFold(fold) {
      const previous = folds.get(fold);
      if (!previous) return;
      folds.delete(fold); previous.animation.cancel();
      fold.open = previous.open; fold.classList.remove('lg-folding');settleFoldSurface(fold);
    }
    document.addEventListener('click', event => {
      const summary = event.target.closest && event.target.closest('summary');
      if (!summary || !summary.parentElement || summary.parentElement.tagName !== 'DETAILS' ||
          reduced() || typeof summary.parentElement.animate !== 'function') return;
      event.preventDefault();
      const fold = summary.parentElement, previous = folds.get(fold);
      const start = fold.getBoundingClientRect().height, open = previous ? !previous.open : !fold.open;
      if (previous) { folds.delete(fold); previous.animation.cancel(); }
      fold.open = true; fold.classList.add('lg-folding');
      const end = open ? fold.getBoundingClientRect().height : summary.getBoundingClientRect().height;
      if (!open && fold.contains(document.activeElement) && document.activeElement!==summary) summary.focus();
      const animation = animate(fold,[{height:start+'px'},{height:end+'px'}],{duration:320,easing:'cubic-bezier(.25,.8,.25,1)'});
      if (!animation) {fold.open=open;fold.classList.remove('lg-folding');settleFoldSurface(fold);return;}
      folds.set(fold,{animation:animation,open:open});
      animation.addEventListener('finish', () => {
        const current=folds.get(fold); if(!current || current.animation!==animation) return;
        folds.delete(fold); fold.open=open; fold.classList.remove('lg-folding');settleFoldSurface(fold);
      },{once:true});
    }, true);
    document.addEventListener('invalid', event => {
      const fold=event.target.closest && event.target.closest('details');
      if(fold){finishFold(fold);fold.open=true;}
    },true);

    // Keep the original render and state handlers; animate only changed navigation.
    const renderTimetable = render;
    render = function () {
      const oldView=lastView, oldDate=lastDate, oldWeek=lastWeek;
      const result=renderTimetable(); syncLens();
      if(oldView && oldView!==activeView) {
        const order=['today','week','settings'], direction=order.indexOf(activeView)>order.indexOf(oldView)?1:-1;
        animate($(activeView+'View'),[{opacity:.4,transform:'translateX('+direction*10+'px)'},{opacity:1,transform:'translateX(0)'}],{duration:220});
      } else if(oldView && (oldDate!==selectedDate || oldWeek!==weekMonday)) {
        const direction=(selectedDate>oldDate?1:-1);
        animate(activeView==='week'?document.querySelector('.week-grid-wrap'):$('agenda'),
          [{opacity:.45,transform:'translateX('+direction*7+'px)'},{opacity:1,transform:'translateX(0)'}],{duration:200});
      }
      lastView=activeView;lastDate=selectedDate;lastWeek=weekMonday;
      return result;
    };
    const originalShowDialog=showDialog;
    function settleGlass(dialog){
      if(glassTimers.has(dialog)){clearTimeout(glassTimers.get(dialog));glassTimers.delete(dialog);}
      dialog.classList.remove('lg-glass-motion');
      if(window.SuikeLiquidUI&&SuikeLiquidUI.refreshOptics)SuikeLiquidUI.refreshOptics();
    }
    showDialog=function(dialog){
      if(closeTimers.has(dialog)){clearTimeout(closeTimers.get(dialog));closeTimers.delete(dialog);}
      dialog.classList.remove('closing');
      if(glassTimers.has(dialog))clearTimeout(glassTimers.get(dialog));
      if(!reduced()){
        dialog.classList.add('lg-glass-motion');
        glassTimers.set(dialog,setTimeout(()=>settleGlass(dialog),430));
      }else settleGlass(dialog);
      if(!dialog.open) originalShowDialog(dialog);
    };
    closeDialog=function(dialog){
      if(!dialog.open) return;
      if(closeTimers.has(dialog)) clearTimeout(closeTimers.get(dialog));
      if(glassTimers.has(dialog)){clearTimeout(glassTimers.get(dialog));glassTimers.delete(dialog);}
      if(reduced() || typeof dialog.close!=='function') {
        dialog.classList.remove('closing','lg-glass-motion');
        if(typeof dialog.close==='function') dialog.close(); else dialog.removeAttribute('open');
        closeTimers.delete(dialog); return;
      }
      dialog.classList.add('closing','lg-glass-motion');
      closeTimers.set(dialog,setTimeout(()=>{closeTimers.delete(dialog);dialog.classList.remove('closing','lg-glass-motion');dialog.close();},170));
    };
    const toast=$('toast'), preview=$('teachingImportPreview');
    const toolsDialog=$('productDialog'),toolsBody=toolsDialog&&toolsDialog.querySelector('.pd-body');
    let toastVisible=!toast.hidden,toastText=toast.textContent, previewVisible=preview && !preview.hidden;
    let toolsOpen=toolsDialog&&toolsDialog.open,toolsStep=toolsDialog&&$('productEyebrow').textContent;
    const observer=new MutationObserver(()=>{
      const nowToast=!toast.hidden, nowPreview=preview && !preview.hidden;
      if(nowToast && (!toastVisible||toastText!==toast.textContent)) animate(toast,[{opacity:0,transform:'translate(-50%,12px) scale(.92)'},{opacity:1,transform:'translate(-50%,0) scale(1)'}],{duration:420,easing:'cubic-bezier(.3,1.32,.5,1)'});
      if(nowPreview && !previewVisible) animate(preview,[{opacity:.4,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}]);
      const nowTools=toolsDialog&&toolsDialog.open,nowStep=toolsDialog&&$('productEyebrow').textContent;
      if(nowTools&&toolsOpen&&nowStep!==toolsStep)animate(toolsBody,[{opacity:.45,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:200});
      toastVisible=nowToast;toastText=toast.textContent;previewVisible=nowPreview;toolsOpen=nowTools;toolsStep=nowStep;
    });
    observer.observe(toast,{attributes:true,attributeFilter:['hidden'],childList:true});
    if(preview) observer.observe(preview,{attributes:true,attributeFilter:['hidden']});
    if(toolsDialog)observer.observe(toolsDialog,{attributes:true,attributeFilter:['open'],childList:true,subtree:true,characterData:true});
    const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
    const preferenceChanged=()=>{
      if(!reduced()) return;
      release();clearControl(hovered);hovered=null;
      document.querySelectorAll('details.lg-folding').forEach(finishFold);
      animations.forEach(animation=>animation.cancel());animations.clear();
      document.querySelectorAll('dialog.closing').forEach(closeDialog);
      document.querySelectorAll('dialog.lg-glass-motion').forEach(settleGlass);
    };
    if(preference.addEventListener) preference.addEventListener('change',preferenceChanged);
    else if(preference.addListener) preference.addListener(preferenceChanged);
    window.addEventListener('resize',()=>requestAnimationFrame(syncLens),{passive:true});
    document.addEventListener('suike-glass-change',()=>{
      preferenceChanged();
      if(enabled()) requestAnimationFrame(syncLens);
    });
    window.SuikeLiquidUI={version:'1.5.3',ready:true,isEnabled:enabled,motionReduced:reduced,refresh:syncLens,upstreamCommit:V.commit};
  })();
