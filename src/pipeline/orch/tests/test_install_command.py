import sys
from pathlib import Path
import subprocess

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as orch  # noqa: E402


def test_install_uses_running_emulator_or_specific_serial(monkeypatch):
    calls = []
    monkeypatch.setattr(orch, "load_manifest", lambda: {"dummy": {"deps": []}})
    monkeypatch.setattr(orch, "profile_build_path", lambda profile: Path(f"/tmp/{profile}"))
    monkeypatch.setattr(orch, "install_profile_apk_to_device", lambda *args, **kwargs: calls.append((args, kwargs)))

    monkeypatch.setattr(orch, "resolve_install_target_serial", lambda serial="": "emulator-5554" if not serial else serial)

    assert orch.main(["install", "phonepe"]) == 0
    assert orch.main(["install", "phonepe", "--serial", "emulator-5556"]) == 0
    assert calls[0][0][2] == "emulator-5554"
    assert calls[1][0][2] == "emulator-5556"
    assert calls[0][1]["rebuild"] is False
    assert calls[1][1]["rebuild"] is False


def test_install_rebuild_flag_triggers_cached_rebuild(monkeypatch):
    called = {}
    monkeypatch.setattr(orch, "load_manifest", lambda: {"dummy": {"deps": []}})
    monkeypatch.setattr(orch, "resolve_install_target_serial", lambda serial="": "emulator-5554")
    monkeypatch.setattr(orch, "profile_build_path", lambda profile: Path(f"/tmp/{profile}"))

    def fake_install(manifest, profile_name, serial, rebuild=False, snapshot_version=""):
        called["manifest"] = manifest
        called["profile_name"] = profile_name
        called["serial"] = serial
        called["rebuild"] = rebuild
        called["snapshot_version"] = snapshot_version

    monkeypatch.setattr(orch, "install_profile_apk_to_device", fake_install)
    assert orch.main(["install", "phonepe", "26022705", "--rebuild"]) == 0
    assert called["profile_name"] == "full"
    assert called["serial"] == "emulator-5554"
    assert called["rebuild"] is True
    assert called["snapshot_version"] == "26022705"


def test_install_profile_apk_uses_install_multiple_with_selected_splits(monkeypatch, tmp_path):
    work_dir = tmp_path / "build"
    work_dir.mkdir(parents=True, exist_ok=True)
    signed_apk = work_dir / "patched_signed.apk"
    abi_split = work_dir / "split_config.arm64_v8a.apk"
    density_split = work_dir / "split_config.xxhdpi.apk"
    (work_dir / "split_config.x86_64.apk").write_text("x", encoding="utf-8")
    signed_apk.write_text("x", encoding="utf-8")
    abi_split.write_text("x", encoding="utf-8")
    density_split.write_text("x", encoding="utf-8")

    monkeypatch.setattr(orch, "profile_build_path", lambda profile: work_dir)
    monkeypatch.setattr(orch, "adb_path", lambda: "adb")
    monkeypatch.setattr(orch, "select_device", lambda adb, serial: serial)
    monkeypatch.setattr(orch, "read_supported_abis", lambda adb, serial: ["arm64-v8a", "armeabi-v7a"])
    monkeypatch.setattr(orch, "read_density_value", lambda adb, serial: 420)
    monkeypatch.setattr(orch, "run", lambda *args, **kwargs: None)
    monkeypatch.setattr(orch, "profile_apk", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("should not rebuild")))

    install_calls = []

    def fake_run(cmd, stdout=None, stderr=None, text=None):
        if "install-multiple" in cmd:
            install_calls.append(cmd)
        return subprocess.CompletedProcess(cmd, 0, stdout="Success\n", stderr="")

    monkeypatch.setattr(orch.subprocess, "run", fake_run)
    orch.install_profile_apk_to_device({}, "full", "emulator-5554", rebuild=False)
    assert install_calls, "expected install-multiple invocation"
    cmd = install_calls[0]
    assert cmd[:6] == ["adb", "-s", "emulator-5554", "install-multiple", "--no-incremental", "-r"]
    assert cmd[6:] == [str(signed_apk), str(abi_split), str(density_split)]


def test_install_profile_apk_fails_when_required_split_missing(monkeypatch, tmp_path):
    work_dir = tmp_path / "build"
    work_dir.mkdir(parents=True, exist_ok=True)
    signed_apk = work_dir / "patched_signed.apk"
    signed_apk.write_text("x", encoding="utf-8")
    (work_dir / "split_config.arm64_v8a.apk").write_text("x", encoding="utf-8")

    monkeypatch.setattr(orch, "profile_build_path", lambda profile: work_dir)
    monkeypatch.setattr(orch, "adb_path", lambda: "adb")
    monkeypatch.setattr(orch, "select_device", lambda adb, serial: serial)
    monkeypatch.setattr(orch, "read_supported_abis", lambda adb, serial: ["arm64-v8a"])
    monkeypatch.setattr(orch, "read_density_value", lambda adb, serial: 420)
    monkeypatch.setattr(orch, "profile_apk", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("should not rebuild")))

    try:
        orch.install_profile_apk_to_device({}, "full", "emulator-5554", rebuild=False)
        assert False, "expected RuntimeError for missing split"
    except RuntimeError as exc:
        assert "Missing density split" in str(exc)
