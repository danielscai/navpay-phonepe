import sys
from pathlib import Path

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as orch  # noqa: E402


def test_install_uses_running_emulator_or_specific_serial(monkeypatch):
    calls = []
    monkeypatch.setattr(orch, "load_manifest", lambda: {"dummy": {"deps": []}})

    def fake_profile_test(
        manifest,
        profile_name,
        serial,
        smoke=False,
        install_mode="reinstall",
        snapshot_version="",
    ):
        del manifest, profile_name, smoke, install_mode, snapshot_version
        calls.append(serial)

    monkeypatch.setattr(orch, "profile_test", fake_profile_test)
    monkeypatch.setattr(orch, "resolve_install_target_serial", lambda serial="": "emulator-5554" if not serial else serial)

    assert orch.main(["install", "phonepe"]) == 0
    assert orch.main(["install", "phonepe", "--serial", "emulator-5556"]) == 0
    assert calls == ["emulator-5554", "emulator-5556"]
