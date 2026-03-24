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
                mock.patch.object(cache_manager, "sigbypass_compile") as compile_mock:
                out_dir = cache_manager.profile_apk({}, "full", fresh=False)

            self.assertEqual(out_dir, work_dir)
            compile_mock.assert_not_called()

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
                mock.patch.object(cache_manager, "sigbypass_compile") as compile_mock:
                out_dir = cache_manager.profile_apk({}, "full", fresh=False)

            self.assertEqual(out_dir, work_dir)
            compile_mock.assert_called_once()
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
                mock.patch.object(cache_manager, "sigbypass_compile") as compile_mock:
                out_dir = cache_manager.profile_apk({}, "full", fresh=False)

            self.assertEqual(out_dir, work_dir)
            compile_mock.assert_called_once()
            merged_workspace_mock.assert_called_once_with({}, "full", workspace, ["phonepe_sigbypass"])
            merge_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
