import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as cache_manager  # noqa: E402


class SnapshotSeedResolutionTest(unittest.TestCase):
    def test_resolve_snapshot_anchor_prefers_requested_version(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            index_path = root / "index.json"
            index_path.write_text(
                json.dumps(
                    {
                        "snapshots": [
                            {
                                "package": "com.phonepe.app",
                                "versionCode": "26022705",
                                "signingDigest": "aa:bb",
                                "updated_at": "2026-04-08T10:00:00",
                            },
                            {
                                "package": "com.phonepe.app",
                                "versionCode": "26022800",
                                "signingDigest": "cc:dd",
                                "updated_at": "2026-04-08T12:00:00",
                            },
                        ]
                    },
                    ensure_ascii=True,
                ),
                encoding="utf-8",
            )

            anchor = cache_manager.resolve_snapshot_anchor(index_path, "com.phonepe.app", "26022705")

        self.assertEqual(anchor["packageName"], "com.phonepe.app")
        self.assertEqual(anchor["versionCode"], "26022705")
        self.assertEqual(anchor["signingDigest"], "aabb")

    def test_resolve_snapshot_anchor_uses_latest_when_version_is_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            index_path = root / "index.json"
            index_path.write_text(
                json.dumps(
                    {
                        "snapshots": [
                            {
                                "package": "com.phonepe.app",
                                "versionCode": "26022705",
                                "signingDigest": "aa:bb",
                                "updated_at": "2026-04-08T10:00:00",
                            },
                            {
                                "package": "com.phonepe.app",
                                "versionCode": "26022800",
                                "signingDigest": "cc:dd",
                                "updated_at": "2026-04-08T12:00:00",
                            },
                        ]
                    },
                    ensure_ascii=True,
                ),
                encoding="utf-8",
            )

            anchor = cache_manager.resolve_snapshot_anchor(index_path, "com.phonepe.app", "")

        self.assertEqual(anchor["versionCode"], "26022800")
        self.assertEqual(anchor["signingDigest"], "ccdd")

    def test_build_phonepe_snapshot_seed_copies_all_collected_splits_and_meta(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            snapshots_root = root / "snapshots"
            capture_dir = (
                snapshots_root
                / "com.phonepe.app"
                / "26022705"
                / "aabb"
                / "captures"
                / "emu_arm64_xxhdpi"
            )
            capture_dir.mkdir(parents=True, exist_ok=True)
            for name in ("base.apk", "split_config.arm64_v8a.apk", "split_config.xxhdpi.apk"):
                (capture_dir / name).write_text(name, encoding="utf-8")
            alt_capture_dir = (
                snapshots_root
                / "com.phonepe.app"
                / "26022705"
                / "aabb"
                / "captures"
                / "emu_x86_64_xhdpi"
            )
            alt_capture_dir.mkdir(parents=True, exist_ok=True)
            for name in ("base.apk", "split_config.x86_64.apk", "split_config.xhdpi.apk"):
                (alt_capture_dir / name).write_text(name, encoding="utf-8")

            (snapshots_root / "index.json").write_text(
                json.dumps(
                    {
                        "snapshots": [
                            {
                                "package": "com.phonepe.app",
                                "versionCode": "26022705",
                                "signingDigest": "aa:bb",
                                "updated_at": "2026-04-08T12:00:00",
                            }
                        ]
                    },
                    ensure_ascii=True,
                ),
                encoding="utf-8",
            )

            seed_dir = root / "snapshot_seed"
            with mock.patch.object(cache_manager, "DEFAULT_SNAPSHOTS_ROOT", snapshots_root):
                cache_manager.build_phonepe_snapshot_seed(seed_dir, "com.phonepe.app", "26022705")

            self.assertTrue((seed_dir / "base.apk").is_file())
            self.assertTrue((seed_dir / "split_config.arm64_v8a.apk").is_file())
            self.assertTrue((seed_dir / "split_config.xxhdpi.apk").is_file())
            self.assertTrue((seed_dir / "split_config.x86_64.apk").is_file())
            self.assertTrue((seed_dir / "split_config.xhdpi.apk").is_file())

            meta = json.loads((seed_dir / "meta.json").read_text(encoding="utf-8"))
            self.assertEqual(meta["snapshot_anchor"]["packageName"], "com.phonepe.app")
            self.assertEqual(meta["snapshot_anchor"]["versionCode"], "26022705")
            self.assertEqual(meta["snapshot_anchor"]["signingDigest"], "aabb")
            self.assertEqual(meta["snapshot_version"], "26022705")
            self.assertIn("split_config.arm64_v8a.apk", meta["split_files"])
            self.assertIn("split_config.x86_64.apk", meta["split_files"])


if __name__ == "__main__":
    unittest.main()
