import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as cache_manager  # noqa: E402


class ReuseArtifactsTest(unittest.TestCase):
    def test_reuse_artifacts_flag_is_exposed_for_profile_compile(self) -> None:
        args = cache_manager.build_parser().parse_args([
            "compile",
            "--reuse-artifacts",
        ])
        self.assertIs(args.reuse_artifacts, True)
        self.assertEqual(args.profile, "full")

    def test_profile_compile_reuse_cache_hit_skips_rebuild(self) -> None:
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
                out_dir = cache_manager.profile_compile({}, "full", reuse_artifacts=True)

            self.assertEqual(out_dir, work_dir)
            compile_mock.assert_not_called()

    def test_profile_compile_reuse_cache_miss_runs_rebuild(self) -> None:
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
                mock.patch.object(cache_manager, "profile_merge", return_value=workspace), \
                mock.patch.object(cache_manager, "profile_build_path", return_value=work_dir), \
                mock.patch.object(cache_manager, "compute_profile_reuse_fingerprint", return_value="fresh"), \
                mock.patch.object(cache_manager, "sigbypass_compile") as compile_mock:
                out_dir = cache_manager.profile_compile({}, "full", reuse_artifacts=True)

            self.assertEqual(out_dir, work_dir)
            compile_mock.assert_called_once()
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["fingerprint"], "fresh")


if __name__ == "__main__":
    unittest.main()
