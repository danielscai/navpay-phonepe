import tempfile
import unittest
from pathlib import Path

REQUIRED_CONTRACT_FILES = ("apk.sha256", "meta.json", "probe.log")
REQUIRED_PROBE_JSON_FILES = ("probe.json",)


def ensure_artifact_contract(sample_dir: Path) -> None:
    missing = [name for name in REQUIRED_CONTRACT_FILES if not (sample_dir / name).is_file()]
    if missing:
        raise FileNotFoundError(
            f"Missing contract files under {sample_dir}: {', '.join(missing)}"
        )


def ensure_probe_json_contract(sample_dir: Path) -> None:
    missing = [name for name in REQUIRED_PROBE_JSON_FILES if not (sample_dir / name).is_file()]
    if missing:
        raise FileNotFoundError(
            f"Missing probe json files under {sample_dir}: {', '.join(missing)}"
        )


class ArtifactContractTest(unittest.TestCase):
    def test_contract_files_exist_in_sample_dir(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            sample_dir = Path(temp_dir) / "sample"
            sample_dir.mkdir()
            for name in REQUIRED_CONTRACT_FILES:
                (sample_dir / name).write_text("ok", encoding="utf-8")

            ensure_artifact_contract(sample_dir)

    def test_contract_files_missing_raises(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            sample_dir = Path(temp_dir) / "sample"
            sample_dir.mkdir()
            (sample_dir / "meta.json").write_text("{}", encoding="utf-8")

            with self.assertRaises(FileNotFoundError) as exc:
                ensure_artifact_contract(sample_dir)

            message = str(exc.exception)
            self.assertIn("apk.sha256", message)
            self.assertIn("probe.log", message)

    def test_probe_json_contract_exists(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            sample_dir = Path(temp_dir) / "sample"
            sample_dir.mkdir()
            (sample_dir / "probe.json").write_text("{}", encoding="utf-8")

            ensure_probe_json_contract(sample_dir)

    def test_probe_json_contract_missing_raises(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            sample_dir = Path(temp_dir) / "sample"
            sample_dir.mkdir()

            with self.assertRaises(FileNotFoundError) as exc:
                ensure_probe_json_contract(sample_dir)

            self.assertIn("probe.json", str(exc.exception))


if __name__ == "__main__":
    unittest.main()
