import json
from pathlib import Path


def test_package_scripts_expose_orch_shortcuts():
    package = json.loads(Path("package.json").read_text(encoding="utf-8"))
    scripts = package.get("scripts", {})
    assert scripts.get("collect") == "python3 src/pipeline/orch/orchestrator.py collect"
    assert scripts.get("info") == "python3 src/pipeline/orch/orchestrator.py info"
    assert scripts.get("decompile") == "python3 src/pipeline/orch/orchestrator.py decompile"
    assert scripts.get("build") == "python3 src/pipeline/orch/orchestrator.py build"
    assert scripts.get("install") == "python3 src/pipeline/orch/orchestrator.py install"
    assert scripts.get("test") == "python3 src/pipeline/orch/orchestrator.py test"
