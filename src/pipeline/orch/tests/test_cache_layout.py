import sys
from pathlib import Path

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import cache_layout  # noqa: E402
import orchestrator as orch  # noqa: E402


def test_phonepe_paths_are_app_scoped(tmp_path, monkeypatch):
    monkeypatch.setattr(cache_layout, "REPO_ROOT", tmp_path)
    paths = cache_layout.paths_for_app("phonepe")
    assert paths.snapshots_root == tmp_path / "cache/apps/phonepe/snapshots"
    assert paths.decompiled == tmp_path / "cache/apps/phonepe/decompiled"
    assert paths.snapshot_seed == tmp_path / "cache/apps/phonepe/snapshot_seed"
    assert paths.compose_workspace == tmp_path / "cache/apps/phonepe/compose/injection_workspace"
    assert paths.compose_release_apk == tmp_path / "cache/apps/phonepe/compose/release_apk"
    assert paths.module_artifacts_root == tmp_path / "cache/apps/phonepe/modules"


def test_module_artifact_path_is_app_scoped(tmp_path, monkeypatch):
    monkeypatch.setattr(cache_layout, "REPO_ROOT", tmp_path)
    path = orch.module_artifact_path("phonepe_sigbypass")
    assert path == tmp_path / "cache/apps/phonepe/modules/phonepe_sigbypass/artifacts"
