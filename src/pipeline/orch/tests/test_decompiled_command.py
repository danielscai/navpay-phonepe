import sys
import errno
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


def test_delete_cache_dir_ignores_enoent_from_rmtree_callback(tmp_path):
    root = tmp_path / "cache" / "stale"
    child = root / "smali_classes5" / "com" / "mapmyindia" / "sdk" / "maps" / "MapmyIndiaMap$OnCameraMoveCanceledListener.smali"
    child.parent.mkdir(parents=True, exist_ok=True)
    child.write_text(".class public Lx;\n", encoding="utf-8")

    missing = FileNotFoundError(errno.ENOENT, "No such file or directory", str(child))
    orch.delete_cache_dir(root)

    # Simulate a callback invocation from shutil.rmtree for disappearing children.
    # Must be ignored without raising.
    def remove(_target):
        raise missing

    handler = None
    captured = {}

    def fake_rmtree(_path, onerror=None):
        captured["called"] = True
        onerror(remove, str(child), (FileNotFoundError, missing, None))
        # root removal still succeeds.
        return None

    original_rmtree = orch.shutil.rmtree
    orch.shutil.rmtree = fake_rmtree
    try:
        root.mkdir(parents=True, exist_ok=True)
        handler = orch.delete_cache_dir(root)
    finally:
        orch.shutil.rmtree = original_rmtree

    assert captured["called"] is True
    assert handler is None
