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
)

sys.path.insert(0, str(CACHE_MANAGER_DIR))

import cache_manager  # noqa: E402


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
            "phonepe_decompiled": {"deps": [], "path": "cache/phonepe_decompiled"},
            "phonepe_sigbypass": {
                "deps": ["phonepe_decompiled"],
                "path": "cache/phonepe_sigbypass",
                "source_cache": "missing_cache",
                "source_subdir": "base_decompiled_clean",
                "reset_paths": ["smali/Foo.smali"],
                "inject_script": "src/signature_bypass/scripts/inject.sh",
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
            (fake_repo / "cache/phonepe_decompiled").mkdir(parents=True)

            manifest = {
                "phonepe_decompiled": {"deps": [], "path": "cache/phonepe_decompiled"},
                "phonepe_sigbypass": {
                    "deps": ["phonepe_decompiled"],
                    "path": "cache/phonepe_sigbypass",
                    "source_cache": "phonepe_decompiled",
                    "source_subdir": "base_decompiled_clean",
                    "reset_paths": ["smali/Foo.smali"],
                    "inject_script": "src/signature_bypass/scripts/inject.sh",
                    "build_dir": "cache/build",
                },
            }

            def fake_resolve_cache_path(rel_path: str) -> Path:
                return (fake_repo / rel_path).resolve()

            with mock.patch.object(cache_manager, "resolve_cache_path", side_effect=fake_resolve_cache_path):
                with self.assertRaises(RuntimeError) as exc:
                    cache_manager.resolve_module_spec(manifest, "phonepe_sigbypass")
            self.assertIn("source_subdir", str(exc.exception))

    def test_module_injectors_are_artifact_only(self) -> None:
        injectors = (
            Path("src/signature_bypass/scripts/inject.sh"),
            Path("src/https_interceptor/scripts/inject.sh"),
            Path("src/phonepehelper/scripts/inject.sh"),
        )
        for path in injectors:
            with self.subTest(path=path):
                text = path.read_text(encoding="utf-8")
                self.assertIn("--artifact-dir", text)
                self.assertNotIn("build_smali_artifacts.sh", text)
                self.assertNotIn('"$SCRIPT_DIR/compile.sh"', text)


if __name__ == "__main__":
    unittest.main()
