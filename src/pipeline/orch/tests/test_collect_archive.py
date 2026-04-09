import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as cache_manager  # noqa: E402


class CollectArchiveTest(unittest.TestCase):
    def test_collect_archives_target_artifacts_under_snapshot_key(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            snapshots_root = root / "cache" / "apps" / "phonepe" / "snapshots"
            matrix_path = root / "device_matrix.json"
            matrix_path.write_text(
                json.dumps(
                    {
                        "package": "com.phonepe.app",
                        "bootstrap_target_id": "emu_arm64_xxhdpi",
                        "targets": [
                            {"target_id": "emu_arm64_xxhdpi", "serial_alias": "emulator-5554"},
                        ],
                    },
                    ensure_ascii=True,
                ),
                encoding="utf-8",
            )

            base_apk = root / "base.apk"
            abi_apk = root / "split_config.arm64_v8a.apk"
            density_apk = root / "split_config.xxhdpi.apk"
            for file_path in (base_apk, abi_apk, density_apk):
                file_path.write_text("apk-binary", encoding="utf-8")

            def fake_execute(_matrix, _target, _state, _run_dir):
                return {
                    "status": "done",
                    "anchor": {
                        "packageName": "com.phonepe.app",
                        "versionCode": "26040100",
                        "signingDigest": "abc123",
                    },
                    "artifacts": {
                        "base_apk": str(base_apk),
                        "abi_split_apk": str(abi_apk),
                        "density_split_apk": str(density_apk),
                    },
                    "device_meta": {"serial": "emulator-5554"},
                }

            with mock.patch.object(cache_manager, "detect_play_login_blocker", return_value={"blocked": False}), \
                mock.patch.object(cache_manager, "ensure_play_upgrade_or_skip", return_value={"serial": "emulator-5554"}), \
                mock.patch.object(cache_manager, "execute_collect_target", side_effect=fake_execute), \
                mock.patch.object(cache_manager, "shutdown_collect_emulators"):
                exit_code = cache_manager.run_collect(
                    matrix_path=str(matrix_path),
                    package="com.phonepe.app",
                    snapshots_root=snapshots_root,
                )

            self.assertEqual(exit_code, 0)
            snapshot_dir = (
                snapshots_root
                / "com.phonepe.app"
                / "26040100"
                / "abc123"
                / "captures"
                / "emu_arm64_xxhdpi"
            )
            self.assertTrue((snapshot_dir / "base.apk").exists())
            self.assertTrue((snapshot_dir / "capture_meta.json").exists())


if __name__ == "__main__":
    unittest.main()
