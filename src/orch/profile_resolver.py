import json
from pathlib import Path
from typing import Dict, List

SCRIPT_DIR = Path(__file__).resolve().parent
PROFILES_PATH = SCRIPT_DIR / "cache_profiles.json"


def load_profiles(path: Path = PROFILES_PATH) -> Dict[str, List[str]]:
    if not path.exists():
        raise FileNotFoundError(f"Missing profile config: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Invalid profile config: top-level must be an object")
    return data


def resolve_profile(name: str, path: Path = PROFILES_PATH) -> List[str]:
    profiles = load_profiles(path)
    if name not in profiles:
        raise ValueError(f"Unknown profile: {name}")

    modules = profiles[name]
    if not isinstance(modules, list) or not modules:
        raise ValueError(f"Invalid profile '{name}': module list must be non-empty")

    duplicates = sorted({m for m in modules if modules.count(m) > 1})
    if duplicates:
        raise ValueError(f"Invalid profile '{name}': duplicate modules: {', '.join(duplicates)}")

    return modules
