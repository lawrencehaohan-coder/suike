"""School-adapter checks on the workspace-owned API36 emulator, never a real phone."""
from pathlib import Path
import argparse, hashlib, json, os, re, subprocess

ROOT=Path(__file__).resolve().parent
TOOLS=Path(os.environ.get('SUIKE_ANDROID_TOOLS',ROOT.parents[1]/'android-tools')).resolve()
ADB=TOOLS/'sdk/platform-tools/adb.exe'
SERIAL='emulator-5582'
def adb(*args,timeout=45):
    return subprocess.run([str(ADB),'-P','5041','-s',SERIAL,*args],check=True,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=timeout).stdout
parser=argparse.ArgumentParser();parser.add_argument('--apk',type=Path,required=True);parser.add_argument('--sha256',required=True);parser.add_argument('--version',default='1.6.0-beta.10');parser.add_argument('--mode',choices=('schools','promoted','enhancements','pickers','scopewidget','numerals'),default='promoted');args=parser.parse_args()
apk=args.apk.resolve();digest=hashlib.sha256(apk.read_bytes()).hexdigest()
assert digest==args.sha256,'APK hash mismatch'
devices=subprocess.run([str(ADB),'-P','5041','devices'],check=True,capture_output=True,text=True).stdout
entries=[line.split() for line in devices.splitlines()[1:] if line.strip()]
assert [SERIAL,'device'] in entries and all(row[0].startswith('emulator-') for row in entries),'Isolated emulator required'
assert 'Suike_API36' in adb('emu','avd','name') and adb('shell','getprop','ro.hardware').strip()=='ranchu' and adb('shell','getprop','ro.build.version.sdk').strip()=='36' and adb('shell','getprop','sys.boot_completed').strip()=='1','Owned API36 AVD required'
internal=ROOT/'build/school-under-test.apk';internal.write_bytes(apk.read_bytes())
adb('install','-r',str(internal),timeout=120)
package=adb('shell','dumpsys','package','cn.suike.timetable')
assert re.search(r'\bversionName='+re.escape(args.version)+r'\b',package),'Wrong target version'
test_apk=ROOT/'build/suike-import-instrumentation.apk';adb('install','-r','-t',str(test_apk),timeout=120)
result=adb('shell','am','instrument','-w','-r','-e','mode',args.mode,'cn.suike.timetable.tests/.ImportInstrumentation',timeout=240)
match=re.search(r'^INSTRUMENTATION_RESULT: qa_report=(.+)$',result,re.MULTILINE)
assert match,'No sanitized test report'
report=json.loads(match.group(1));report.update({'targetApkSha256':digest,'testApkSha256':hashlib.sha256(test_apk.read_bytes()).hexdigest(),'version':args.version,'serial':SERIAL,'scope':'owned API36 emulator, actual touch events and synthetic course-only pages; no actual login, physical vibration or Samsung testing'})
reports=ROOT/'reports';reports.mkdir(exist_ok=True);(reports/(args.mode+'-api36.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
if args.mode=='promoted':
    for name in ('beta2-today-light.png','beta2-today-dark.png','beta2-week-after-swap.png'):
        try: adb('pull','/sdcard/Android/data/cn.suike.timetable/files/'+name,str(reports/name))
        except subprocess.CalledProcessError: pass
if args.mode=='enhancements':
    for name in ('guide-just.png','guide-hhu.png','guide-njust.png','settings-entry-classic.png','settings-entry-glass.png','deepseek-settings.png','deepseek-settings-dark.png','deepseek-questions.png','deepseek-preview.png'):
        try: adb('pull','/sdcard/Android/data/cn.suike.timetable/files/'+name,str(reports/name))
        except subprocess.CalledProcessError: pass
if args.mode in ('scopewidget','numerals'):
    for name in ('deepseek-scope.png','deepseek-scoped-preview.png','widget-large-light.png','widget-small-dark.png','widget-glass-clear.png','widget-glass-frost.png','widget-idle-grey.png','widget-2x2-light.png','widget-2x2-glass.png','widget-2x2-dark.png','widget-2x2-idle.png'):
        try: adb('pull','/sdcard/Android/data/cn.suike.timetable/files/'+name,str(reports/name))
        except subprocess.CalledProcessError: pass
if args.mode in ('pickers','numerals'):
    for name in ('picker-theme-light.png','picker-theme-dark.png','picker-theme-glass.png','picker-school.png','picker-week.png','picker-calendar.png','picker-year-month.png','picker-time.png'):
        try: adb('pull','/sdcard/Android/data/cn.suike.timetable/files/'+name,str(reports/name))
        except subprocess.CalledProcessError: pass
if args.mode=='numerals':
    for name in ('numerals-today-light.png','numerals-today-dark.png','numerals-week.png','numerals-today-320.png'):
        adb('pull','/sdcard/Android/data/cn.suike.timetable/files/'+name,str(reports/name))
print(json.dumps(report,ensure_ascii=False,indent=2))
adb('shell','am','force-stop','cn.suike.timetable')
raise SystemExit(0 if report.get('passed') and report.get('cleanInitialStateRestored') else 1)
