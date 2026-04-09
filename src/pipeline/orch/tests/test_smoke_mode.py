import sys
import unittest
from pathlib import Path
from unittest import mock

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as cache_manager  # noqa: E402


class SmokeModeTest(unittest.TestCase):
    def test_profile_test_parser_accepts_smoke_flag(self) -> None:
        args = cache_manager.build_parser().parse_args(["test", "--smoke"])
        self.assertEqual(args.cmd, "test")
        self.assertFalse(hasattr(args, "profile"))
        self.assertIs(args.smoke, True)

    def test_smoke_flag_only_allowed_for_profile_test(self) -> None:
        with mock.patch.object(cache_manager, "load_manifest", return_value={}):
            with self.assertRaises(SystemExit):
                cache_manager.main(["plan", "--smoke"])

    def test_profile_test_smoke_skips_log_tag_check(self) -> None:
        manifest = {}
        work_dir = Path("/tmp/profile-build")
        workspace = Path("/tmp/profile-workspace")
        primary_spec = {"name": "phonepe_https_interceptor", "log_tag": "HttpInterceptor"}
        with mock.patch.object(cache_manager, "resolve_profile_modules", return_value=["phonepe_https_interceptor"]), \
            mock.patch.object(cache_manager, "profile_build_modules") as build_modules_mock, \
            mock.patch.object(cache_manager, "profile_apk", return_value=work_dir) as apk_mock, \
            mock.patch.object(cache_manager, "resolve_profile_workspace", return_value=workspace), \
            mock.patch.object(cache_manager, "resolve_module_spec", return_value=primary_spec), \
            mock.patch.object(cache_manager, "resolve_test_serial", return_value="emulator-5554"), \
            mock.patch.object(cache_manager, "verify_profile_log_tags") as verify_mock, \
            mock.patch.object(cache_manager, "unified_test") as unified_test_mock:
            cache_manager.profile_test(manifest, "full", "", smoke=True)

        build_modules_mock.assert_called_once_with(manifest, "full")
        apk_mock.assert_called_once_with(manifest, "full", fresh=False, snapshot_version="")
        call = unified_test_mock.call_args
        self.assertEqual(call.args[4], "")
        self.assertEqual(call.args[5], 25)
        self.assertEqual(call.kwargs["start_retries"], 3)
        self.assertEqual(call.kwargs["install_mode"], "reinstall")
        verify_mock.assert_not_called()

    def test_profile_test_full_keeps_existing_behavior(self) -> None:
        manifest = {}
        work_dir = Path("/tmp/profile-build")
        workspace = Path("/tmp/profile-workspace")
        primary_spec = {"name": "phonepe_sigbypass", "log_tag": "SigBypass"}
        with mock.patch.object(cache_manager, "resolve_profile_modules", return_value=["phonepe_sigbypass"]), \
            mock.patch.object(cache_manager, "profile_build_modules") as build_modules_mock, \
            mock.patch.object(cache_manager, "profile_apk", return_value=work_dir) as apk_mock, \
            mock.patch.object(cache_manager, "resolve_module_spec", return_value=primary_spec), \
            mock.patch.object(cache_manager, "resolve_profile_workspace", return_value=workspace), \
            mock.patch.object(cache_manager, "verify_profile_injection") as verify_injection_mock, \
            mock.patch.object(cache_manager, "resolve_test_serial", return_value="emulator-5554"), \
            mock.patch.object(cache_manager, "verify_profile_log_tags") as verify_mock, \
            mock.patch.object(cache_manager, "unified_test") as unified_test_mock:
            cache_manager.profile_test(manifest, "full", "", smoke=False)

        build_modules_mock.assert_called_once_with(manifest, "full")
        apk_mock.assert_called_once_with(manifest, "full", fresh=False, snapshot_version="")
        call = unified_test_mock.call_args
        self.assertEqual(call.args[4], "SigBypass")
        self.assertEqual(call.args[5], 30)
        self.assertEqual(call.kwargs["start_retries"], 3)
        self.assertEqual(call.kwargs["install_mode"], "reinstall")
        verify_injection_mock.assert_called_once_with(manifest, workspace, ["phonepe_sigbypass"])
        verify_mock.assert_called_once_with(manifest, [], "emulator-5554", strict=False)


if __name__ == "__main__":
    unittest.main()
