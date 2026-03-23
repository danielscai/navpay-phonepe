import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
CACHE_MANAGER_SCRIPT = CACHE_MANAGER_DIR / "orchestrator.py"

sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as cache_manager  # noqa: E402


class CliBackcompatTest(unittest.TestCase):
    def test_top_level_plan_parser_contract(self) -> None:
        parser = cache_manager.build_parser()

        args = parser.parse_args(["plan"])
        self.assertEqual(args.cmd, "plan")
        self.assertEqual(args.profile, "full")

    def test_legacy_alias_subcommands_exist(self) -> None:
        parser = cache_manager.build_parser()

        for alias in ("sigbypass", "https", "phonepehelper"):
            args = parser.parse_args([alias])
            self.assertEqual(args.cmd, alias)
            self.assertEqual(args.action, "test")
            self.assertIs(args.delete, False)

    def test_legacy_alias_dispatches_via_compatibility_wrapper(self) -> None:
        manifest = {"phonepe_sigbypass": {"deps": []}}

        with mock.patch.object(cache_manager, "load_manifest", return_value=manifest), \
            mock.patch.object(cache_manager, "dispatch_legacy_alias") as dispatch_mock:
            cache_manager.main(["sigbypass", "compile"])

        dispatch_mock.assert_called_once()
        dispatch_manifest, dispatch_args = dispatch_mock.call_args.args
        self.assertEqual(dispatch_manifest, manifest)
        self.assertEqual(dispatch_args.cmd, "sigbypass")
        self.assertEqual(dispatch_args.action, "compile")

    def test_legacy_alias_dispatches_to_expected_module(self) -> None:
        manifest = {
            "phonepe_sigbypass": {"deps": []},
            "phonepe_https_interceptor": {"deps": []},
            "phonepe_phonepehelper": {"deps": []},
        }

        with mock.patch.object(cache_manager, "load_manifest", return_value=manifest), \
            mock.patch.object(cache_manager, "resolve_module_spec") as resolve_mock, \
            mock.patch.object(cache_manager, "run_module_action") as run_mock:
            resolve_mock.side_effect = [
                {"name": "phonepe_sigbypass"},
                {"name": "phonepe_https_interceptor"},
                {"name": "phonepe_phonepehelper"},
            ]

            cache_manager.main(["sigbypass", "compile"])
            cache_manager.main(["https", "inject", "--serial", "emulator-5554", "-d"])
            cache_manager.main(["phonepehelper", "rerun"])

        resolve_mock.assert_has_calls(
            [
                mock.call(manifest, "phonepe_sigbypass"),
                mock.call(manifest, "phonepe_https_interceptor"),
                mock.call(manifest, "phonepe_phonepehelper"),
            ]
        )
        run_mock.assert_has_calls(
            [
                mock.call({"name": "phonepe_sigbypass"}, "compile", False, ""),
                mock.call({"name": "phonepe_https_interceptor"}, "inject", True, "emulator-5554"),
                mock.call({"name": "phonepe_phonepehelper"}, "rerun", False, ""),
            ]
        )

    def test_profile_plan_validates_manifest_membership(self) -> None:
        manifest = {"phonepe_sigbypass": {"deps": []}}
        with mock.patch.object(cache_manager, "load_manifest", return_value=manifest), \
            mock.patch.object(cache_manager, "resolve_profile", return_value=["ghost_module"]):
            with self.assertRaises(RuntimeError) as exc:
                cache_manager.main(["plan"])
        self.assertIn("unknown modules", str(exc.exception).lower())

    def test_validate_cache_integrity_fails_when_smali_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            source_root = root / "source"
            cache_root = root / "cache"
            source_root.mkdir(parents=True)
            cache_root.mkdir(parents=True)
            (source_root / "smali").mkdir()
            (cache_root / "apktool.yml").write_text("sdkInfoVersion: '1'\n", encoding="utf-8")

            with self.assertRaises(RuntimeError) as exc:
                cache_manager.validate_cache_integrity(cache_root, source_root, "TEST")

            self.assertIn("missing smali/", str(exc.exception))

    def test_profile_test_uses_https_tag_for_https_only_profile(self) -> None:
        manifest = {}
        work_dir = Path("/tmp/profile-build")
        with mock.patch.object(cache_manager, "resolve_profile_modules", return_value=["phonepe_https_interceptor"]), \
            mock.patch.object(cache_manager, "profile_build_modules"), \
            mock.patch.object(cache_manager, "profile_compile", return_value=work_dir), \
            mock.patch.object(cache_manager, "resolve_module_spec", return_value={"name": "phonepe_https_interceptor", "log_tag": "HttpInterceptor"}), \
            mock.patch.object(cache_manager, "resolve_test_serial", return_value="emulator-5554"), \
            mock.patch.object(cache_manager, "verify_profile_log_tags"), \
            mock.patch.object(cache_manager, "unified_test") as unified_test_mock:
            cache_manager.profile_test(manifest, "https-only", "")

        self.assertEqual(unified_test_mock.call_args.args[4], "HttpInterceptor")

    def test_profile_test_uses_phonepehelper_tag_for_phonepehelper_only_profile(self) -> None:
        manifest = {}
        work_dir = Path("/tmp/profile-build")
        with mock.patch.object(cache_manager, "resolve_profile_modules", return_value=["phonepe_phonepehelper"]), \
            mock.patch.object(cache_manager, "profile_build_modules"), \
            mock.patch.object(cache_manager, "profile_compile", return_value=work_dir), \
            mock.patch.object(cache_manager, "resolve_module_spec", return_value={"name": "phonepe_phonepehelper", "log_tag": "PPHelper"}), \
            mock.patch.object(cache_manager, "resolve_test_serial", return_value="emulator-5554"), \
            mock.patch.object(cache_manager, "verify_profile_log_tags"), \
            mock.patch.object(cache_manager, "unified_test") as unified_test_mock:
            cache_manager.profile_test(manifest, "phonepehelper-only", "")

        self.assertEqual(unified_test_mock.call_args.args[4], "PPHelper")

    def test_verify_profile_log_tags_skips_non_required_runtime_tags(self) -> None:
        manifest = {}
        with mock.patch.object(
            cache_manager,
            "resolve_module_spec",
            return_value={"name": "phonepe_https_interceptor", "log_tag": "HttpInterceptor", "runtime_log_required": False},
        ), mock.patch.object(
            cache_manager.subprocess,
            "check_output",
        ) as check_output_mock:
            result = cache_manager.verify_profile_log_tags(manifest, ["phonepe_https_interceptor"], "emulator-5554")

        self.assertIs(result, True)
        check_output_mock.assert_not_called()

    @unittest.skipUnless(os.environ.get("RUN_EMU_TESTS") == "1", "Requires adb/emulator")
    def test_legacy_aliases_run_real_commands_when_enabled(self) -> None:
        commands = [
            ["sigbypass", "test", "--serial", "emulator-5554"],
            ["https", "test", "--serial", "emulator-5554"],
            ["phonepehelper", "test", "--serial", "emulator-5554"],
        ]
        for args in commands:
            proc = subprocess.run(
                [sys.executable, str(CACHE_MANAGER_SCRIPT), *args],
                cwd=str(ROOT),
                text=True,
                capture_output=True,
            )
            self.assertEqual(
                proc.returncode,
                0,
                msg=f"command failed: {' '.join(args)}\\nstdout:\\n{proc.stdout}\\nstderr:\\n{proc.stderr}",
            )


if __name__ == "__main__":
    unittest.main()
