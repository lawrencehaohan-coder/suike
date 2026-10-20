"""CPU-only guard checks. No ADB command, emulator or APK installation runs."""
import contextlib
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("fresh_runner", ROOT / "run.py")
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)

class RunnerGuards(unittest.TestCase):
    def test_explicit_fresh_flag_is_required_before_any_command(self):
        with patch.object(RUNNER.subprocess, "run") as command, contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                RUNNER.parser().parse_args(["--apk", "unused.apk", "--expected-sha256", "0" * 64])
            command.assert_not_called()

    def test_only_exact_single_own_emulator_is_accepted(self):
        RUNNER.assert_inventory("List of devices attached\nemulator-5582\tdevice\n")
        for inventory in ["", "List of devices attached\n", "List of devices attached\nphysical123\tdevice\n",
                          "List of devices attached\nemulator-5554\tdevice\n",
                          "List of devices attached\nemulator-5582\toffline\n",
                          "List of devices attached\nemulator-5582\tdevice\nphysical123\tdevice\n",
                          "List of devices attached\nemulator-5582\tdevice\nemulator-5554\tdevice\n"]:
            with self.subTest(inventory=inventory), self.assertRaisesRegex(RuntimeError, "ONLY_OWN_SINGLE_EMULATOR_ALLOWED"):
                RUNNER.assert_inventory(inventory)

    def test_target_hash_mismatch_and_malformed_hash_fail(self):
        existing = ROOT / "AndroidManifest.xml"
        for expected in ["", "not-a-hash", "0" * 64]:
            with self.subTest(expected=expected), self.assertRaises(RuntimeError):
                RUNNER.check_hash(existing, expected)

    def test_build_and_runner_address_only_separate_namespace_and_fixed_target(self):
        self.assertEqual(RUNNER.TARGET, "cn.suike.timetable")
        self.assertEqual(RUNNER.PORT, "5041")
        self.assertEqual(RUNNER.SERIAL, "emulator-5582")
        self.assertEqual(RUNNER.COMPONENT, "cn.suike.timetable.freshinstalltests/.FreshInstallInstrumentation")
        self.assertNotIn("portal-import", str(RUNNER.ROOT))

if __name__ == "__main__":
    unittest.main()
