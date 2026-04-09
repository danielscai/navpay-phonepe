import sys
from pathlib import Path

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as orch  # noqa: E402


def test_decompiled_command_supports_latest_and_version_pin(monkeypatch):
    calls = []
    monkeypatch.setattr(orch, "load_manifest", lambda: {"dummy": {"deps": []}})

    def fake_ensure_phonepe_decompiled_snapshot(
        manifest,
        snapshot_version,
        package,
        snapshots_root=None,
        seed_path=None,
        merged_path=None,
        decompiled_path=None,
    ):
        del manifest, package
        calls.append((snapshot_version, str(snapshots_root), str(seed_path), str(merged_path), str(decompiled_path)))
        return decompiled_path, {"versionCode": snapshot_version or "latest"}

    monkeypatch.setattr(orch, "ensure_phonepe_decompiled_snapshot", fake_ensure_phonepe_decompiled_snapshot)

    assert orch.main(["decompiled", "phonepe"]) == 0
    assert orch.main(["decompiled", "phonepe", "26022705"]) == 0
    assert calls == [
        (
            "",
            str(orch.REPO_ROOT / "cache" / "snapshots" / "phonepe"),
            str(orch.REPO_ROOT / "cache" / "phonepe" / "snapshot_seed"),
            str(orch.REPO_ROOT / "cache" / "phonepe" / "merged"),
            str(orch.REPO_ROOT / "cache" / "phonepe" / "decompiled"),
        ),
        (
            "26022705",
            str(orch.REPO_ROOT / "cache" / "snapshots" / "phonepe"),
            str(orch.REPO_ROOT / "cache" / "phonepe" / "snapshot_seed"),
            str(orch.REPO_ROOT / "cache" / "phonepe" / "merged"),
            str(orch.REPO_ROOT / "cache" / "phonepe" / "decompiled"),
        ),
    ]
