"""Responsive UI checks on the already verified APK, on our own AVD only."""
from pathlib import Path
import hashlib, json, re, subprocess
from run import adb, SERIAL, REPORTS, ADB

ROOT=Path(__file__).resolve().parent
runtime=json.loads((REPORTS/'runtime-result-api36.json').read_text(encoding='utf-8'))
apk=ROOT.parents[2]/'outputs/随课_安卓离线版.apk'
assert runtime['passed'] and runtime['targetApkSha256']==hashlib.sha256(apk.read_bytes()).hexdigest()
assert 'Suike_API36' in adb('emu','avd','name')
assert adb('shell','getprop','ro.hardware').strip()=='ranchu'
assert adb('shell','getprop','ro.build.version.sdk').strip()=='36'
entries=subprocess.run([str(ADB),'-P','5041','devices'],check=True,capture_output=True,text=True).stdout
assert [line.split() for line in entries.splitlines()[1:] if line.strip()]==[[SERIAL,'device']]
original_size=adb('shell','wm','size');original_density=adb('shell','wm','density')
original_scale=adb('shell','settings','get','global','animator_duration_scale').strip()
size_override=re.search(r'Override size:\s*(\d+x\d+)',original_size)
density_override=re.search(r'Override density:\s*(\d+)',original_density)
results=[]
try:
    adb('shell','settings','put','global','animator_duration_scale','1')
    for width,height in [(320,800),(360,640),(412,892)]:
        adb('shell','am','force-stop','cn.suike.timetable')
        adb('shell','wm','density','320')
        adb('shell','wm','size',str(width*2)+'x'+str(height*2))
        output=adb('shell','am','instrument','-w','-r','-e','mode','responsive','cn.suike.timetable.tests/.ImportInstrumentation',timeout=100)
        (REPORTS/f'responsive-{width}-output.txt').write_text(output,encoding='utf-8')
        match=re.search(r'^INSTRUMENTATION_RESULT: qa_report=(.+)$',output,re.MULTILINE)
        assert match,output[-500:]
        report=json.loads(match.group(1));report['requestedWidth']=width;results.append(report)
        assert report['passed'] and report['cleanInitialStateRestored'],report
        assert len(report['checks'])==2
        for check in report['checks']:
            assert check['details']['width']==width
        for glass in ('glass','classic'):
            for suffix in ('','-bottom'):
                name=f'week-{width}-{glass}{suffix}.png'
                adb('pull','/sdcard/Android/data/cn.suike.timetable/files/'+name,str(REPORTS/name))
finally:
    adb('shell','wm','size',size_override.group(1) if size_override else 'reset')
    adb('shell','wm','density',density_override.group(1) if density_override else 'reset')
    adb('shell','settings','put','global','animator_duration_scale',original_scale)
    adb('shell','am','force-stop','cn.suike.timetable')
    (REPORTS/'responsive-result-api36.json').write_text(json.dumps({'passed':len(results)==3 and all(r['passed'] for r in results),
        'targetApkSha256':runtime['targetApkSha256'],'checks':sum((r['checks'] for r in results),[]),
        'runs':results,'ownEmulatorSettingsRestored':True},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'passed':True,'checks':6,'widths':[320,360,412],'glassAndClassic':True,'settingsRestored':True}))
