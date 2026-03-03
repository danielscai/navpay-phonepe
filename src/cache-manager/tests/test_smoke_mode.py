import sys
import unittest
from pathlib import Path
from unittest import mock

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import cache_manager  # noqa: E402


class SmokeModeTest(unittest.TestCase):
    def test_profile_test_parser_accepts_smoke_flag(self) -> None:
        args = cache_manager.build_parser().parse_args(["profile", "full", "test", "--smoke"])
        self.assertEqual(args.cmd, "profile")
        self.assertEqual(args.name, "full")
        self.assertEqual(args.action, "test")
        self.assertIs(args.smoke, True)

    def test_smoke_flag_only_allowed_for_profile_test(self) -> None:
        with mock.patch.object(cache_manager, "load_manifest", return_value={}):
            with self.assertRaises(RuntimeError) as exc:
                cache_manager.main(["profile", "full", "plan", "--smoke"])
        self.assertIn("only supported", str(exc.exception))

    def test_profile_test_smoke_skips_log_tag_check(self) -> None:
        manifest = {}
        work_dir = Path("/tmp/profile-build")
        primary_spec = {"name": "phonepe_https_interceptor", "log_tag": "HttpInterceptor"}
        with mock.patch.object(cache_manager, "resolve_profile_modules", return_value=["phonepe_https_interceptor"]), \
            mock.patch.object(cache_manager, "profile_compile", return_value=work_dir), \
            mock.patch.object(cache_manager, "resolve_module_spec", return_value=primary_spec), \
            mock.patch.object(cache_manager, "resolve_test_serial", return_value="emulator-5554"), \
            mock.patch.object(cache_manager, "verify_profile_log_tags") as verify_mock, \
            mock.patch.object(cache_manager, "unified_test") as unified_test_mock:
            cache_manager.profile_test(manifest, "https-only", "", smoke=True)

        call = unified_test_mock.call_args
        self.assertEqual(call.args[4], "")
        self.assertEqual(call.args[5], cache_manager.SMOKE_TIMEOUT_SEC)
        self.assertEqual(call.kwargs["start_retries"], 1)
        self.assertIs(call.kwargs["uninstall_before_install"], True)
        verify_mock.assert_not_called()

    def test_profile_test_full_keeps_existing_behavior(self) -> None:
        manifest = {}
        work_dir = Path("/tmp/profile-build")
        primary_spec = {"name": "phonepe_sigbypass", "log_tag": "SigBypass"}
        with mock.patch.object(cache_manager, "resolve_profile_modules", return_value=["phonepe_sigbypass"]), \
            mock.patch.object(cache_manager, "profile_compile", return_value=work_dir), \
            mock.patch.object(cache_manager, "resolve_module_spec", return_value=primary_spec), \
            mock.patch.object(cache_manager, "resolve_test_serial", return_value="emulator-5554"), \
            mock.patch.object(cache_manager, "verify_profile_log_tags") as verify_mock, \
            mock.patch.object(cache_manager, "unified_test") as unified_test_mock:
            cache_manager.profile_test(manifest, "full", "", smoke=False)

        call = unified_test_mock.call_args
        self.assertEqual(call.args[4], "SigBypass")
        self.assertEqual(call.args[5], cache_manager.DEFAULT_TIMEOUT_SEC)
        self.assertEqual(call.kwargs["start_retries"], 3)
        self.assertIs(call.kwargs["uninstall_before_install"], True)
        verify_mock.assert_called_once_with(manifest, [], "emulator-5554", strict=False)


if __name__ == "__main__":
    unittest.main()
