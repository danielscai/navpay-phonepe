import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as cache_manager  # noqa: E402


class CollectAnchorTest(unittest.TestCase):
    def test_collect_bootstrap_sets_version_anchor_from_first_upgraded_target(self) -> None:
        matrix = {
            "package": "com.phonepe.app",
            "bootstrap_target_id": "emu_arm64_xxhdpi",
            "targets": [
                {"target_id": "emu_arm64_xxhdpi", "serial_alias": "emulator-5554"},
                {"target_id": "emu_arm64_xhdpi", "serial_alias": "emulator-5560"},
            ],
        }
        run_state = {
            "run_id": "r1",
            "status": "running",
            "completed_targets": [],
            "failed_targets": [],
            "blocked_reason": None,
        }

        with tempfile.TemporaryDirectory() as tempdir:
            run_dir = Path(tempdir)

            def fake_execute(_matrix, target, _state, _run_dir):
                self.assertEqual(target["target_id"], "emu_arm64_xxhdpi")
                return {
                    "status": "done",
                    "anchor": {
                        "packageName": "com.phonepe.app",
                        "versionCode": "26040100",
                        "signingDigest": "abc123",
                    },
                }

            with mock.patch.object(cache_manager, "execute_collect_target", side_effect=fake_execute):
                anchor = cache_manager.collect_bootstrap_anchor(matrix, run_state, run_dir)

        self.assertEqual(anchor["packageName"], "com.phonepe.app")
        self.assertEqual(anchor["versionCode"], "26040100")
        self.assertEqual(anchor["signingDigest"], "abc123")
        self.assertEqual(run_state["version_anchor"], anchor)
        self.assertIn("emu_arm64_xxhdpi", run_state["completed_targets"])


if __name__ == "__main__":
    unittest.main()
