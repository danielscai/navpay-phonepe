import shutil
import os
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
CACHE_DIR = REPO_ROOT / "cache"


def detect_conflicts(mod_cfg: dict, modules: list):
    seen = {}
    for module in modules:
        cfg = mod_cfg.get(module)
        if cfg is None:
            raise ValueError(f"Module not found in manifest: {module}")
        for reset_path in cfg.get("reset_paths", []):
            previous = seen.get(reset_path)
            if previous and previous != module:
                raise ValueError(
                    "reset_paths conflict: "
                    f"'{reset_path}' used by '{previous}' and '{module}'"
                )
            seen[reset_path] = module


def profile_workspace_path(profile: str) -> Path:
    return CACHE_DIR / f"profile_{profile}_workspace"


def profile_build_path(profile: str) -> Path:
    return CACHE_DIR / f"profile_{profile}_build"


def make_workspace_writable(path: Path) -> None:
    for root, dirs, files in os.walk(path):
        for filename in files:
            file_path = Path(root) / filename
            file_path.chmod(file_path.stat().st_mode | 0o200)
        for dirname in dirs:
            dir_path = Path(root) / dirname
            dir_path.chmod(dir_path.stat().st_mode | 0o200)
    path.chmod(path.stat().st_mode | 0o200)


def refresh_profile_workspace(profile: str, baseline_dir: Path) -> Path:
    if not baseline_dir.exists():
        raise RuntimeError(f"Baseline decompiled cache not found: {baseline_dir}")
    workspace = profile_workspace_path(profile)
    if workspace.exists():
        make_workspace_writable(workspace)
        shutil.rmtree(workspace)
    shutil.copytree(baseline_dir, workspace)
    make_workspace_writable(workspace)
    return workspace
