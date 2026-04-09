import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as cache_manager  # noqa: E402


class CollectBlockerTest(unittest.TestCase):
    def test_collect_exits_20_and_writes_blocker_report_when_play_not_logged_in(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            snapshots_root = root / "cache" / "snapshots" / "phonepe"
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

            with mock.patch.object(
                cache_manager,
                "detect_play_login_blocker",
                return_value={"blocked": True, "reason": "play_account_not_logged_in"},
            ), mock.patch.object(cache_manager, "ensure_play_upgrade_or_skip", return_value={"serial": "emulator-5554"}), \
                mock.patch.object(cache_manager, "execute_collect_target") as execute_mock, \
                mock.patch.object(cache_manager, "shutdown_collect_emulators") as shutdown_mock:
                code = cache_manager.run_collect(
                    matrix_path=str(matrix_path),
                    package="com.phonepe.app",
                    snapshots_root=snapshots_root,
                )

            self.assertEqual(code, 20)
            execute_mock.assert_not_called()
            shutdown_mock.assert_called_once()

            blocker_reports = list(snapshots_root.glob("runs/*/blocker-report.json"))
            self.assertEqual(len(blocker_reports), 1)
            payload = json.loads(blocker_reports[0].read_text(encoding="utf-8"))
            self.assertEqual(payload["reason"], "play_account_not_logged_in")


if __name__ == "__main__":
    unittest.main()
