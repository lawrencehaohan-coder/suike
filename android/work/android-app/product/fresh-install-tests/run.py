"""Explicit fresh-install test on this workspace's single isolated API36 AVD.

This intentionally uninstalls ONLY cn.suike.timetable on the guarded emulator.
There is no restore of the former private seed or app data. No action occurs
without --fresh-install, an exact supplied formal APK hash, and all guards.
"""
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
TOOLS = WORK / "android-tools"
ADB = TOOLS / "sdk/platform-tools/adb.exe"
AAPT = TOOLS / "android-15/aapt.exe"
SERIAL = "emulator-5582"
PORT = "5041"
TARGET = "cn.suike.timetable"
COMPONENT = "cn.suike.timetable.freshinstalltests/.FreshInstallInstrumentation"
REPORTS = ROOT / "reports"

def require(condition, code):
    if not condition:
        raise RuntimeError(code)

def adb(*args, timeout=45):
    result = subprocess.run([str(ADB), "-P", PORT, "-s", SERIAL, *args], check=True,
                            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    return result.stdout

def assert_inventory(output):
    entries = [row.split() for row in output.splitlines()[1:] if row.strip()]
    require(entries == [[SERIAL, "device"]], "ONLY_OWN_SINGLE_EMULATOR_ALLOWED")

def guard_device():
    devices = subprocess.run([str(ADB), "-P", PORT, "devices"], check=True,
                             capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=45).stdout
    assert_inventory(devices)
    name = adb("emu", "avd", "name").splitlines()
    require(bool(name) and name[0].strip() == "Suike_API36", "WRONG_AVD_NAME")
    require(adb("shell", "getprop", "ro.hardware").strip() == "ranchu", "WRONG_HARDWARE")
    require(adb("shell", "getprop", "ro.build.version.sdk").strip() == "36", "WRONG_API")
    require(adb("shell", "getprop", "ro.kernel.qemu").strip() == "1", "EMULATOR_FLAG_REQUIRED")
    require(adb("shell", "getprop", "sys.boot_completed").strip() == "1", "AVD_NOT_READY")

def check_hash(path, expected):
    require(bool(re.fullmatch(r"[0-9a-fA-F]{64}", expected)), "EXPECTED_SHA256_REQUIRED")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    require(digest == expected.lower(), "APK_SHA256_MISMATCH")
    return digest

def certificate(apk):
    jdk = next(p for p in TOOLS.iterdir() if p.is_dir() and (p / "bin/java.exe").exists())
    result = subprocess.run([str(jdk / "bin/java.exe"), "-jar", str(TOOLS / "android-15/lib/apksigner.jar"),
                             "verify", "--print-certs", str(apk)], check=True, capture_output=True,
                            text=True, encoding="utf-8", errors="replace", timeout=60).stdout
    matches = re.findall(r"Signer #\d+ certificate SHA-256 digest:\s*([0-9a-fA-F]{64})", result)
    require(len(matches) == 1, "SINGLE_VALID_SIGNER_REQUIRED")
    return matches[0].lower()

def preflight(apk, expected):
    digest = check_hash(apk, expected)
    # Windows legacy aapt cannot reliably open Unicode basenames.
    internal_apk = ROOT / 'build/formal-under-test.apk'
    internal_apk.parent.mkdir(exist_ok=True)
    internal_apk.write_bytes(apk.read_bytes())
    require(check_hash(internal_apk, expected) == digest, 'ASCII_TEST_COPY_MISMATCH')
    apk = internal_apk
    badging = subprocess.run([str(AAPT), "dump", "badging", str(apk)], check=True,
                             capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=45).stdout
    require(bool(re.search(r"package: name='cn\.suike\.timetable' versionCode='9' versionName='1\.4\.0'", badging)), "EXPECTED_VERSION_140_CODE9")
    test_apk = ROOT / "build/suike-fresh-install-instrumentation.apk"
    require(test_apk.is_file(), "BUILD_FRESH_INSTRUMENTATION_FIRST")
    verification = json.loads((ROOT / "build/verification.json").read_text(encoding="utf-8"))
    require(verification.get("package") == "cn.suike.timetable.freshinstalltests", "TEST_PACKAGE_MISMATCH")
    test_digest = check_hash(test_apk, verification.get("sha256", ""))
    require(certificate(apk) == certificate(test_apk), "TARGET_TEST_SIGNATURE_MISMATCH")
    formal_copy = ROOT / "build/formal-under-test.apk"
    formal_copy.write_bytes(apk.read_bytes())
    check_hash(formal_copy, digest)
    return formal_copy, test_apk, digest, test_digest

def instrument(stage):
    output = adb("shell", "am", "instrument", "-w", "-r", "-e", "stage", stage,
                 "-e", "fresh_install_authorized", "true", COMPONENT, timeout=150)
    (REPORTS / (stage + "-instrumentation-output.txt")).write_text(output, encoding="utf-8")
    match = re.search(r"^INSTRUMENTATION_RESULT: qa_report=(.+)$", output, re.MULTILINE)
    require(match is not None, "INSTRUMENTATION_REPORT_MISSING")
    report = json.loads(match.group(1))
    require(report.get("stage") == stage, "INSTRUMENTATION_STAGE_MISMATCH")
    return report

def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--fresh-install", action="store_true", required=True,
                        help="Explicitly authorize removal of the old app/data on ONLY the guarded owned AVD.")
    result.add_argument("--apk", type=Path, required=True)
    result.add_argument("--expected-sha256", required=True)
    return result

