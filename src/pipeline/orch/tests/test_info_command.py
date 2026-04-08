import json
import sys
from pathlib import Path

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as orch  # noqa: E402


def test_info_lists_collected_versions_per_app(tmp_path, monkeypatch, capsys):
    phonepe_root = tmp_path / "cache" / "phonepe" / "snapshots"
    paytm_root = tmp_path / "cache" / "paytm" / "snapshots"
    phonepe_root.mkdir(parents=True, exist_ok=True)
    paytm_root.mkdir(parents=True, exist_ok=True)

    phonepe_index = {
        "snapshots": [
            {"versionCode": "26022705", "signingDigest": "abc", "updated_at": "2026-04-09T10:00:00"}
        ]
    }
    paytm_index = {
        "snapshots": [
            {"versionCode": "11223344", "signingDigest": "def", "updated_at": "2026-04-09T10:05:00"}
        ]
    }
    (phonepe_root / "index.json").write_text(json.dumps(phonepe_index), encoding="utf-8")
    (paytm_root / "index.json").write_text(json.dumps(paytm_index), encoding="utf-8")

    monkeypatch.setattr(orch, "REPO_ROOT", tmp_path)
    code = orch.cmd_info()
    out = capsys.readouterr().out
    assert code == 0
    assert "phonepe" in out
    assert "26022705" in out
    assert "paytm" in out
    assert "11223344" in out
