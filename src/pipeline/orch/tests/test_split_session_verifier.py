import importlib.util
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]
VERIFIER_PATH = REPO_ROOT / "scripts/verify_phonepe_split_session_install.py"


def _load_verifier_module():
    spec = importlib.util.spec_from_file_location("split_session_verifier", VERIFIER_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_verifier_requires_base_apk(tmp_path):
    cmd = [
        "python3",
        "scripts/verify_phonepe_split_session_install.py",
        "--base-apk", str(tmp_path / "missing-base.apk"),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    assert proc.returncode != 0
    assert "base apk not found" in (proc.stdout + proc.stderr).lower()


def test_select_required_splits_prefers_supported_abi_order(tmp_path):
    verifier = _load_verifier_module()
    files = [
        tmp_path / "split_config.arm64_v8a.apk",
        tmp_path / "split_config.armeabi_v7a.apk",
    ]
    for path in files:
        path.write_text("x")

    selected = verifier.select_abi_split(files, ["armeabi-v7a", "arm64-v8a"])
    assert selected and selected.name == "split_config.armeabi_v7a.apk"


def test_select_required_density_split_exact_match(tmp_path):
    verifier = _load_verifier_module()
    files = [
        tmp_path / "split_config.xxhdpi.apk",
        tmp_path / "split_config.xhdpi.apk",
    ]
    for path in files:
        path.write_text("x")

    selected = verifier.select_density_split(files, "xxhdpi")
    assert selected and selected.name == "split_config.xxhdpi.apk"
