import json
import os
from pathlib import Path


def test_package_scripts_expose_orch_install_and_uninstall() -> None:
    package = json.loads(Path("package.json").read_text(encoding="utf-8"))
    scripts = package.get("scripts", {})
    assert scripts.get("install:orch") == "bash scripts/install_orch.sh"
    assert scripts.get("install:orch:global") == "bash scripts/install_orch.sh --global"
    assert scripts.get("uninstall:orch") == "bash scripts/uninstall_orch.sh"


def test_orch_launcher_and_installer_scripts_exist() -> None:
    for rel in ("scripts/orch", "scripts/install_orch.sh", "scripts/uninstall_orch.sh"):
        path = Path(rel)
        assert path.exists(), f"missing file: {rel}"
        assert path.is_file(), f"not a file: {rel}"
        assert os.access(path, os.X_OK), f"not executable: {rel}"


def test_orch_launcher_points_to_orchestrator() -> None:
    launcher = Path("scripts/orch").read_text(encoding="utf-8")
    assert "src/pipeline/orch/orchestrator.py" in launcher
    assert "python3" in launcher
