"""Build internal same-signature platform instrumentation; never install or start a device."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent
TARGET = ROOT.parents[1]
WORK = ROOT.parents[2]
TOOLS = Path(os.environ.get("SUIKE_ANDROID_TOOLS", WORK / "android-tools"))
JDK = next(p for p in TOOLS.iterdir() if p.is_dir() and (p / "bin/javac.exe").exists())
BT = TOOLS / "android-15"
ANDROID = TOOLS / "android-35/android.jar"
BUILD = ROOT / "build"
CLASSES = BUILD / "classes"
DEX = BUILD / "dex"
for folder in (BUILD, CLASSES, DEX):
    folder.mkdir(parents=True, exist_ok=True)
for stale in CLASSES.rglob("*.class"):
    stale.unlink()
for stale in DEX.glob("*.dex"):
    stale.unlink()
ENV = dict(os.environ, JAVA_HOME=str(JDK))
ENV["PATH"] = str(JDK / "bin") + os.pathsep + ENV["PATH"]

def run(*args):
    subprocess.run([str(a) for a in args], cwd=ROOT, env=ENV, check=True)

run(BT / "aapt2.exe", "link", "-I", ANDROID, "--manifest", ROOT / "AndroidManifest.xml",
    "--min-sdk-version", "26", "--target-sdk-version", "35", "-o", BUILD / "unsigned.apk")
run(JDK / "bin/javac.exe", "-encoding", "UTF-8", "-source", "8", "-target", "8",
    "-bootclasspath", str(ANDROID) + os.pathsep + str(BT / "core-lambda-stubs.jar"),
    "-d", CLASSES, *ROOT.glob("src/**/*.java"))
with zipfile.ZipFile(BUILD / "classes.jar", "w") as archive:
    for file in CLASSES.rglob("*.class"):
        archive.write(file, file.relative_to(CLASSES).as_posix())
run(JDK / "bin/java.exe", "-cp", BT / "lib/d8.jar", "com.android.tools.r8.D8", "--lib", ANDROID,
    "--min-api", "26", "--output", DEX, BUILD / "classes.jar")
with zipfile.ZipFile(BUILD / "unsigned.apk", "a", zipfile.ZIP_DEFLATED) as archive:
    for fixture in (ROOT / "fixtures").glob("*.mp4"):
        archive.write(fixture, "assets/" + fixture.name)
    campus_preview = TARGET / "assets/campus-preview.html"
    if campus_preview.exists():
        archive.write(campus_preview, "assets/campus-preview.html")
    for file in DEX.glob("*.dex"):
        archive.write(file, file.name)
run(BT / "zipalign.exe", "-p", "-f", "4", BUILD / "unsigned.apk", BUILD / "aligned.apk")
APK = BUILD / "suike-native-feature-instrumentation.apk"
run(JDK / "bin/java.exe", "-jar", BT / "lib/apksigner.jar", "sign", "--ks", Path(os.environ.get("SUIKE_SIGNING_KEY", TARGET / "private-signing.p12")),
    "--ks-key-alias", "suike", "--ks-pass", "file:" + str(Path(os.environ.get("SUIKE_SIGNING_PASSWORD_FILE", TARGET / "private-signing-password.txt"))),
    "--v4-signing-enabled", "false", "--out", APK, BUILD / "aligned.apk")
run(BT / "zipalign.exe", "-c", "4", APK)
run(JDK / "bin/java.exe", "-jar", BT / "lib/apksigner.jar", "verify", "--verbose", "--print-certs", APK)
with zipfile.ZipFile(APK) as archive:
    assert archive.testzip() is None
result = {"apk": str(APK), "sha256": hashlib.sha256(APK.read_bytes()).hexdigest(),
          "package": "cn.suike.timetable.featuretests", "target": "cn.suike.timetable",
          "platformInstrumentation": True, "realDeviceRefused": True, "deviceTested": False}
(BUILD / "verification.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(result, ensure_ascii=False))
