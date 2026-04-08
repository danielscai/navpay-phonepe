import json
from pathlib import Path


def test_package_scripts_expose_orch_shortcuts():
    package = json.loads(Path("package.json").read_text(encoding="utf-8"))
    scripts = package.get("scripts", {})
    assert scripts.get("collect") == "yarn orch collect"
    assert scripts.get("info") == "yarn orch info"
    assert scripts.get("decompiled") == "yarn orch decompiled"
    assert scripts.get("build") == "yarn orch build"
    assert scripts.get("install") == "yarn orch install"
    assert scripts.get("test") == "yarn orch test"
