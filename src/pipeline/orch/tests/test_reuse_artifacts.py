import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as cache_manager  # noqa: E402


class ReuseArtifactsTest(unittest.TestCase):
    def test_compute_inputs_fingerprint_ignores_mtime_only_changes(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            workspace = Path(tempdir) / "workspace"
            workspace.mkdir(parents=True)
            smali_file = workspace / "smali" / "Demo.smali"
            smali_file.parent.mkdir(parents=True)
            smali_file.write_text(".class public LDemo;\n", encoding="utf-8")

            before = cache_manager.compute_inputs_fingerprint(workspace)
            stat = smali_file.stat()
            os.utime(
                smali_file,
                ns=(stat.st_atime_ns + 1_000_000_000, stat.st_mtime_ns + 1_000_000_000),
            )
            after = cache_manager.compute_inputs_fingerprint(workspace)

            self.assertEqual(
                before,
                after,
                "mtime-only updates should not invalidate profile apk reuse fingerprint",
            )

    def test_fresh_flag_is_exposed_for_profile_apk(self) -> None:
        args = cache_manager.build_parser().parse_args([
            "apk",
            "--fresh",
        ])
        self.assertIs(args.fresh, True)
        self.assertEqual(args.profile, "full")

    def test_profile_test_parser_accepts_split_session_install_mode(self) -> None:
        args = cache_manager.build_parser().parse_args([
            "test",
            "--install-mode",
            "split-session",
        ])
        self.assertEqual(args.cmd, "test")
        self.assertEqual(args.install_mode, "split-session")

    def test_parse_test_mode_tokens_maps_numeric_serial_port(self) -> None:
        smoke, install_mode, serial = cache_manager.parse_test_mode_tokens(
            ["smoke", "clean", "5554"],
            smoke=False,
            install_mode="reinstall",
            serial="",
        )
        self.assertTrue(smoke)
        self.assertEqual(install_mode, "clean")
        self.assertEqual(serial, "emulator-5554")

    def test_normalize_serial_alias_maps_huawei_to_default_physical_device(self) -> None:
        self.assertEqual(
            cache_manager.normalize_serial_alias("huawei"),
            "GSLDU18106001520",
        )

    def test_profile_apk_reuse_cache_hit_skips_rebuild(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            workspace = root / "workspace"
            work_dir = root / "build"
            workspace.mkdir(parents=True)
            work_dir.mkdir(parents=True)

            signed_apk = work_dir / cache_manager.DEFAULT_SIGNED_APK
            signed_apk.write_text("signed", encoding="utf-8")
            state_path = work_dir / cache_manager.REUSE_STATE_FILE
            state_path.write_text(
                json.dumps({"fingerprint": "fp1"}, ensure_ascii=True),
                encoding="utf-8",
            )

            with mock.patch.object(cache_manager, "resolve_profile_workspace", return_value=workspace), \
                mock.patch.object(cache_manager, "profile_merge", return_value=workspace), \
                mock.patch.object(cache_manager, "profile_build_path", return_value=work_dir), \
                mock.patch.object(cache_manager, "compute_profile_reuse_fingerprint", return_value="fp1"), \
                mock.patch.object(cache_manager, "ensure_profile_release_splits_signed") as ensure_splits_mock, \
                mock.patch.object(cache_manager, "sigbypass_compile") as compile_mock:
                out_dir = cache_manager.profile_apk({}, "full", fresh=False)

            self.assertEqual(out_dir, work_dir)
            compile_mock.assert_not_called()
            ensure_splits_mock.assert_called_once()

    def test_profile_apk_reuse_cache_miss_runs_rebuild(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            workspace = root / "workspace"
            work_dir = root / "build"
            workspace.mkdir(parents=True)
            work_dir.mkdir(parents=True)

            state_path = work_dir / cache_manager.REUSE_STATE_FILE
            state_path.write_text(
                json.dumps({"fingerprint": "stale"}, ensure_ascii=True),
                encoding="utf-8",
            )

            with mock.patch.object(cache_manager, "resolve_profile_workspace", return_value=workspace), \
                mock.patch.object(cache_manager, "resolve_profile_modules", return_value=["phonepe_sigbypass"]), \
                mock.patch.object(cache_manager, "has_reusable_merged_workspace", return_value=False), \
                mock.patch.object(cache_manager, "profile_merge", return_value=workspace), \
                mock.patch.object(cache_manager, "profile_build_path", return_value=work_dir), \
                mock.patch.object(cache_manager, "compute_profile_reuse_fingerprint", return_value="fresh"), \
                mock.patch.object(cache_manager, "ensure_profile_release_splits_signed") as ensure_splits_mock, \
                mock.patch.object(cache_manager, "sigbypass_compile") as compile_mock:
                out_dir = cache_manager.profile_apk({}, "full", fresh=False)

            self.assertEqual(out_dir, work_dir)
            compile_mock.assert_called_once()
            ensure_splits_mock.assert_called_once()
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["fingerprint"], "fresh")

    def test_profile_apk_reuses_merged_workspace_on_cache_miss(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            workspace = root / "workspace"
            work_dir = root / "build"
            workspace.mkdir(parents=True)
            work_dir.mkdir(parents=True)

            state_path = work_dir / cache_manager.REUSE_STATE_FILE
            state_path.write_text(
                json.dumps({"fingerprint": "stale"}, ensure_ascii=True),
                encoding="utf-8",
            )

            with mock.patch.object(cache_manager, "resolve_profile_workspace", return_value=workspace), \
                mock.patch.object(cache_manager, "resolve_profile_modules", return_value=["phonepe_sigbypass"]), \
                mock.patch.object(cache_manager, "has_reusable_merged_workspace", return_value=True) as merged_workspace_mock, \
                mock.patch.object(cache_manager, "profile_merge", return_value=workspace) as merge_mock, \
                mock.patch.object(cache_manager, "profile_build_path", return_value=work_dir), \
                mock.patch.object(cache_manager, "compute_profile_reuse_fingerprint", return_value="fresh"), \
                mock.patch.object(cache_manager, "ensure_profile_release_splits_signed") as ensure_splits_mock, \
                mock.patch.object(cache_manager, "sigbypass_compile") as compile_mock:
                out_dir = cache_manager.profile_apk({}, "full", fresh=False)

            self.assertEqual(out_dir, work_dir)
            compile_mock.assert_called_once()
            ensure_splits_mock.assert_called_once()
            merged_workspace_mock.assert_called_once_with({}, "full", workspace, ["phonepe_sigbypass"])
            merge_mock.assert_not_called()

    def test_compute_profile_reuse_fingerprint_prefers_merge_state_fast_path(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            workspace = Path(tempdir) / "workspace"
            (workspace / "res" / "values").mkdir(parents=True)
            (workspace / "res" / "values" / "public.xml").write_text("<resources/>", encoding="utf-8")
            (workspace / "AndroidManifest.xml").write_text("<manifest/>", encoding="utf-8")
            (workspace / "apktool.yml").write_text("version: 2.0", encoding="utf-8")
            state_path = workspace / cache_manager.MERGE_STATE_FILE
            state_path.write_text(
                json.dumps(
                    {
                        "profile": "full",
                        "modules": ["m1", "m2"],
                        "module_fingerprints": {"m1": "fp-m1", "m2": "fp-m2"},
                    },
                    ensure_ascii=True,
                ),
                encoding="utf-8",
            )

            def fake_resolve_module_spec(_manifest, name):
                return {"name": name, "fingerprint_inputs": []}

            def fake_compute_module_fingerprint(spec):
                return f"fp-{spec['name']}"

            with mock.patch.object(cache_manager, "resolve_profile_modules", return_value=["m1", "m2"]), \
                mock.patch.object(cache_manager, "resolve_module_spec", side_effect=fake_resolve_module_spec), \
                mock.patch.object(cache_manager, "compute_module_fingerprint", side_effect=fake_compute_module_fingerprint), \
                mock.patch.object(cache_manager, "compute_inputs_fingerprint", side_effect=AssertionError("should not compute workspace fingerprint")):
                fp = cache_manager.compute_profile_reuse_fingerprint({}, "full", workspace)

            self.assertTrue(fp)

    def test_has_reusable_merged_workspace_rejects_incomplete_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            workspace = Path(tempdir) / "workspace"
            (workspace / "res" / "xml").mkdir(parents=True)
            (workspace / "res" / "xml" / "network_security_config.xml").write_text(
                "<network-security-config/>",
                encoding="utf-8",
            )
            (workspace / "AndroidManifest.xml").write_text("<manifest/>", encoding="utf-8")
            (workspace / "apktool.yml").write_text("version: 2.0", encoding="utf-8")
            (workspace / cache_manager.MERGE_STATE_FILE).write_text(
                json.dumps(
                    {
                        "profile": "full",
                        "modules": ["m1"],
                        "module_fingerprints": {"m1": "fp-m1"},
                    },
                    ensure_ascii=True,
                ),
                encoding="utf-8",
            )

            with mock.patch.object(cache_manager, "resolve_module_spec", return_value={"name": "m1"}), \
                mock.patch.object(cache_manager, "compute_module_fingerprint", return_value="fp-m1"):
                reusable = cache_manager.has_reusable_merged_workspace({}, "full", workspace, ["m1"])

            self.assertFalse(reusable)


if __name__ == "__main__":
    unittest.main()
