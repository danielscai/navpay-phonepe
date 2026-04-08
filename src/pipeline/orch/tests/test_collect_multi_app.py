import sys
from pathlib import Path

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as orch  # noqa: E402


def test_collect_all_runs_all_apps_per_emulator_before_next_emulator(monkeypatch):
    order = []
    matrix = {
        "bootstrap_target_id": "emu1",
        "targets": [
            {"target_id": "emu1", "serial_alias": "emulator-5554"},
            {"target_id": "emu2", "serial_alias": "emulator-5556"},
        ],
    }

    monkeypatch.setattr(orch, "load_device_matrix", lambda _: matrix)

    def fake_collect_for_app_target(app, target, matrix_path, resume=None, snapshots_root=None):
        del matrix_path, resume, snapshots_root
        order.append(f"{target['target_id']}-{app}")
        return 0

    monkeypatch.setattr(orch, "run_collect_for_app_target", fake_collect_for_app_target)

    code = orch.run_collect_all_apps("dummy.json", ["phonepe", "paytm"])
    assert code == 0
    assert order == ["emu1-phonepe", "emu1-paytm", "emu2-phonepe", "emu2-paytm"]
