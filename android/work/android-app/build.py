"""Build a signed offline timetable APK, including pinned offline Chinese OCR."""
from pathlib import Path
import argparse, hashlib, json, os, secrets, subprocess, sys, zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
PARSER = argparse.ArgumentParser(description=__doc__)
STAGES = PARSER.add_mutually_exclusive_group()
STAGES.add_argument('--compile-only', action='store_true', help='Verify OCR inputs and compile both Java program jars into DEX; do not package or sign')
STAGES.add_argument('--unsigned-only', action='store_true', help='Build and verify build/aligned.apk without signing or writing the release APK')
ARGS = PARSER.parse_args()
VENDOR = ROOT / 'product/vendor'
sys.path.insert(0, str(VENDOR))
from verify_vendor import verify_vendor, verify_apk

OCR_VENDOR = verify_vendor(VENDOR)
OCR_AAR = VENDOR / ('tesseract4android-' + OCR_VENDOR['version'] + '.aar')
OCR_JAR = VENDOR / 'classes.jar'
WORKSPACE = ROOT.parent.parent
TOOLS = Path(os.environ.get('SUIKE_ANDROID_TOOLS', ROOT.parent / 'android-tools')).resolve()
SDK = Path(os.environ.get('ANDROID_SDK_ROOT', os.environ.get('ANDROID_HOME', '')))
if os.environ.get('JAVA_HOME') and (SDK / 'platforms/android-35/android.jar').is_file():
    JDK = Path(os.environ['JAVA_HOME'])
    BT = SDK / 'build-tools/35.0.0'
    ANDROID = SDK / 'platforms/android-35/android.jar'
else:
    JDK = next(p for p in TOOLS.iterdir() if p.is_dir() and (p / 'bin/javac.exe').exists())
    BT = TOOLS / 'android-15'
    ANDROID = TOOLS / 'android-35/android.jar'
BUILD = ROOT / 'build'
BUILD.mkdir(exist_ok=True)
CLASSES = BUILD / 'classes'
CLASSES.mkdir(exist_ok=True)
for stale in CLASSES.rglob('*.class'):
    stale.unlink()
DEX = BUILD / 'dex'
DEX.mkdir(exist_ok=True)
for stale in DEX.glob('*.dex'):
    stale.unlink()
ENV = dict(os.environ, JAVA_HOME=str(JDK))
ENV['PATH'] = str(JDK / 'bin') + os.pathsep + ENV['PATH']
MANIFEST = ET.parse(ROOT / 'AndroidManifest.xml').getroot()
ANDROID_NAME = '{http://schemas.android.com/apk/res/android}name'
INTERNET_PERMISSION = any(element.get(ANDROID_NAME) == 'android.permission.INTERNET'
                          for element in MANIFEST.findall('uses-permission'))

def run(*args):
    subprocess.run([str(a) for a in args], cwd=ROOT, env=ENV, check=True)

def java(*args):
    run(JDK / 'bin/java.exe', *args)

run(JDK / 'bin/javac.exe', '-encoding', 'UTF-8', '-source', '8', '-target', '8',
    '-bootclasspath', str(ANDROID) + os.pathsep + str(BT / 'core-lambda-stubs.jar'),
    '-classpath', OCR_JAR,
    '-d', CLASSES, *ROOT.glob('src/**/*.java'))
with zipfile.ZipFile(BUILD / 'classes.jar', 'w') as archive:
    for path in CLASSES.rglob('*.class'):
        archive.write(path, path.relative_to(CLASSES).as_posix())
java('-cp', BT / 'lib/d8.jar', 'com.android.tools.r8.D8', '--lib', ANDROID,
    '--min-api', '26', '--output', DEX, BUILD / 'classes.jar', OCR_JAR)
