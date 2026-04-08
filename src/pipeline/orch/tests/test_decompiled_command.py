import sys
from pathlib import Path

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as orch  # noqa: E402


def test_decompiled_command_supports_latest_and_version_pin(monkeypatch):
    calls = []
    monkeypatch.setattr(orch, "load_manifest", lambda: {"dummy": {"deps": []}})

    def fake_profile_prepare(manifest, profile_name, snapshot_version):
        del manifest
        calls.append((profile_name, snapshot_version))

    monkeypatch.setattr(orch, "profile_prepare", fake_profile_prepare)

    assert orch.main(["decompiled", "phonepe"]) == 0
    assert orch.main(["decompiled", "phonepe", "26022705"]) == 0
    assert calls == [("full", ""), ("full", "26022705")]
