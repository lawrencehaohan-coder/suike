"""Run only on this workspace's isolated API36 AVD; never target a physical device."""
from pathlib import Path
import argparse
import datetime
import hashlib
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
WORK = ROOT.parents[1]
ADB = WORK / 'android-tools/sdk/platform-tools/adb.exe'
AAPT = WORK / 'android-tools/android-15/aapt.exe'
SERIAL = 'emulator-5582'
REPORTS = ROOT / 'reports'
REPORTS.mkdir(exist_ok=True)

def adb(*args, timeout=45):
    return subprocess.run([str(ADB), '-P', '5041', '-s', SERIAL, *args], check=True,
                          capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout).stdout

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apk', type=Path, required=True)
    parser.add_argument('--expected-sha256', required=True)
    args = parser.parse_args()
    apk = args.apk.resolve()
    digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    if digest != args.expected_sha256:
        raise SystemExit('Formal APK hash differs from the explicitly supplied build; no install performed.')
    # Legacy aapt on Windows does not reliably open Unicode APK basenames.
    internal_apk = ROOT / 'build/formal-under-test.apk'
    internal_apk.write_bytes(apk.read_bytes())
    if hashlib.sha256(internal_apk.read_bytes()).hexdigest() != digest:
        raise SystemExit('Internal ASCII test copy differs from the formal APK.')
    device_list = subprocess.run([str(ADB), '-P', '5041', 'devices'], check=True, capture_output=True, text=True).stdout
    entries = [line.split() for line in device_list.splitlines()[1:] if line.strip()]
    if not entries or any(not row[0].startswith('emulator-') for row in entries) or [SERIAL, 'device'] not in entries:
        raise SystemExit('Isolated ADB must contain only emulator devices and the expected API36 serial.')
    if 'Suike_API36' not in adb('emu', 'avd', 'name'):
        raise SystemExit('Expected workspace AVD identity was not found.')
    if adb('shell', 'getprop', 'ro.hardware').strip() != 'ranchu' or adb('shell', 'getprop', 'ro.build.version.sdk').strip() != '36':
        raise SystemExit('Only our own API36 emulator is supported.')
    if adb('shell', 'getprop', 'sys.boot_completed').strip() != '1':
        raise SystemExit('AVD boot is not complete.')
    badging = subprocess.run([str(AAPT), 'dump', 'badging', str(internal_apk)], check=True, capture_output=True, text=True, encoding='utf-8', errors='replace').stdout
    if not re.search(r"package: name='cn\.suike\.timetable' versionCode='15' versionName='1\.5\.3'", badging):
        raise SystemExit('Expected formal 1.5.3 code15 target APK; no install performed.')
    test_apk = ROOT / 'build/suike-import-instrumentation.apk'
    if not test_apk.exists():
        raise SystemExit('Build the internal test APK first.')
    previous_package = adb('shell', 'dumpsys', 'package', 'cn.suike.timetable')
    previous_version = re.search(r'\bversionName=([^\s]+)', previous_package)
    adb('install', '-r', str(internal_apk), timeout=120)
    adb('install', '-r', '-t', str(test_apk), timeout=120)
    previous_animator = adb('shell','settings','get','global','animator_duration_scale').strip()
    if not re.fullmatch(r'[0-9.]+',previous_animator):
        raise SystemExit('Unexpected own-emulator animator setting; no preference changed.')
    try:
        adb('shell','am','force-stop','cn.suike.timetable')
        adb('shell','settings','put','global','animator_duration_scale','1')
        output = adb('shell', 'am', 'instrument', '-w', '-r', 'cn.suike.timetable.tests/.ImportInstrumentation', timeout=240)
        first_match = re.search(r'^INSTRUMENTATION_RESULT: qa_report=(.+)$',output,re.MULTILINE)
        first_report = json.loads(first_match.group(1)) if first_match else None
        reduced_output = None
        if first_report and first_report.get('passed'):
            adb('shell','am','force-stop','cn.suike.timetable')
            adb('shell','settings','put','global','animator_duration_scale','0')
            reduced_output=adb('shell','am','instrument','-w','-r','-e','mode','reduced','cn.suike.timetable.tests/.ImportInstrumentation',timeout=80)
    finally:
        adb('shell','settings','put','global','animator_duration_scale',previous_animator)
    (REPORTS / 'instrumentation-output.txt').write_text(output, encoding='utf-8')
    match = re.search(r'^INSTRUMENTATION_RESULT: qa_report=(.+)$', output, re.MULTILINE)
    if not match:
        print(output)
        raise SystemExit('Instrumentation did not produce a sanitized report.')
    report = json.loads(match.group(1))
    if reduced_output:
        (REPORTS/'reduced-motion-output.txt').write_text(reduced_output,encoding='utf-8')
        reduced_match=re.search(r'^INSTRUMENTATION_RESULT: qa_report=(.+)$',reduced_output,re.MULTILINE)
        if not reduced_match:
            raise SystemExit('Fresh reduced-motion process did not produce a sanitized report.')
        reduced_report=json.loads(reduced_match.group(1))
        report['checks'].extend(reduced_report['checks'])
        report['passed']=report['passed'] and reduced_report['passed']
        report['cleanInitialStateRestored']=report['cleanInitialStateRestored'] and reduced_report['cleanInitialStateRestored']
        if not reduced_report['passed']:
            report.update({k:v for k,v in reduced_report.items() if k.startswith('failure')})
        report['reducedMotionFreshProcess']=True
    screenshots = []
    for name in ('clear-week.png', 'clear-confirm.png', 'clear-empty.png', 'product-tools.png', 'product-notice-preview.png', 'product-occurrence.png',
                 'week-buttons.png', 'settings-compact-light.png', 'settings-compact-dark.png', 'settings-compact-auto.png',
                 'import-compact-light.png', 'import-compact-dark.png', 'import-compact-auto.png',
                 'liquid-week.png','liquid-pressed.png','liquid-settings-light.png','liquid-settings-dark.png',
                 'liquid-today-light.png','liquid-today-dark.png','liquid-dialog.png',
                 'classic-settings-dark.png','classic-week.png','week-conflicts.png','glass-switch.png',
                 'period-editor.png','period-settings.png','period-import-preview.png'):
        try:
            adb('pull', '/sdcard/Android/data/cn.suike.timetable/files/' + name, str(REPORTS / name))
            screenshots.append(name)
        except subprocess.CalledProcessError:
            pass
    report.update({'serial': SERIAL, 'avd': 'Suike_API36', 'adbServerPort': 5041,
                   'targetVersionName': '1.5.3', 'targetVersionCode': 15, 'screenshots': screenshots,
                   'coveredVersionName': previous_version.group(1) if previous_version else None,
                   'emulatorAnimatorScaleRestored': previous_animator,
                   'targetApkSha256': digest, 'testApkSha256': hashlib.sha256(test_apk.read_bytes()).hexdigest(),
                   'testedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                   'testNotes': ['same-signature platform instrumentation',
                                 'no real phone or user browser login accessed',
                                 'export button payload captured by a temporary test bridge; system document picker not exercised',
                                 'own course-only HTML fixture served by a test request interceptor with networking blocked',
                                 'shipping native read button, fixed collector, internal result delivery and preview exercised end to end',
                                 'school server reachability and actual login not exercised on Android']})
    (REPORTS / 'runtime-result-api36.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    adb('shell', 'am', 'force-stop', 'cn.suike.timetable')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report.get('passed') and report.get('cleanInitialStateRestored') else 1

if __name__ == '__main__':
    sys.exit(main())
