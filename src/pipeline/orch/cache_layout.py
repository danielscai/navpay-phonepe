from dataclasses import dataclass
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
DEFAULT_APP = "phonepe"


@dataclass(frozen=True)
class AppCachePaths:
    app: str
    root: Path
    snapshots_root: Path
    snapshot_seed: Path
    merged: Path
    decompiled: Path
    profiles_root: Path
    module_artifacts_root: Path


def paths_for_app(app: str = DEFAULT_APP) -> AppCachePaths:
    app_name = (app or DEFAULT_APP).strip() or DEFAULT_APP
    root = (REPO_ROOT / "cache" / "apps" / app_name).resolve()
    return AppCachePaths(
        app=app_name,
        root=root,
        snapshots_root=root / "snapshots",
        snapshot_seed=root / "snapshot_seed",
        merged=root / "merged",
        decompiled=root / "decompiled",
        profiles_root=root / "profiles",
        module_artifacts_root=root / "modules",
    )


def profile_workspace_path(profile: str, app: str = DEFAULT_APP) -> Path:
    return paths_for_app(app).profiles_root / profile / "workspace"


def profile_build_path(profile: str, app: str = DEFAULT_APP) -> Path:
    return paths_for_app(app).profiles_root / profile / "build"


def module_artifact_path(module_name: str, app: str = DEFAULT_APP) -> Path:
    return paths_for_app(app).module_artifacts_root / module_name / "artifacts"
