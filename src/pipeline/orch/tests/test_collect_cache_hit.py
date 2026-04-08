import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as cache_manager  # noqa: E402


class CollectCacheHitTest(unittest.TestCase):
    def test_collect_stops_when_snapshot_key_already_exists(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            snapshots_root = root / "cache" / "phonepe" / "snapshots"
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

            existing_snapshot = snapshots_root / "com.phonepe.app" / "26040100" / "abc123"
            (existing_snapshot / "captures" / "emu_arm64_xxhdpi").mkdir(parents=True, exist_ok=True)

            called_targets = []

            def fake_execute(_matrix, target, _state, _run_dir):
                called_targets.append(target["target_id"])
                return {
                    "status": "done",
                    "anchor": {
                        "packageName": "com.phonepe.app",
                        "versionCode": "26040100",
                        "signingDigest": "abc123",
                    },
                    "artifacts": {},
                }

            with mock.patch.object(cache_manager, "detect_play_login_blocker", return_value={"blocked": False}), \
                mock.patch.object(
                    cache_manager,
                    "ensure_play_upgrade_or_skip",
                    return_value={
                        "serial": "emulator-5554",
                        "after_version_code": "26040100",
                        "after_signing_digest": "abc123",
                    },
                ), \
                mock.patch.object(cache_manager, "execute_collect_target", side_effect=fake_execute), \
                mock.patch.object(cache_manager, "archive_collect_target_artifacts") as archive_mock, \
                mock.patch.object(cache_manager, "shutdown_collect_emulators") as shutdown_mock:
                exit_code = cache_manager.run_collect(
                    matrix_path=str(matrix_path),
                    package="com.phonepe.app",
                    snapshots_root=snapshots_root,
                )

            self.assertEqual(exit_code, 0)
            self.assertEqual(called_targets, [])
            archive_mock.assert_not_called()
            shutdown_mock.assert_called_once()

if __name__ == "__main__":
    unittest.main()