if ARGS.compile_only:
    result = {'stage': 'compiled', 'programJars': ['build/classes.jar', 'product/vendor/classes.jar'],
              'dexFiles': sorted(path.name for path in DEX.glob('*.dex')), 'offlineOCR': OCR_VENDOR,
              'deviceTested': False}
    (BUILD / 'ocr-build-verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'stage': 'compiled', 'dexFiles': result['dexFiles'], 'ocrVersion': OCR_VENDOR['version']}, ensure_ascii=False))
    sys.exit(0)

APPLICATION = MANIFEST.find('application')
if APPLICATION is None or APPLICATION.get('{http://schemas.android.com/apk/res/android}extractNativeLibs') != 'false':
    raise ValueError('Offline OCR packaging requires android:extractNativeLibs="false"')
run(BT / 'aapt2.exe', 'compile', '--dir', ROOT / 'res', '-o', BUILD / 'resources.zip')
run(BT / 'aapt2.exe', 'link', '-I', ANDROID, '--manifest', ROOT / 'AndroidManifest.xml',
    '--min-sdk-version', '26', '--target-sdk-version', '35', '-A', ROOT / 'assets',
    '-o', BUILD / 'unsigned.apk', BUILD / 'resources.zip')
with zipfile.ZipFile(BUILD / 'unsigned.apk', 'a', zipfile.ZIP_DEFLATED) as archive:
    for path in DEX.glob('*.dex'):
        archive.write(path, path.name)
    with zipfile.ZipFile(OCR_AAR) as aar:
        for library in OCR_VENDOR['nativeLibraries']:
            archive.writestr(library['apkEntry'], aar.read(library['aarEntry']), compress_type=zipfile.ZIP_STORED)
run(BT / 'zipalign.exe', '-P', '16', '-f', '4', BUILD / 'unsigned.apk', BUILD / 'aligned.apk')
run(BT / 'zipalign.exe', '-c', '-P', '16', '4', BUILD / 'aligned.apk')
OCR_PACKAGING = verify_apk(BUILD / 'aligned.apk', VENDOR, OCR_VENDOR)
if ARGS.unsigned_only:
    result = {'stage': 'unsigned', 'apk': str(BUILD / 'aligned.apk'), 'offlineOCR': OCR_VENDOR,
              'ocrPackaging': OCR_PACKAGING, 'deviceTested': False}
    (BUILD / 'ocr-build-verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'stage': 'unsigned', 'apk': 'build/aligned.apk', 'sha256': OCR_PACKAGING['sha256'],
                      'size': OCR_PACKAGING['size'], 'nativeLibraryCount': OCR_PACKAGING['nativeLibraryCount']}, ensure_ascii=False))
    sys.exit(0)
KEYSTORE = Path(os.environ.get('SUIKE_SIGNING_KEY', ROOT / 'private-signing.p12')).resolve()
PASSFILE = Path(os.environ.get('SUIKE_SIGNING_PASSWORD_FILE', ROOT / 'private-signing-password.txt')).resolve()
if not KEYSTORE.is_file() or not PASSFILE.is_file():
    raise SystemExit('Existing release signing files are required; never generate a replacement update key.')
APK = Path(os.environ.get('SUIKE_APK_OUTPUT', WORKSPACE / 'outputs/随课_安卓离线版_1.6.0-beta.28.apk')).resolve()
APK.parent.mkdir(parents=True, exist_ok=True)
java('-jar', BT / 'lib/apksigner.jar', 'sign', '--ks', KEYSTORE,
    '--ks-key-alias', 'suike', '--ks-pass', 'file:' + str(PASSFILE),
    '--v4-signing-enabled', 'false', '--out', APK, BUILD / 'aligned.apk')
run(BT / 'zipalign.exe', '-c', '-P', '16', '4', APK)
java('-jar', BT / 'lib/apksigner.jar', 'verify', '--verbose', '--print-certs', APK)
OCR_PACKAGING = verify_apk(APK, VENDOR, OCR_VENDOR)
with zipfile.ZipFile(APK) as archive:
    assert archive.testzip() is None
    assert {'assets/index.html', 'classes.dex', 'AndroidManifest.xml'} <= set(archive.namelist())
result = {'apk': APK.name, 'size': APK.stat().st_size,
          'sha256': hashlib.sha256(APK.read_bytes()).hexdigest(),
          'package': 'cn.suike.timetable', 'minAndroid': '8.0', 'minSdk': 26,
          'versionName': MANIFEST.get('{http://schemas.android.com/apk/res/android}versionName'),
          'versionCode': int(MANIFEST.get('{http://schemas.android.com/apk/res/android}versionCode')),
          'targetSdk': 35, 'internetPermission': INTERNET_PERMISSION,
          'offlineOCR': OCR_VENDOR, 'ocrPackaging': OCR_PACKAGING,
          'deviceTested': False}
(BUILD / 'apk-verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False))
