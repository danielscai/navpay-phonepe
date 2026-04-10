import sys
from pathlib import Path
import xml.etree.ElementTree as ET

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as orch  # noqa: E402


def _prepare_release_artifacts(tmp_path: Path) -> Path:
    work_dir = tmp_path / "work"
    work_dir.mkdir(parents=True, exist_ok=True)
    (work_dir / orch.DEFAULT_SIGNED_APK).write_bytes(b"base")
    (work_dir / "split_config.arm64_v8a.apk").write_bytes(b"abi")
    (work_dir / "split_config.xxhdpi.apk").write_bytes(b"density")
    return work_dir


def _patch_release_idempotent(monkeypatch, work_dir: Path, version_name: str, version_code: int):
    monkeypatch.setattr(
        orch,
        "resolve_release_env_settings",
        lambda target_env: {"env_name": target_env, "base_url": "http://localhost:3000", "token": "token"},
    )
    monkeypatch.setattr(
        orch,
        "release_list_releases",
        lambda base_url, token, app_id: [
            {
                "status": "active",
                "versionCode": version_code,
                "versionName": version_name,
                "baseSha256": "digest",
            }
        ],
    )
    monkeypatch.setattr(orch, "load_manifest", lambda: {"dummy": {"deps": []}})
    monkeypatch.setattr(
        orch,
        "resolve_release_split_files",
        lambda source_dir: [
            source_dir / "split_config.arm64_v8a.apk",
            source_dir / "split_config.xxhdpi.apk",
        ],
    )
    monkeypatch.setattr(
        orch,
        "collect_split_file_groups",
        lambda split_apks: {
            "abi": [p for p in split_apks if "arm64_v8a" in p.name],
            "density": [p for p in split_apks if "xxhdpi" in p.name],
        },
    )
    monkeypatch.setattr(
        orch,
        "read_apk_metadata",
        lambda path: {
            "versionCode": version_code,
            "packageName": "com.phonepe.app",
            "minSdk": 24,
            "targetSdk": 35,
            "installerMinVersion": 1,
        },
    )
    monkeypatch.setattr(orch, "read_signing_digest", lambda path: "sig")
    monkeypatch.setattr(orch, "sha256_file", lambda path: "digest")


def test_cmd_release_repack_mode_prefers_repack_path(monkeypatch, tmp_path):
    version_name = "26.04.10.1"
    version_code = 2604101
    work_dir = _prepare_release_artifacts(tmp_path)
    _patch_release_idempotent(monkeypatch, work_dir, version_name, version_code)

    called = {"repack": 0, "full": 0}

    def fake_repack(manifest, profile_name, bridge_version, bridge_schema_version, bridge_built_at_ms, snapshot_version=""):
        called["repack"] += 1
        assert profile_name == orch.COMPOSE_WORKFLOW_NAME
        assert bridge_version == version_name
        assert bridge_schema_version == 1
        assert isinstance(bridge_built_at_ms, int)
        return work_dir

    def fake_full(manifest, profile_name, fresh=False, snapshot_version=""):
        called["full"] += 1
        return work_dir

    monkeypatch.setattr(orch, "profile_apk_release_repack", fake_repack)
    monkeypatch.setattr(orch, "profile_apk", fake_full)

    code = orch.cmd_release(
        app="phonepe",
        version=version_name,
        target_env="dev",
        release_mode=orch.RELEASE_MODE_REPACK,
    )

    assert code == 0
    assert called == {"repack": 1, "full": 0}


def test_cmd_release_full_mode_uses_full_build_path(monkeypatch, tmp_path):
    version_name = "26.04.10.1"
    version_code = 2604101
    work_dir = _prepare_release_artifacts(tmp_path)
    _patch_release_idempotent(monkeypatch, work_dir, version_name, version_code)

    called = {"repack": 0, "full": 0}

    def fake_repack(manifest, profile_name, bridge_version, bridge_schema_version, bridge_built_at_ms, snapshot_version=""):
        called["repack"] += 1
        return work_dir

    def fake_full(manifest, profile_name, fresh=False, snapshot_version=""):
        called["full"] += 1
        assert fresh is False
        return work_dir

    monkeypatch.setattr(orch, "profile_apk_release_repack", fake_repack)
    monkeypatch.setattr(orch, "profile_apk", fake_full)

    code = orch.cmd_release(
        app="phonepe",
        version=version_name,
        target_env="dev",
        release_mode=orch.RELEASE_MODE_FULL,
    )

    assert code == 0
    assert called == {"repack": 0, "full": 1}


def test_apply_bridge_metadata_to_manifest_upserts_version_provider(tmp_path):
    manifest_path = tmp_path / "AndroidManifest.xml"
    manifest_path.write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application />
</manifest>
""",
        encoding="utf-8",
    )

    orch.apply_bridge_metadata_to_manifest(
        manifest_path,
        bridge_version="26.04.10.1",
        bridge_schema_version=1,
        bridge_built_at_ms=1712707200000,
    )

    tree = ET.parse(manifest_path)
    root = tree.getroot()
    ns_android = "http://schemas.android.com/apk/res/android"
    provider = root.find("application/provider")
    assert provider is not None
    assert provider.get(f"{{{ns_android}}}authorities") == "com.phonepe.navpay.bridge.version.provider"
    values = {
        node.get(f"{{{ns_android}}}name"): node.get(f"{{{ns_android}}}value")
        for node in provider.findall("meta-data")
    }
    assert values["navpay.bridge.version"] == "26.04.10.1"
    assert values["navpay.bridge.schema.version"] == "1"
    assert values["navpay.bridge.built.at.ms"] == "1712707200000"
