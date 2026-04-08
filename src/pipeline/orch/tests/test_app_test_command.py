import sys
from pathlib import Path

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as orch  # noqa: E402


def test_app_test_validates_launch_logs_and_unexpected_screen(monkeypatch):
    calls = []
    monkeypatch.setattr(orch, "load_manifest", lambda: {"dummy": {"deps": []}})
    parser = orch.build_parser()
    parsed = parser.parse_args(["test", "phonepe"])
    assert getattr(parsed, "app", None) == "phonepe"

    def fake_profile_test(
        manifest,
        profile_name,
        serial,
        smoke=False,
        install_mode="reinstall",
        snapshot_version="",
    ):
        del manifest, profile_name, serial, snapshot_version
        calls.append((smoke, install_mode))

    monkeypatch.setattr(orch, "profile_test", fake_profile_test)
    orch.main(["test", "phonepe"])
    assert calls == [(False, "split-session")]
