"""Prepare the APK-only HTML asset; never modify the source website or offline deliverable."""
from pathlib import Path
import argparse
import json
import subprocess
import shutil
import base64

ROOT = Path(__file__).resolve().parent
OLD = """  $('exportData').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json;charset=utf-8' }), url = URL.createObjectURL(blob), link = node('a');
    link.href = url; link.download = '随课备份-' + chinaToday() + '.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); showToast('已导出备份，换设备时可导入');
  });"""
NEW = """  // SUIKE_ANDROID_EXPORT_V1: APK asset only; native system document picker.
  $('exportData').addEventListener('click', () => {
    try {
      M.validateState(state);
      if (!window.SuikeNative || typeof window.SuikeNative.exportBackup !== 'function') {
        showToast('请在随课安卓应用中导出备份');
        return;
      }
      const accepted = window.SuikeNative.exportBackup('随课备份-' + chinaToday() + '.json', JSON.stringify(state, null, 2));
      if (accepted) showToast('请选择 JSON 备份保存位置');
    } catch (error) { showToast('无法开始导出：' + error.message); }
  });"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=ROOT.parents[1] / "outputs" / "随课_离线课表.html")
    parser.add_argument("--output", type=Path, default=ROOT / "assets" / "index.html")
    args = parser.parse_args()
    source = args.input.resolve()
    destination = args.output.resolve()
    (ROOT/'assets/licenses').mkdir(parents=True,exist_ok=True)
    shutil.copy2(ROOT/'licenses/settings-icons.txt',ROOT/'assets/licenses/settings-icons.txt')
    if source == destination or not destination.is_relative_to(ROOT / "assets"):
        raise SystemExit("The output must be a separate file inside android-app/assets.")
    subprocess.run([__import__('sys').executable, str(ROOT.parent / 'portal-import/generate-school-registry.py')], check=True)
    content = source.read_text(encoding="utf-8")
    count = content.count(OLD)
    if count != 1:
        raise SystemExit(f"Expected exactly one unmodified export handler, found {count}; asset not written.")
    patched = content.replace(OLD, NEW, 1)
    sw = "  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('./sw.js').catch(() => { /* The timetable still works without offline installation. */ });"
    if patched.count(sw) != 1:
        raise SystemExit("Expected exactly one service-worker registration; inspect source first.")
    patched = patched.replace(sw, '  // Android APK is self-contained; service-worker registration is unnecessary.', 1)
    # The web and standalone HTML remain unchanged. Import UI and its validated
    # provenance ledger are part of the Android asset only.
    model_return = '    return { schemaVersion: 1, settings, periods, courses, appliedUpdateIds };'
    if patched.count(model_return) != 1:
        raise SystemExit('Model state return changed; inspect before adding import ledger.')
    patched = patched.replace(model_return, '''    const normalizedState = { schemaVersion: 1, settings, periods, courses, appliedUpdateIds };
    if (input.importLedger !== undefined) normalizedState.importLedger = window.JustSafeMerge.validateLedger(input.importLedger);
    if (input.skipLegacyImportBaseline !== undefined) {
      if (typeof input.skipLegacyImportBaseline !== 'boolean') fail('清空课表记录无效');
      normalizedState.skipLegacyImportBaseline = input.skipLegacyImportBaseline;
    }
    if (input.productSettings !== undefined) normalizedState.productSettings = window.SuikeProductCore.validateSettings(input.productSettings);
    return normalizedState;''', 1)
    calibration = '    const changed = sameTerm && current.startMonday === null && confirmed.startMonday !== null;'
    seed_updates = '    if (!sameImportedTerm(state.settings, initial.settings)) return calibrated;'
    render_views = "    ['today', 'week', 'settings'].forEach(view => { $(view + 'View').hidden = view !== activeView; });"
    for marker in (calibration, seed_updates, render_views):
        if patched.count(marker) != 1:
            raise SystemExit('Clear-timetable integration contract changed; asset not written.')
    patched = patched.replace(calibration, calibration.replace('sameTerm &&', 'state.skipLegacyImportBaseline !== true && sameTerm &&'), 1)
    patched = patched.replace(seed_updates, '    if (state.skipLegacyImportBaseline === true || !sameImportedTerm(state.settings, initial.settings)) return calibrated;', 1)
    patched = patched.replace(render_views, render_views + '\n    renderClearTimetableControls();\n    renderProductControls();', 1)
    old_commit = '''  function commit(next, message) {
    const validated = M.validateState(next);
    undoState = clone(state); state = validated; save(); render();
    showToast(message + (storageAvailable ? '' : '；浏览器无法保存，请导出备份'), true);
  }'''
    old_undo = "        state = undoState; undoState = null; save(); render(); showToast('已撤销刚才的修改');"
    boot = '  try {\n    if (!M)'
    detail = "    target.replaceChildren(...content); showDialog($('courseDialog'));"
    stored = '      const stored = localStorage.getItem(STORAGE_KEY);'
    for marker in (old_commit, old_undo, boot, detail, stored):
        if patched.count(marker) != 1:
            raise SystemExit('Product integration contract changed: ' + marker[:60])
    patched = patched.replace(old_commit, '  function commit(next, message) { return productCommit(next, message, true); }', 1)
    patched = patched.replace(old_undo, "        productCommit(undoState, '已撤销刚才的修改', false);", 1)
    patched = patched.replace(boot, '''  let workspaceStore = null, workspaceStorage = null;
  try {
    workspaceStorage = window.SuikeWorkspaceStorage.createStorage(localStorage, window.SuikeNative);
    workspaceStore = window.SuikeWorkspaceEngine.createWorkspaceStore({storage:workspaceStorage, validateState:value=>M.validateState(value), validateLedger:value=>window.JustSafeMerge.validateLedger(value)});
    workspaceStore.recover();
  } catch (recoveryError) {
    window.__suikeBootFail(recoveryError, 'init');
    $('agenda').textContent = '本地保存未能恢复：' + recoveryError.message + '。请保留数据后重新打开。';
    $('statusLine').textContent = '未覆盖本地课表';
    return;
  }
''' + boot, 1)
    old_load = '''    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const loaded = M.applySeedUpdates(JSON.parse(stored), original);
          state = loaded.state;
          if (loaded.changed) save();
        }
        catch (_) { setTimeout(() => showToast('已有本地数据无法读取，当前显示初始课表；原数据未覆盖'), 400); }
      }
    } catch (_) { storageAvailable = false; }'''
    if patched.count(old_load) != 1:
        raise SystemExit('Boot storage contract changed.')
    patched = patched.replace(old_load, '''    const stored = workspaceStorage.getItem(STORAGE_KEY);
    let bootState = state;
    if (stored) bootState = M.applySeedUpdates(JSON.parse(stored), original).state;
    else if (window.SuikeNative && typeof window.SuikeNative.isFreshInstall === 'function' && window.SuikeNative.isFreshInstall()) {
      bootState = M.validateState(window.SuikeProductCore.blankState(original, true));
    }
    workspaceStore.listHistory();
    workspaceStore.listSemesters();
    workspaceStorage.setItem(STORAGE_KEY, JSON.stringify(bootState));
    if (workspaceStorage.hydrateMirror) workspaceStorage.hydrateMirror();
    state = bootState;
    storageAvailable = true;''', 1)
    patched = patched.replace("$('statusLine').textContent = '未修改任何本地数据';", "$('statusLine').textContent = '本地载入未完成，请重新打开后检查';", 1)
    patched = patched.replace(detail, "    target.replaceChildren(...content); renderProductCourseTools(course, date); showDialog($('courseDialog'));", 1)
    old_save = '''      if (JSON.stringify(state) === JSON.stringify(original)) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));'''
    if patched.count(old_save) != 1:
        raise SystemExit('Save integration contract changed.')
    patched = patched.replace(old_save, '      workspaceStorage.setItem(STORAGE_KEY, JSON.stringify(state));', 1)
    # Old handlers must not dismiss an editor if atomic persistence fails.
    patched = patched.replace("      commit(next, conflicts.length ? '已保存；存在课程时间冲突，请查看详情' : '课程已保存'); closeDialog($('editDialog'));", "      if (commit(next, conflicts.length ? '已保存；存在课程时间冲突，请查看详情' : '课程已保存')) closeDialog($('editDialog'));", 1)
    # Minimal hooks preserve the existing course editor and transaction semantics.
    manual_submit = "event.preventDefault(); const form = event.currentTarget, data = new FormData(form);\n    try {"
    if patched.count(manual_submit) != 1:
        raise SystemExit('Manual schedule form integration contract changed.')
    patched = patched.replace(manual_submit, "event.preventDefault(); const form = event.currentTarget;\n    try {\n      if(window.SuikeManualSchedule)SuikeManualSchedule.prepare();\n      const data = new FormData(form);", 1)
    timing = "const timing=window.SuikeCourseTime.resolve(state.periods,$('courseBegin').value,$('courseFinish').value,Number(data.get('start'))||null,Number(data.get('end'))||null,$('pendingTime').checked,$('timeNote').value);"
    if patched.count(timing) != 1:
        raise SystemExit('Manual schedule timing contract changed.')
    patched = patched.replace(timing, timing.replace('const timing=', 'let timing=') + "\n      if(window.SuikeManualSchedule)timing=SuikeManualSchedule.timing(timing);", 1)
    saved = "if (commit(next, conflicts.length ? '已保存；存在课程时间冲突，请查看详情' : '课程已保存')) closeDialog($('editDialog'));"
    if patched.count(saved) != 1:
        raise SystemExit('Manual schedule commit contract changed.')
    patched = patched.replace(saved, "if(commit(next, conflicts.length ? '已保存；存在时间重叠，请查看详情' : (form.dataset.manualKind==='task'?'事务已添加':'课程已保存'))){if(window.SuikeManualSchedule)SuikeManualSchedule.saved();closeDialog($('editDialog'));}", 1)
    # Stable IDs let the inline map select courses without replacing their detail/editor tools.
    for marker, extra in [
        ("const card = button('now-card', '', () => openDetail(current.id, today));", "card.dataset.campusCourseId=current.id;card.dataset.campusDate=today;"),
        ("const card = button('next-card', '', () => openDetail(course.id, date));", "card.dataset.campusCourseId=course.id;card.dataset.campusDate=date;"),
        ("const item = button('agenda-card' + (status.className === 'done' ? ' is-past' : ''), '', () => openDetail(course.id, selectedDate));", "item.dataset.campusCourseId=course.id;item.dataset.campusDate=selectedDate;"),
        ("const item = button('pending-course', '', () => openDetail(course.id, date));", "item.dataset.campusCourseId=course.id;item.dataset.campusDate=date;")]:
        if patched.count(marker) != 1: raise SystemExit('Campus course selection contract changed.')
        patched = patched.replace(marker, marker + extra, 1)
    app_marker = '/* 随课：无账号、无第三方依赖，所有编辑与备份均留在用户设备。 */'
    if patched.count(app_marker) != 1:
        raise SystemExit('App source marker changed; asset not written.')
    import_root = ROOT.parent / 'portal-import'
    modules = '\n'.join((ROOT / name).read_text(encoding='utf-8') for name in ('campus-data.js','campus-core.js','campus-massing.js','campus-renderer.js')) + '\n'
    modules += (ROOT / 'minute-axis.js').read_text(encoding='utf-8') + '\n'
    modules += (ROOT / 'course-pixels-core.js').read_text(encoding='utf-8') + '\n'
    modules += (ROOT / 'course-time-core.js').read_text(encoding='utf-8') + '\n'
    modules += (ROOT / 'period-times.js').read_text(encoding='utf-8') + '\n'
    modules += (ROOT / 'deepseek-core.js').read_text(encoding='utf-8') + '\n'
    modules += (ROOT / 'deepseek-protocol.js').read_text(encoding='utf-8') + '\n'
    modules += '\n'.join((import_root / name).read_text(encoding='utf-8') for name in ('teaching-parser.js', 'safe-merge.js'))
    catalog = (import_root / 'schools.json').read_text(encoding='utf-8')
    registry = (import_root / 'school-adapters.js').read_text(encoding='utf-8').replace('/* SUIKE_SCHOOL_CATALOG */ null', catalog)
    modules += '\n' + (import_root / 'adapters/jsxsd/parser.js').read_text(encoding='utf-8') + '\n' + registry
    modules += '\n' + '\n'.join((ROOT / name).read_text(encoding='utf-8') for name in ('week-interactions-core.js','week-gesture.js'))
    modules += '\n' + '\n'.join((ROOT / 'product' / name).read_text(encoding='utf-8') for name in ('workspace-storage.js', 'product-core.js', 'workspace-engine.js', 'notice-engine.js'))
    patched = patched.replace(app_marker, modules + '\n' + app_marker, 1)
    ending = '  render();\n})();'
    if patched.count(ending) != 1:
        raise SystemExit('App final render changed; asset not written.')
    addon = '\n'.join((ROOT / name).read_text(encoding='utf-8') for name in ('import-addon.js', 'clear-addon.js'))
    addon += '\n' + (ROOT / 'product' / 'product-addon.js').read_text(encoding='utf-8')
    addon += '\n' + (ROOT / 'settings-layout.js').read_text(encoding='utf-8')
    ai_addon = (ROOT / 'deepseek-addon.js').read_text(encoding='utf-8')
    import xml.etree.ElementTree as ET
    icon = ET.fromstring((ROOT / 'deepseek-icon.svg').read_text(encoding='utf-8'))
    ai_addon = ai_addon.replace('/* SUIKE_DEEPSEEK_PATH */ ""', json.dumps(icon.find('{http://www.w3.org/2000/svg}path').get('d')))
    addon += '\n' + ai_addon
    addon += '\n' + (ROOT / 'period-times-addon.js').read_text(encoding='utf-8')
    addon += '\n' + (ROOT / 'appearance.js').read_text(encoding='utf-8')
    addon += '\n' + (ROOT / 'wallpaper-addon.js').read_text(encoding='utf-8')
    addon += '\n' + (ROOT / 'widget-addon.js').read_text(encoding='utf-8')
    addon += '\n' + (ROOT / 'week-fit.js').read_text(encoding='utf-8')
    addon += '\n' + (ROOT / 'liquid-vendor.js').read_text(encoding='utf-8')
    addon += '\n' + (ROOT / 'liquid-ui.js').read_text(encoding='utf-8')
    addon += '\n' + (ROOT / 'liquid-optics.js').read_text(encoding='utf-8')
    addon += '\n' + (ROOT / 'liquid-map-scheduler.js').read_text(encoding='utf-8')
    worker_source = 'self.window=self;\n' + (ROOT/'liquid-optics.js').read_text(encoding='utf-8') + '\n' + (ROOT/'liquid-map-scheduler.js').read_text(encoding='utf-8') + '\n' + (ROOT/'liquid-optics-worker.js').read_text(encoding='utf-8')
    worker_client = (ROOT/'liquid-worker-client.js').read_text(encoding='utf-8').replace('/* SUIKE_OPTICS_WORKER_SOURCE */null', json.dumps(worker_source, ensure_ascii=False))
    addon += '\n' + worker_client
    addon += '\n' + (ROOT / 'shared-glass-scene.js').read_text(encoding='utf-8')
    addon += '\n' + (ROOT / 'liquid-refraction.js').read_text(encoding='utf-8')
    addon += '\n' + (ROOT / 'week-line-color-addon.js').read_text(encoding='utf-8')
    addon += '\n' + (ROOT / 'school-import-addon.js').read_text(encoding='utf-8')
    addon += '\n' + (ROOT / 'pixel-status-addon.js').read_text(encoding='utf-8')
    addon += '\n' + (ROOT / 'week-interactions-addon.js').read_text(encoding='utf-8')
    addon += '\n' + (ROOT / 'pickers-addon.js').read_text(encoding='utf-8')
    addon += '\n' + (ROOT / 'minute-affairs-addon.js').read_text(encoding='utf-8')
    addon += '\n' + (ROOT / 'manual-affairs-addon.js').read_text(encoding='utf-8')
    pixel_frames = (ROOT / 'ambient-frames.json').read_text(encoding='utf-8').replace('<', r'\u003c')
    addon += '\n' + (ROOT / 'course-pixels-addon.js').read_text(encoding='utf-8').replace('/* SUIKE_PIXEL_FRAMES */null', pixel_frames)
    shutil.copy2(ROOT/'vendor/ascii-rest/LICENSE',ROOT/'assets/licenses/ascii-rest-MIT.txt')
    addon += '\n' + (ROOT / 'campus-addon.js').read_text(encoding='utf-8')
    patched = patched.replace(ending, addon + '\n' + ending, 1)
    css = '\n'.join((ROOT / name).read_text(encoding='utf-8') for name in ('import-addon.css', 'clear-addon.css'))
    css += '\n' + (ROOT / 'deepseek-addon.css').read_text(encoding='utf-8')
    css += '\n' + (ROOT / 'product' / 'product-addon.css').read_text(encoding='utf-8')
    css += '\n' + (ROOT / 'settings-layout.css').read_text(encoding='utf-8')
    css += '\n' + (ROOT / 'wallpaper.css').read_text(encoding='utf-8')
    css += '\n' + (ROOT / 'period-times-addon.css').read_text(encoding='utf-8')
    css += '\n' + (ROOT / 'week-fit.css').read_text(encoding='utf-8')
    if patched.count('</style>') != 1:
        raise SystemExit('Expected one bundled stylesheet.')
    liquid_css = (ROOT / 'liquid-ui.css').read_text(encoding='utf-8') + '\n' + (ROOT/'shared-glass-scene.css').read_text(encoding='utf-8')
    patched = patched.replace('</style>', css + '\n</style>\n<style id="suikeLiquidStyles" media="not all">\n' + liquid_css + '\n</style>', 1)
    interaction_css = '\n'.join((ROOT / name).read_text(encoding='utf-8') for name in ('pixel-status.css','week-interactions.css','pickers-addon.css','minute-affairs.css','manual-affairs.css','course-pixels.css','campus-addon.css'))
    patched = patched.replace('</head>', '<style id="suikeInteractionStyles">\n' + interaction_css + '\n</style>\n</head>', 1)
    # Embed the numeric-only face so the APK and one-file preview work offline.
    font_file = ROOT / 'res/font/suike_numbers_regular.ttf'
    font_dir = ROOT / 'assets/fonts'
    font_dir.mkdir(exist_ok=True)
    shutil.copyfile(font_file, font_dir / 'suike_numbers_regular.ttf')
    numeric_src = 'url("fonts/suike_numbers_regular.ttf") format("truetype"),url("data:font/ttf;base64,' + base64.b64encode(font_file.read_bytes()).decode('ascii') + '") format("truetype")'
    numeric_css = (ROOT / 'numerals.css').read_text(encoding='utf-8').replace('__SUIKE_NUMERAL_SRC__', numeric_src)
    patched = patched.replace('</head>', '<style id="suikeNumeralStyles">\n' + numeric_css + '\n</style>\n</head>', 1)
    if patched.count("SUIKE_ANDROID_EXPORT_V1") != 1:
        raise SystemExit("Native export marker verification failed; asset not written.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(patched, encoding="utf-8", newline="\n")
    # This fixed script is read as text only by the separate PortalActivity.
    collector = (import_root / 'teaching-collector.js').read_text(encoding='utf-8')
    (ROOT / 'assets' / 'teaching-collector.js').write_text(collector, encoding='utf-8', newline='\n')
    jsxsd_collector = (import_root / 'adapters/jsxsd/collector.js').read_text(encoding='utf-8')
    for profile in json.loads(catalog)['schools']:
        if profile['protocol'] == 'jsxsd':
            collector = jsxsd_collector + '(' + json.dumps(profile, ensure_ascii=False) + ');'
            (ROOT / 'assets' / profile['collectorAsset']).write_text(collector, encoding='utf-8', newline='\n')
    (ROOT / 'assets' / 'ocr').mkdir(exist_ok=True)
    shutil.copyfile(ROOT / 'product' / 'vendor' / 'chi_sim.traineddata', ROOT / 'assets' / 'ocr' / 'chi_sim.traineddata')
    license_dir = ROOT / 'product' / 'vendor' / 'licenses'
    if license_dir.is_dir():
        shutil.copytree(license_dir, ROOT / 'assets' / 'licenses' / 'ocr', dirs_exist_ok=True)
    subprocess.run(['node', str(ROOT / 'compile-webview.cjs')], check=True)
    print(json.dumps({"source": str(source), "asset": str(destination), "replacedHandlers": count, "bytes": destination.stat().st_size}, ensure_ascii=False))


if __name__ == "__main__":
    main()
