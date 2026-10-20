  // Appearance is an independent device preference; course checkpoints are untouched.
  (function installAppearancePreference() {
    const KEY = 'suike.appearance.v1';
    // Frost 0 keeps the clear lens; 100 is fully frosted. Older builds ignore the extra field.
    const clampFrost = value => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    let enabled = false, frost = 0;
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (stored && typeof stored.glassEnabled === 'boolean') enabled = stored.glassEnabled;
      if (stored && typeof stored.frost === 'number' && isFinite(stored.frost)) frost = clampFrost(stored.frost);
    } catch (_) { /* A missing or unreadable preference uses the classic appearance. */ }
    const row = node('label', 'appearance-option field-full');
    const text = node('span', 'appearance-copy');
    text.append(node('strong', '', '液态玻璃效果'), node('small', '', '应用与小组件同步'));
    const input = document.createElement('input');
    input.type = 'checkbox'; input.id = 'glassEnabled'; input.setAttribute('role', 'switch');
    input.setAttribute('aria-describedby', 'glassStatus');
    const track = node('span', 'appearance-switch'); track.setAttribute('aria-hidden', 'true');
    row.append(text, input, track);
    const status = node('small', 'appearance-status field-full'); status.id = 'glassStatus';
    status.setAttribute('aria-live', 'polite');
    // Frost slider: shown only with glass on; the tab bar below previews it live.
    const frostRow = node('div', 'appearance-frost field-full'); frostRow.id = 'glassFrostRow';
    const frostHead = node('div', 'appearance-frost-head');
    const frostLabel = node('label', 'appearance-frost-label', '磨砂程度'); frostLabel.setAttribute('for', 'glassFrost');
    const frostValue = node('output', 'appearance-frost-value'); frostValue.id = 'glassFrostValue';
    frostValue.setAttribute('for', 'glassFrost'); frostValue.setAttribute('aria-live', 'polite');
    frostHead.append(frostLabel, frostValue);
    const frostInput = document.createElement('input');
    frostInput.type = 'range'; frostInput.id = 'glassFrost'; frostInput.className = 'appearance-frost-range';
    frostInput.min = '0'; frostInput.max = '100'; frostInput.step = '5';
    frostInput.setAttribute('aria-describedby', 'glassFrostScale');
    const frostScale = node('div', 'appearance-frost-scale'); frostScale.id = 'glassFrostScale';
    frostScale.append(node('span', '', '清透 · 边缘折射'), node('span', '', '磨砂 · 柔化背景'));
    const frostReset = button('text-button appearance-frost-reset', '恢复清透', () => setFrost(0, true));
    frostReset.id = 'glassFrostReset';
    frostRow.append(frostHead, frostInput, frostScale, frostReset);
    const display=node('section','settings-card');display.id='displaySettings';
    const heading=node('h3','','显示与外观');heading.id='displayTitle';display.setAttribute('aria-labelledby','displayTitle');
    const displayHeading=settingsIconHeading(heading,['M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z','M8 21h8m-4-4v4']);
    const grid=node('div','form-grid');grid.append($('theme').closest('label'),row,status,frostRow);display.append(displayHeading,grid);
    $('settingsForm').parentElement.insertBefore(display,$('settingsForm').nextSibling);
    $('theme').addEventListener('change',()=>{const selected=$('theme').value;if(window.SuikeWallpaper&&SuikeWallpaper.selectTheme(selected))return;const next=clone(state);next.settings.theme=selected;commit(next,'外观已更新');});
    foldSettingsCard(display,displayHeading,'settingsDisplayDetails');
    function frostText(value) { return value === 0 ? '清透' : value === 100 ? '磨砂' : value + '%'; }
    // One curve drives every glass surface; the refraction pass reads the same numbers.
    // 0 is fully clear glass (no tint, no blur, rim and edge refraction only). Tint comes
    // first; blur starts halfway so the tab bar centre stays clear through the lower half.
    function frostLevels(value) {
      const f = clampFrost(value === undefined ? frost : value) / 100, upper = Math.max(0, (f - .5) / .5);
      const custom=document.documentElement.dataset.appearance==='custom';
      return {f:f, tint:+(.92 * Math.pow(f, 1.1)).toFixed(3), navBlur:+(.65 + 15 * Math.pow(upper, 1.3)).toFixed(2),
        sheetTint:+(custom?.06 + .86 * Math.pow(f, 1.1):.55 + .37*f).toFixed(3), sheetBlur:+(custom?.8 + 43.2 * Math.pow(f, 1.3):10 + 34*f).toFixed(1),
        edge:+Math.min(1, f * 1.6).toFixed(3), halo:+(1 - f).toFixed(3)};
    }
    function applyFrost() {
      const levels = frostLevels(), root = document.documentElement.style;
      root.setProperty('--lg-frost', levels.f.toFixed(2));
      root.setProperty('--lg-tint', String(levels.tint));
      root.setProperty('--lg-nav-blur', levels.navBlur + 'px');
      root.setProperty('--lg-sheet-tint', String(levels.sheetTint));
      root.setProperty('--lg-sheet-blur', levels.sheetBlur + 'px');
      root.setProperty('--lg-edge-opacity', String(levels.edge));
      root.setProperty('--lg-halo', String(levels.halo));
      frostInput.value = String(frost);
      frostInput.style.setProperty('--lg-range', frost + '%');
      frostInput.setAttribute('aria-valuetext', frostText(frost));
      frostValue.textContent = frostText(frost);
      frostReset.disabled = frost === 0;
    }
    function apply() {
      document.documentElement.dataset.glass = enabled ? 'on' : 'off';
      const style = $('suikeLiquidStyles');
      if (style) style.media = enabled ? 'all' : 'not all';
      input.checked = enabled;
      input.disabled=document.documentElement.dataset.appearance==='custom';
      status.textContent = input.disabled?'自定义背景使用液态玻璃':enabled ? '已开启液态玻璃' : '已关闭液态玻璃';
      frostRow.hidden = !enabled;
      applyFrost();
    }
    function save() {
      try { localStorage.setItem(KEY, JSON.stringify({version:1, glassEnabled:enabled, frost:frost})); return true; }
      catch (_) { status.textContent += ' · 当前设备未能保存此偏好'; return false; }
    }
    function setEnabled(value) {
      if(value!==true&&document.documentElement.dataset.appearance==='custom'){apply();return enabled;}
      const next = value === true;
      if (next === enabled) { apply(); return enabled; }
      enabled = next; apply(); save();
      document.dispatchEvent(new CustomEvent('suike-glass-change', {detail:{enabled:enabled}}));
      return enabled;
    }
    // persist=false while dragging; the final value is written once on release.
    function setFrost(value, persist) {
      const next = clampFrost(value), changed = next !== frost;
      frost = next; applyFrost();
      if (persist !== false) save();
      if (changed) document.dispatchEvent(new CustomEvent('suike-glass-frost', {detail:{frost:frost}}));
      return frost;
    }
    input.addEventListener('change', () => setEnabled(input.checked));
    frostInput.addEventListener('input', () => setFrost(frostInput.value, false));
    frostInput.addEventListener('change', () => setFrost(frostInput.value, true));
    window.SuikeAppearance = {isEnabled:() => enabled, setEnabled:setEnabled, getFrost:() => frost, setFrost:setFrost, frostLevels:frostLevels};
    apply();
  })();
