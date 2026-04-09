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
        assert "- so\n" in after


def test_enforce_dex_compression_no_apktool_yml_is_noop():
    with tempfile.TemporaryDirectory() as tempdir:
        workspace = Path(tempdir)
        cache_manager.enforce_dex_compression(workspace)


def test_enforce_dex_compression_adds_do_not_compress_when_missing():
    with tempfile.TemporaryDirectory() as tempdir:
        workspace = Path(tempdir)
        apktool_yml = workspace / "apktool.yml"
        apktool_yml.write_text(
            "\n".join(
                [
                    "version: 2.12.1",
                    "packageInfo:",
                    "  forcedPackageId: 127",
                    "",
                ]
            ),
            encoding="utf-8",
        )

        cache_manager.enforce_dex_compression(workspace)
        after = apktool_yml.read_text(encoding="utf-8")
        assert "doNotCompress:\n" in after
        assert "- so\n" in after


def test_sanitize_manifest_null_meta_data_removes_invalid_entries():
    with tempfile.TemporaryDirectory() as tempdir:
        workspace = Path(tempdir)
        manifest = workspace / "AndroidManifest.xml"
        manifest.write_text(
            "\n".join(
                [
                    "<manifest>",
                    "  <application>",
                    '    <meta-data android:name="ok1" android:value="x" />',
                    '    <meta-data android:name="bad1" android:resource="@null" />',
                    '    <meta-data android:name="bad2" android:value="@null" />',
                    "  </application>",
                    "</manifest>",
                    "",
                ]
            ),
            encoding="utf-8",
        )

        cache_manager.sanitize_manifest_null_meta_data(workspace)

        after = manifest.read_text(encoding="utf-8")
        assert 'android:name="ok1"' in after
        assert 'android:name="bad1"' not in after
        assert 'android:name="bad2"' not in after
