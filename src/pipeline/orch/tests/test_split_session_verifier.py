import importlib.util
import subprocess
from pathlib import Path

import pytest


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


def test_install_multiple_uses_three_apks_in_single_call(monkeypatch, tmp_path):
    verifier = _load_verifier_module()
    base = tmp_path / "base.apk"
    abi = tmp_path / "split_config.arm64_v8a.apk"
    density = tmp_path / "split_config.xxhdpi.apk"
    for path in (base, abi, density):
        path.write_text("x")

    called = {}

    def fake_run(cmd, capture_output, text):
        called["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, 0, stdout="Success\n", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    verifier.install_multiple("adb", "emulator-5554", [base, abi, density])

    assert called["cmd"][:5] == ["adb", "-s", "emulator-5554", "install-multiple", "--no-incremental"]
    assert called["cmd"][5:] == [str(base), str(abi), str(density)]


def test_install_failure_maps_to_install_multiple_failed(monkeypatch, tmp_path):
    verifier = _load_verifier_module()
    base = tmp_path / "base.apk"
    base.write_text("x")

    def fake_run(cmd, capture_output, text):
        return subprocess.CompletedProcess(
            cmd,
            1,
            stdout="Failure [INSTALL_FAILED_MISSING_SHARED_LIBRARY]\n",
            stderr="",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)
    with pytest.raises(RuntimeError, match="INSTALL_MULTIPLE_FAILED"):
        verifier.install_multiple("adb", "emulator-5554", [base])
