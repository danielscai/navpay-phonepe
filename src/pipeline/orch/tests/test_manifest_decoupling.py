import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


MANIFEST_PATH = Path(__file__).resolve().parents[1] / "cache_manifest.json"
ROOT = Path(__file__).resolve().parents[2]
CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
TARGET_MODULES = (
    "phonepe_sigbypass",
    "phonepe_https_interceptor",
    "phonepe_phonepehelper",
    "heartbeat_bridge",
)

sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as cache_manager  # noqa: E402


class ManifestDecouplingTest(unittest.TestCase):
    def test_target_modules_depend_on_phonepe_decompiled(self) -> None:
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        for module in TARGET_MODULES:
            self.assertEqual(manifest[module]["deps"], ["phonepe_decompiled"])

    def test_target_modules_source_fields_are_baseline_subdir(self) -> None:
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        for module in TARGET_MODULES:
            self.assertEqual(manifest[module]["source_cache"], "phonepe_decompiled")
            self.assertEqual(manifest[module]["source_subdir"], "base_decompiled_clean")

    def test_resolve_module_spec_fails_fast_for_invalid_source_cache(self) -> None:
        manifest = {
            "phonepe_decompiled": {"deps": [], "path": "cache/phonepe/decompiled"},
            "phonepe_sigbypass": {
                "deps": ["phonepe_decompiled"],
                "path": "cache/phonepe_sigbypass",
                "source_cache": "missing_cache",
                "source_subdir": "base_decompiled_clean",
                "reset_paths": ["smali/Foo.smali"],
                "merge_script": "src/apk/signature_bypass/scripts/merge.sh",
                "build_dir": "cache/build",
            },
        }
        with self.assertRaises(RuntimeError) as exc:
            cache_manager.resolve_module_spec(manifest, "phonepe_sigbypass")
        self.assertIn("valid source_cache", str(exc.exception))

    def test_resolve_module_spec_fails_fast_for_missing_source_subdir_path(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            base = Path(tempdir)
            fake_repo = base / "repo"
            fake_repo.mkdir(parents=True)
            (fake_repo / "cache/phonepe/decompiled").mkdir(parents=True)

            manifest = {
                "phonepe_decompiled": {"deps": [], "path": "cache/phonepe/decompiled"},
                "phonepe_sigbypass": {
                    "deps": ["phonepe_decompiled"],
                    "path": "cache/phonepe_sigbypass",
                    "source_cache": "phonepe_decompiled",
                    "source_subdir": "base_decompiled_clean",
                    "reset_paths": ["smali/Foo.smali"],
                    "merge_script": "src/apk/signature_bypass/scripts/merge.sh",
                    "build_dir": "cache/build",
                },
            }

            def fake_resolve_cache_path(rel_path: str) -> Path:
                return (fake_repo / rel_path).resolve()

            with mock.patch.object(cache_manager, "resolve_cache_path", side_effect=fake_resolve_cache_path):
                with self.assertRaises(RuntimeError) as exc:
                    cache_manager.resolve_module_spec(manifest, "phonepe_sigbypass")
            self.assertIn("source_subdir", str(exc.exception))

    def test_module_mergers_are_artifact_only(self) -> None:
        injectors = (
            Path("src/apk/signature_bypass/scripts/merge.sh"),
            Path("src/apk/https_interceptor/scripts/merge.sh"),
            Path("src/apk/phonepehelper/scripts/merge.sh"),
            Path("src/apk/heartbeat_bridge/scripts/merge.sh"),
        )
        for path in injectors:
            with self.subTest(path=path):
                text = path.read_text(encoding="utf-8")
                self.assertIn("--artifact-dir", text)
                self.assertNotIn("compile.sh", text)
                self.assertNotIn('"$SCRIPT_DIR/compile.sh"', text)

    def test_phonepe_snapshot_seed_is_the_versioned_root_cache(self) -> None:
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        self.assertIn("phonepe_snapshot_seed", manifest)
        self.assertEqual(manifest["phonepe_snapshot_seed"]["path"], "cache/phonepe/snapshot_seed")
        self.assertEqual(manifest["phonepe_snapshot_seed"]["deps"], [])
        self.assertEqual(manifest["phonepe_merged"]["deps"], ["phonepe_snapshot_seed"])
        self.assertEqual(manifest["phonepe_decompiled"]["deps"], ["phonepe_merged"])


if __name__ == "__main__":
    unittest.main()
