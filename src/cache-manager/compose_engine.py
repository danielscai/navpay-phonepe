import shutil
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


def refresh_profile_workspace(profile: str, baseline_dir: Path) -> Path:
    if not baseline_dir.exists():
        raise RuntimeError(f"Baseline decompiled cache not found: {baseline_dir}")
    workspace = profile_workspace_path(profile)
    if workspace.exists():
        shutil.rmtree(workspace)
    shutil.copytree(baseline_dir, workspace)
    return workspace
