"""Run on this workspace's isolated API36 AVD, restoring notification permission afterwards."""
from pathlib import Path
import argparse
import datetime
import hashlib
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
WORK = ROOT.parents[2]
ADB = WORK / "android-tools/sdk/platform-tools/adb.exe"
AAPT = WORK / "android-tools/android-15/aapt.exe"
SERIAL = "emulator-5582"
TARGET = "cn.suike.timetable"
REPORTS = ROOT / "reports"

def adb(*args, timeout=45):
    result = subprocess.run([str(ADB), "-P", "5041", "-s", SERIAL, *args], check=True,
                            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    return result.stdout

def notification_granted():
    package = adb("shell", "dumpsys", "package", TARGET)
    match = re.search(r"android\.permission\.POST_NOTIFICATIONS:\s*granted=(true|false)", package)
    if not match:
        raise RuntimeError("Cannot determine current notification permission; no grant/revoke attempted.")
    return match.group(1) == "true"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--expected-sha256", required=True)
    args = parser.parse_args()
    apk = args.apk.resolve()
    digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    if digest != args.expected_sha256:
        raise SystemExit("Target APK differs from the explicitly supplied hash; no installation performed.")
    devices = subprocess.run([str(ADB), "-P", "5041", "devices"], check=True, capture_output=True, text=True).stdout
    entries = [row.split() for row in devices.splitlines()[1:] if row.strip()]
    if not entries or any(not row[0].startswith("emulator-") for row in entries) or [SERIAL, "device"] not in entries:
        raise SystemExit("Isolated ADB must contain only emulators and our expected serial.")
    if "Suike_API36" not in adb("emu", "avd", "name"):
        raise SystemExit("Expected workspace API36 AVD was not found.")
    if adb("shell", "getprop", "ro.hardware").strip() != "ranchu" or adb("shell", "getprop", "ro.build.version.sdk").strip() != "36":
        raise SystemExit("Only our own API36 emulator is supported.")
    if adb("shell", "getprop", "sys.boot_completed").strip() != "1":
        raise SystemExit("AVD is not ready.")
    formal_copy = ROOT / "build/formal-under-test.apk"
    formal_copy.write_bytes(apk.read_bytes())
    badging = subprocess.run([str(AAPT), "dump", "badging", str(formal_copy)], check=True,
                             capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    if not re.search(r"package: name='cn\.suike\.timetable' versionCode='9' versionName='1\.4\.0'", badging):
        raise SystemExit("Expected target version 1.4.0/code9; no installation performed.")
    test_apk = ROOT / "build/suike-native-feature-instrumentation.apk"
    if not test_apk.is_file():
        raise SystemExit("Build the internal instrumentation APK first.")
    adb("install", "-r", str(formal_copy), timeout=120)
    adb("install", "-r", "-t", str(test_apk), timeout=120)
    originally_granted = notification_granted()
    report = {"passed": False, "nativeSnapshotRestored": False}
    output = ""
    REPORTS.mkdir(exist_ok=True)
    try:
        if not originally_granted:
            adb("shell", "pm", "grant", TARGET, "android.permission.POST_NOTIFICATIONS")
        if not notification_granted():
            raise RuntimeError("Notification pre-grant failed.")
        output = adb("shell", "am", "instrument", "-w", "-r",
                     "cn.suike.timetable.featuretests/.FeatureInstrumentation", timeout=180)
        match = re.search(r"^INSTRUMENTATION_RESULT: qa_report=(.+)$", output, re.MULTILINE)
        if not match:
            raise RuntimeError("Instrumentation did not produce a sanitized report.")
        report = json.loads(match.group(1))
    except (RuntimeError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        report.update({"passed": False, "runnerFailureType": type(error).__name__})
    finally:
        (REPORTS / "instrumentation-output.txt").write_text(output, encoding="utf-8")
        adb("shell", "am", "force-stop", TARGET)
        if not originally_granted:
            adb("shell", "pm", "revoke", TARGET, "android.permission.POST_NOTIFICATIONS")
        report["originalNotificationPermissionGranted"] = originally_granted
        report["notificationPermissionRestored"] = notification_granted() == originally_granted
    report.update({"serial": SERIAL, "avd": "Suike_API36", "adbServerPort": 5041,
                   "targetVersionName": "1.4.0", "targetVersionCode": 9,
                   "targetApkSha256": digest, "testApkSha256": hashlib.sha256(test_apk.read_bytes()).hexdigest(),
                   "testedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                   "testNotes": ["same-signature platform instrumentation calls shipping native classes",
                                 "fixed synthetic Chinese image supplied by the internal test ContentProvider",
                                 "desktop widget provider and pin API must be absent",
                                 "real NotificationManager publication checked after production alarm receiver invocation",
                                 "AlarmManager window wakeup timing, OEM battery behavior and real device behavior not measured",
                                 "no real phone, school login, user screenshots or browser credentials accessed"]})
    (REPORTS / "runtime-result-api36.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report.get("passed") and report.get("nativeSnapshotRestored") and report.get("notificationPermissionRestored") else 1

if __name__ == "__main__":
    sys.exit(main())
