from pathlib import Path
import difflib,shutil,sys
android=Path(sys.argv[1]).resolve();root=Path(__file__).resolve().parents[1];base=root.parents[2]
aold=(root/'tools/baselines/android-beta10.html').read_text(encoding='utf-8').splitlines(True)
hold=(root/'tools/baselines/harmony-alpha2.html').read_text(encoding='utf-8').splitlines(True)
new=(android/'work/android-app/assets/index.html').read_text(encoding='utf-8');applied=0
for tag,i,j,k,l in difflib.SequenceMatcher(None,aold,hold,autojunk=False).get_opcodes():
 if tag=='equal':continue
 old=''.join(aold[i:j]);replacement=''.join(hold[k:l])
 if tag=='insert':
  before=''.join(aold[max(0,i-2):i]);after=''.join(aold[i:i+2]);needle=before+after
  if new.count(needle)==1:new=new.replace(needle,before+replacement+after,1)
  elif 'cancelPendingNoticeScreenshot' in replacement:
   marker='  armDialogCancel(productDialog);\n';assert new.count(marker)==1;new=new.replace(marker,marker+replacement,1)
  else:raise RuntimeError('Native insertion no longer matches: '+needle[:100])
 elif new.count(old)==1:new=new.replace(old,replacement,1)
 elif '使用 DeepSeek' in old:pass
 elif '外观跟随' in old:new=new.replace('外观跟随「显示与外观」中的玻璃开关与磨砂程度。','卡片跟随黑白主题；玻璃与磨砂参数会保存，原生卡片目前使用实色背景。')
 else:raise RuntimeError('Native adaptation no longer matches: '+old[:100])
 applied+=1
new=new.replace('  armDialogCancel(productDialog);\n    cancelPendingNoticeScreenshot();','  armDialogCancel(productDialog);')
new=new.replace('  function productOpen(title, action, options) {\n    options = options || {};','  function productOpen(title, action, options) {\n    cancelPendingNoticeScreenshot();\n    options = options || {};')
new=new.replace("img-src 'self' data: blob:;","img-src 'self' data: blob:; media-src blob:;")
# Preserve Harmony alpha3 standard-mode material; only custom wallpaper shares water.
import re
standard=(root/'reference/harmony-standard-glass.css').read_text(encoding='utf-8')
custom=(android/'work/android-app/liquid-ui.css').read_text(encoding='utf-8').split('/* SUIKE_CUSTOM_WATER_V1 */',1)[1]+'\n'+(android/'work/android-app/shared-glass-scene.css').read_text(encoding='utf-8')
new=re.sub(r'(<style id="suikeLiquidStyles"[^>]*>).*?(</style>)',lambda m:m.group(1)+standard+'\n/* SUIKE_CUSTOM_WATER_V1 */'+custom+m.group(2),new,count=1,flags=re.S)
assert new.count('standardDisplayGlass = false')==1 or new.count('standardDisplayGlass=false')==1
new=new.replace('standardDisplayGlass = false','standardDisplayGlass = true').replace('standardDisplayGlass=false','standardDisplayGlass=true')
(root/'entry/src/main/resources/rawfile/index.html').write_text(new,encoding='utf-8',newline='\n')
shutil.copy2(android/'work/android-app/assets/index.html',android/'打开预览.html')
for p in (root/'reference').rglob('*'):
 if p.is_file():
  src=android/p.relative_to(root/'reference')
  if src.is_file():shutil.copy2(src,p)
for name in ['course-time-core.js','wallpaper-addon.js','wallpaper.css','minute-axis.js','minute-affairs-addon.js','minute-affairs.css','manual-affairs-addon.js','manual-affairs.css','liquid-optics-worker.js','liquid-worker-client.js','shared-glass-scene.js','shared-glass-scene.css','course-pixels-core.js','course-pixels-addon.js','course-pixels.css','ambient-frames.json','build-ambient-library.py']:
 shutil.copy2(android/'work/android-app'/name,root/'reference/work/android-app'/name)
shutil.copy2(android/'work/android-app/licenses/settings-icons.txt',root/'entry/src/main/resources/rawfile/settings-icons-license.txt')
print('Synced shared frontend and',applied,'native platform adaptations.')

shutil.copytree(android/'work/android-app/assets/ambient-scenes',root/'entry/src/main/resources/rawfile/ambient-scenes',dirs_exist_ok=True)
shutil.copy2(android/'work/android-app/vendor/ascii-rest/LICENSE',root/'entry/src/main/resources/rawfile/ascii-rest-MIT.txt')

# Campus map is shared code; geometry, evidence and attribution ship with source.
for name in ['campus-data.js','campus-core.js','campus-massing.js','campus-renderer.js','campus-addon.js','campus-addon.css','build-campus-geometry.py','build-campus-preview.py']:
 shutil.copy2(android/'work/android-app'/name,root/'reference/work/android-app'/name)
shutil.copytree(android/'work/android-app/vendor/just-zjg-campus',root/'reference/work/android-app/vendor/just-zjg-campus',dirs_exist_ok=True)
