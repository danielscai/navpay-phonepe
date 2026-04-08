import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as cache_manager  # noqa: E402


class CollectReportsTest(unittest.TestCase):
    def test_collect_writes_gap_and_summary_reports(self) -> None:
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
                            {"target_id": "emu_arm64_xxhdpi_alt", "serial_alias": "emulator-5570"},
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

            def fake_execute(_matrix, target, _state, _run_dir):
                if target["target_id"] == "emu_arm64_xxhdpi_alt":
                    return {"status": "failed"}
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
                    "device_meta": {"serial": target["serial_alias"]},
                }

            with mock.patch.object(cache_manager, "execute_collect_target", side_effect=fake_execute):
                cache_manager.run_collect(
                    matrix_path=str(matrix_path),
                    package="com.phonepe.app",
                    snapshots_root=snapshots_root,
                )

            run_dirs = list((snapshots_root / "runs").iterdir())
            self.assertEqual(len(run_dirs), 1)
            run_dir = run_dirs[0]
            self.assertTrue((run_dir / "gap-report.json").exists())
            self.assertTrue((run_dir / "summary.json").exists())
            data = json.loads((run_dir / "gap-report.json").read_text(encoding="utf-8"))
            self.assertEqual(len(data["missing"]), 1)


if __name__ == "__main__":
    unittest.main()