def main(argv=None):
    args = parser().parse_args(argv)
    require(args.fresh_install is True, "EXPLICIT_FRESH_INSTALL_REQUIRED")
    REPORTS.mkdir(exist_ok=True)
    report = {"passed": False, "skipped": False, "deviceMutated": False, "freshInstallPerformed": False,
              "firstLaunchPassed": False, "processRestartPassed": False, "finalMainBlank": False,
              "serial": SERIAL, "avd": "Suike_API36", "adbServerPort": int(PORT),
              "targetVersionName": "1.4.0", "targetVersionCode": 9, "phases": []}
    step = "apk_preflight"
    try:
        formal, test_apk, digest, test_digest = preflight(args.apk.resolve(), args.expected_sha256)
        report.update({"targetApkSha256": digest, "testApkSha256": test_digest})
        step = "strict_device_guard"
        guard_device()
        # No device write, stop, uninstall or installation occurs above this line.
        step = "explicit_fresh_install"
        report["deviceMutated"] = True
        if adb("shell", "pm", "path", TARGET).strip():
            require("Success" in adb("uninstall", TARGET, timeout=120), "TARGET_UNINSTALL_FAILED")
        require("Success" in adb("install", str(formal), timeout=120), "FRESH_TARGET_INSTALL_FAILED")
        require("Success" in adb("install", "-r", "-t", str(test_apk), timeout=120), "TEST_INSTALL_FAILED")
        report["freshInstallPerformed"] = True
        step = "first_launch_and_guide"
        first = instrument("first"); report["phases"].append(first)
        report["firstLaunchPassed"] = first.get("passed") is True
        require(report["firstLaunchPassed"], "FIRST_LAUNCH_SUITE_FAILED")
        step = "real_process_stop"
        adb("shell", "am", "force-stop", TARGET)
        step = "relaunch_persistence"
        relaunched = instrument("relaunch"); report["phases"].append(relaunched)
        report["processRestartPassed"] = relaunched.get("passed") is True
        require(report["processRestartPassed"], "RELAUNCH_SUITE_FAILED")
        require(first.get("processId") and relaunched.get("processId") and first["processId"] != relaunched["processId"], "REAL_PROCESS_RESTART_NOT_OBSERVED")
        step = "leave_blank_main_open"
        adb("shell", "am", "force-stop", TARGET)
        adb("shell", "am", "start", "-W", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER", "-n", TARGET + "/.MainActivity", timeout=60)
        report.update({"passed": True, "finalMainBlank": True, "mainLaunchedAfterTests": True})
    except Exception as error:
        report.update({"passed": False, "failureStep": step, "runnerFailureType": type(error).__name__})
        if str(error) and re.fullmatch(r"[A-Z_]{3,80}", str(error)):
            report["failureCode"] = str(error)
    report.update({"testedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                   "testNotes": ["Explicit uninstall is restricted to cn.suike.timetable on the single owned guarded AVD",
                                 "No production flag, JavaScript seed or localStorage was manually reset by instrumentation",
                                 "Real first-install bridge, automatically opened guide and shipping save handler checked",
                                 "Separate instrumentation processes with force-stop verify persisted empty state and completed setup",
                                 "Final installation remains empty; former private baseline is not restored",
                                 "No real phone, portal login, screenshots or browser credentials accessed"]})
    (REPORTS / "runtime-result-api36.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report.get("passed") and report.get("finalMainBlank") else 1

if __name__ == "__main__":
    sys.exit(main())
