import sys
import tempfile
from pathlib import Path

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as cache_manager  # noqa: E402


def test_enforce_dex_compression_removes_dex_from_do_not_compress():
    with tempfile.TemporaryDirectory() as tempdir:
        workspace = Path(tempdir)
        apktool_yml = workspace / "apktool.yml"
        apktool_yml.write_text(
            "\n".join(
                [
                    "version: 2.12.1",
                    "doNotCompress:",
                    "- arsc",
                    "- dex",
                    "- png",
                    "packageInfo:",
                    "  forcedPackageId: 127",
                    "",
                ]
            ),
            encoding="utf-8",
        )

        cache_manager.enforce_dex_compression(workspace)

        after = apktool_yml.read_text(encoding="utf-8")
        assert "- dex\n" not in after
        assert "- arsc\n" in after
        assert "- png\n" in after


def test_enforce_dex_compression_no_apktool_yml_is_noop():
    with tempfile.TemporaryDirectory() as tempdir:
        workspace = Path(tempdir)
        cache_manager.enforce_dex_compression(workspace)
