import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as cache_manager  # noqa: E402


class ModuleArtifactCacheTest(unittest.TestCase):
    def test_ensure_module_artifact_returns_true_on_cache_hit(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            artifact_dir = root / "artifact"
            artifact_dir.mkdir(parents=True, exist_ok=True)
            source_output = root / "source-output.bin"
            source_output.write_text("one", encoding="utf-8")
            spec = {
                "name": "phonepe_sigbypass",
                "builder": {
                    "command": "noop",
                    "args": [],
                    "outputs": [{"source": source_output, "target": "artifact-output.bin"}],
                },
                "fingerprint_inputs": [source_output],
            }
            fingerprint = cache_manager.compute_module_fingerprint(spec)
            (artifact_dir / "manifest.json").write_text(
                json.dumps({"fingerprint": fingerprint}, ensure_ascii=True),
                encoding="utf-8",
            )
            (artifact_dir / "artifact-output.bin").write_text("ready", encoding="utf-8")

            result = cache_manager.ensure_module_artifact(spec, artifact_dir)

            self.assertIs(result, True)

    def test_ensure_module_artifact_rebuilds_on_cache_miss(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            artifact_dir = root / "artifact"
            artifact_dir.mkdir(parents=True, exist_ok=True)
            source_output = root / "source-output.bin"
            source_output.write_text("one", encoding="utf-8")
            spec = {
                "name": "phonepe_sigbypass",
                "builder": {
                    "command": "noop",
                    "args": [],
                    "outputs": [{"source": source_output, "target": "artifact-output.bin"}],
                },
                "fingerprint_inputs": [source_output],
            }
            (artifact_dir / "manifest.json").write_text(
                json.dumps({"fingerprint": "stale"}, ensure_ascii=True),
                encoding="utf-8",
            )

            def fake_build(_spec, target_dir):
                target_dir.mkdir(parents=True, exist_ok=True)
                (target_dir / "artifact-output.bin").write_text("ready", encoding="utf-8")

            with mock.patch.object(cache_manager, "run_module_builder", side_effect=fake_build) as build_mock:
                result = cache_manager.ensure_module_artifact(spec, artifact_dir)

            self.assertIs(result, False)
            build_mock.assert_called_once()
            manifest = json.loads((artifact_dir / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["fingerprint"], cache_manager.compute_module_fingerprint(spec))
            self.assertTrue((artifact_dir / "artifact-output.bin").exists())

    def test_ensure_module_artifact_requires_outputs_on_cache_hit(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            artifact_dir = root / "artifact"
            artifact_dir.mkdir(parents=True, exist_ok=True)
            source_output = root / "source-output.bin"
            source_output.write_text("one", encoding="utf-8")
            spec = {
                "name": "phonepe_sigbypass",
                "builder": {
                    "command": "noop",
                    "args": [],
                    "outputs": [{"source": source_output, "target": "artifact-output.bin"}],
                },
                "fingerprint_inputs": [source_output],
            }
            fingerprint = cache_manager.compute_module_fingerprint(spec)
            (artifact_dir / "manifest.json").write_text(
                json.dumps({"fingerprint": fingerprint}, ensure_ascii=True),
                encoding="utf-8",
            )

            with mock.patch.object(cache_manager, "run_module_builder") as build_mock:
                result = cache_manager.ensure_module_artifact(spec, artifact_dir)

            self.assertIs(result, False)
            build_mock.assert_called_once()

    def test_compute_module_fingerprint_uses_declared_inputs_not_builder_identity(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            input_path = root / "input.smali"
            input_path.write_text("same", encoding="utf-8")
            spec_one = {
                "name": "phonepe_sigbypass",
                "builder": {
                    "command": "noop",
                    "args": [],
                    "outputs": [],
                },
                "fingerprint_inputs": [input_path],
            }
            spec_two = {
                "name": "phonepe_sigbypass",
                "builder": {
                    "command": "noop",
                    "args": [],
                    "outputs": [],
                },
                "fingerprint_inputs": [input_path],
            }

            self.assertEqual(
                cache_manager.compute_module_fingerprint(spec_one),
                cache_manager.compute_module_fingerprint(spec_two),
            )

    def test_compute_module_fingerprint_changes_when_declared_inputs_change(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            input_one = root / "input-one.smali"
            input_two = root / "input-two.smali"
            input_one.write_text("one", encoding="utf-8")
            input_two.write_text("two", encoding="utf-8")
            base_spec = {
                "name": "phonepe_sigbypass",
                "builder": {
                    "command": "noop",
                    "args": [],
                    "outputs": [],
                },
            }

            fingerprint_one = cache_manager.compute_module_fingerprint(
                {**base_spec, "fingerprint_inputs": [input_one]}
            )
            fingerprint_two = cache_manager.compute_module_fingerprint(
                {**base_spec, "fingerprint_inputs": [input_two]}
            )

            self.assertNotEqual(fingerprint_one, fingerprint_two)


if __name__ == "__main__":
    unittest.main()
