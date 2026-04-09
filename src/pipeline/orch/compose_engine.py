import shutil
import os
import time
from pathlib import Path

from cache_layout import (
    DEFAULT_APP,
    profile_build_path as layout_profile_build_path,
    profile_workspace_path as layout_profile_workspace_path,
)


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
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


def profile_workspace_path(profile: str, app: str = DEFAULT_APP) -> Path:
    return layout_profile_workspace_path(profile, app)


def profile_build_path(profile: str, app: str = DEFAULT_APP) -> Path:
    return layout_profile_build_path(profile, app)


def make_workspace_writable(path: Path) -> None:
    for root, dirs, files in os.walk(path):
        for filename in files:
            file_path = Path(root) / filename
            try:
                file_path.chmod(file_path.stat().st_mode | 0o200)
            except FileNotFoundError:
                pass
        for dirname in dirs:
            dir_path = Path(root) / dirname
            try:
                dir_path.chmod(dir_path.stat().st_mode | 0o200)
            except FileNotFoundError:
                pass
    try:
        path.chmod(path.stat().st_mode | 0o200)
    except FileNotFoundError:
        pass


def refresh_profile_workspace(profile: str, baseline_dir: Path, app: str = DEFAULT_APP) -> Path:
    profile_key = profile
    if not baseline_dir.exists():
        raise RuntimeError(f"Baseline decompiled cache not found: {baseline_dir}")
    workspace = profile_workspace_path(profile_key, app)
    if workspace.exists():
        make_workspace_writable(workspace)
        for _ in range(3):
            try:
                shutil.rmtree(workspace)
                break
            except OSError:
                time.sleep(0.1)
        if workspace.exists():
            shutil.rmtree(workspace, ignore_errors=True)
        if workspace.exists():
            raise RuntimeError(f"Failed to clean compose workspace: {workspace}")
    shutil.copytree(baseline_dir, workspace)
    make_workspace_writable(workspace)
    return workspace
