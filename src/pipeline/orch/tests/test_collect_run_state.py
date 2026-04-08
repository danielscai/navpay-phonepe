import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as cache_manager  # noqa: E402


class CollectRunStateTest(unittest.TestCase):
    def test_collect_resume_skips_completed_targets(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            snapshots_root = root / "cache" / "phonepe" / "snapshots"
            run_dir = snapshots_root / "runs" / "r1"
            run_dir.mkdir(parents=True, exist_ok=True)
            (run_dir / "run_state.json").write_text(
                json.dumps(
                    {
                        "run_id": "r1",
                        "status": "running",
                        "completed_targets": ["emu_arm64_xxhdpi"],
                        "version_anchor": {
                            "packageName": "com.phonepe.app",
                            "versionCode": "26040100",
                            "signingDigest": "abc123",
                        },
                        "failed_targets": [],
                        "blocked_reason": None,
                    },
                    ensure_ascii=True,
                ),
                encoding="utf-8",
            )

            matrix_path = root / "device_matrix.json"
            matrix_path.write_text(
                json.dumps(
                    {
                        "package": "com.phonepe.app",
                        "bootstrap_target_id": "emu_arm64_xxhdpi",
                        "targets": [
                            {"target_id": "emu_arm64_xxhdpi", "serial_alias": "emulator-5554"},
                            {"target_id": "emu_arm64_xhdpi", "serial_alias": "emulator-5560"},
                        ],
                    },
                    ensure_ascii=True,
                ),
                encoding="utf-8",
            )

            executed = []

            def fake_execute(_matrix, target, _state, _run_dir):
                executed.append(target["target_id"])
                return {
                    "status": "done",
                    "anchor": {
                        "packageName": "com.phonepe.app",
                        "versionCode": "26040100",
                        "signingDigest": "abc123",
                    },
                }

            with mock.patch.object(cache_manager, "execute_collect_target", side_effect=fake_execute):
                exit_code = cache_manager.run_collect(
                    matrix_path=str(matrix_path),
                    package="com.phonepe.app",
                    resume="r1",
                    snapshots_root=snapshots_root,
                )

            self.assertEqual(exit_code, 0)
            self.assertEqual(executed, ["emu_arm64_xhdpi"])


if __name__ == "__main__":
    unittest.main()
