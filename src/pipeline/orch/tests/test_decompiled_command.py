import sys
from pathlib import Path

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as orch  # noqa: E402


def test_decompile_command_supports_latest_and_version_pin(monkeypatch, tmp_path, capsys):
    calls = []
    capture_dir = tmp_path / "captures" / "emu1"
    capture_dir.mkdir(parents=True, exist_ok=True)
    base_apk = capture_dir / "base.apk"
    base_apk.write_text("apk", encoding="utf-8")

    monkeypatch.setattr(orch, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(orch, "resolve_app_package", lambda app: "net.one97.paytm" if app == "paytm" else "com.phonepe.app")
    monkeypatch.setattr(
        orch,
        "resolve_snapshot_anchor",
        lambda index_path, package, snapshot_version="": {
            "packageName": package,
            "versionCode": snapshot_version or "latest",
            "signingDigest": "deadbeef",
        },
    )
    monkeypatch.setattr(orch, "resolve_snapshot_capture_dir_for_base", lambda snapshots_root, anchor: capture_dir)

    def fake_run(cmd, cwd=None, env=None, check=True, concise=False):
        del cwd, env, check, concise
        calls.append(cmd)

    monkeypatch.setattr(orch, "run", fake_run)
    monkeypatch.setattr(orch, "delete_cache_dir", lambda path: (_ for _ in ()).throw(RuntimeError("should not call delete_cache_dir")))

    existing = tmp_path / "cache" / "paytm" / "decompiled" / "base_decompiled_clean" / "drawable"
    existing.mkdir(parents=True, exist_ok=True)
    (existing / "a.txt").write_text("x", encoding="utf-8")

    assert orch.main(["decompile", "paytm"]) == 0
    assert orch.main(["decompile", "paytm", "26022705"]) == 0
    out = capsys.readouterr().out
    assert "base_decompiled_clean" in out
    assert calls[0][0] == "apktool"
    assert str(base_apk) in calls[0]
    assert str(tmp_path / "cache" / "paytm" / "decompiled" / "base_decompiled_clean") in calls[0]
