import sys
import tempfile
import unittest
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from compose_engine import detect_conflicts, refresh_profile_workspace


class ComposeEngineTest(unittest.TestCase):
    def test_detect_conflicts_raises_on_same_reset_path(self) -> None:
        manifest = {
            "phonepe_sigbypass": {
                "reset_paths": [
                    "smali/com/phonepe/app/PhonePeApplication.smali",
                ]
            },
            "phonepe_https_interceptor": {
                "reset_paths": [
                    "smali/com/phonepe/app/PhonePeApplication.smali",
                ]
            },
        }

        with self.assertRaises(ValueError) as exc:
            detect_conflicts(
                manifest,
                ["phonepe_sigbypass", "phonepe_https_interceptor"],
            )

        self.assertIn("reset_paths conflict", str(exc.exception))

    def test_detect_conflicts_no_conflict(self) -> None:
        manifest = {
            "phonepe_sigbypass": {
                "reset_paths": [
                    "smali/com/phonepe/app/PhonePeApplication.smali",
                ]
            },
            "phonepe_https_interceptor": {
                "reset_paths": [
                    "AndroidManifest.xml",
                ]
            },
        }

        detect_conflicts(
            manifest,
            ["phonepe_sigbypass", "phonepe_https_interceptor"],
        )

    def test_refresh_profile_workspace_makes_files_writable(self) -> None:
        profile_name = "unitperm"
        cache_root = Path(__file__).resolve().parents[4] / "cache"
        workspace = cache_root / "apps" / "phonepe" / "compose" / "injection_workspace"

        if workspace.exists():
            for root, dirs, files in os.walk(workspace, topdown=False):
                for filename in files:
                    (Path(root) / filename).chmod(0o600)
                for dirname in dirs:
                    (Path(root) / dirname).chmod(0o700)
            workspace.chmod(0o700)
            import shutil

            shutil.rmtree(workspace)

        with tempfile.TemporaryDirectory() as temp_dir:
            baseline = Path(temp_dir) / "baseline"
            (baseline / "res" / "values").mkdir(parents=True)
            readonly_file = baseline / "res" / "values" / "dimens.xml"
            readonly_file.write_text("<resources/>", encoding="utf-8")
            readonly_file.chmod(0o444)

            out_workspace = refresh_profile_workspace(profile_name, baseline)
            copied_file = out_workspace / "res" / "values" / "dimens.xml"

            self.assertTrue(copied_file.exists())
            self.assertTrue(
                os.access(copied_file, os.W_OK),
                f"workspace file should be writable: {copied_file}",
            )

    def test_refresh_profile_workspace_can_delete_existing_readonly_workspace(self) -> None:
        profile_name = "unitperm_existing"
        cache_root = Path(__file__).resolve().parents[4] / "cache"
        workspace = cache_root / "apps" / "phonepe" / "compose" / "injection_workspace"

        if workspace.exists():
            for root, dirs, files in os.walk(workspace, topdown=False):
                for filename in files:
                    (Path(root) / filename).chmod(0o600)
                for dirname in dirs:
                    (Path(root) / dirname).chmod(0o700)
            workspace.chmod(0o700)
            import shutil

            shutil.rmtree(workspace)

        (workspace / "res" / "values").mkdir(parents=True)
        old_file = workspace / "res" / "values" / "dimens.xml"
        old_file.write_text("old", encoding="utf-8")
        old_file.chmod(0o444)
        (workspace / "res" / "values").chmod(0o555)
        (workspace / "res").chmod(0o555)
        workspace.chmod(0o555)

        with tempfile.TemporaryDirectory() as temp_dir:
            baseline = Path(temp_dir) / "baseline"
            (baseline / "res" / "values").mkdir(parents=True)
            new_file = baseline / "res" / "values" / "dimens.xml"
            new_file.write_text("new", encoding="utf-8")
            new_file.chmod(0o444)

            out_workspace = refresh_profile_workspace(profile_name, baseline)
            copied_file = out_workspace / "res" / "values" / "dimens.xml"
            self.assertEqual(copied_file.read_text(encoding="utf-8"), "new")


if __name__ == "__main__":
    unittest.main()
