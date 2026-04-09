import sys
from pathlib import Path
import subprocess

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as orch  # noqa: E402


def test_uninstall_uses_running_emulator_or_specific_serial(monkeypatch):
    calls = []
    monkeypatch.setattr(orch, "load_manifest", lambda: {"dummy": {"deps": []}})
    monkeypatch.setattr(orch, "resolve_install_target_serial", lambda serial="": "emulator-5554" if not serial else serial)
    monkeypatch.setattr(orch, "uninstall_app_from_device", lambda package, serial: calls.append((package, serial)))
    monkeypatch.setattr(orch, "resolve_app_package", lambda app: "com.phonepe.app")

    assert orch.main(["uninstall", "phonepe"]) == 0
    assert orch.main(["uninstall", "phonepe", "--serial", "emulator-5556"]) == 0
    assert calls == [
        ("com.phonepe.app", "emulator-5554"),
        ("com.phonepe.app", "emulator-5556"),
    ]


def test_cmd_uninstall_fails_when_no_running_emulator(monkeypatch):
    monkeypatch.setattr(orch, "resolve_install_target_serial", lambda serial="": "")
    monkeypatch.setattr(orch, "resolve_app_package", lambda app: "com.phonepe.app")

    try:
        orch.cmd_uninstall("phonepe")
        assert False, "expected RuntimeError"
    except RuntimeError as exc:
        assert "No running emulator found" in str(exc)


def test_uninstall_app_from_device_calls_adb_uninstall(monkeypatch):
    monkeypatch.setattr(orch, "adb_path", lambda: "adb")
    monkeypatch.setattr(orch, "select_device", lambda adb, serial: serial)
    seen = {}

    def fake_run(cmd, stdout=None, stderr=None, text=None):
        seen["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, 0, stdout="Success\n", stderr="")

    monkeypatch.setattr(orch.subprocess, "run", fake_run)
    orch.uninstall_app_from_device("com.phonepe.app", "emulator-5554")
    assert seen["cmd"] == ["adb", "-s", "emulator-5554", "uninstall", "com.phonepe.app"]

