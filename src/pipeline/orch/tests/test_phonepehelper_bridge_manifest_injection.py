import os
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]
MERGE_SH = REPO_ROOT / "src/apk/phonepehelper/scripts/merge.sh"
ANDROID_NS = "http://schemas.android.com/apk/res/android"


class PhonePeHelperBridgeManifestInjectionTest(unittest.TestCase):
    def test_merge_script_injects_bridge_version_provider_and_meta_data(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            artifact_dir = root / "artifact"
            target_dir = root / "workspace"

            (artifact_dir / "smali/com/phonepehelper").mkdir(parents=True, exist_ok=True)
            (artifact_dir / "smali/com/PhonePeTweak/Def").mkdir(parents=True, exist_ok=True)
            (artifact_dir / "smali/com/indipay/inject").mkdir(parents=True, exist_ok=True)
            (artifact_dir / "smali/com/phonepe/app").mkdir(parents=True, exist_ok=True)
            (target_dir / "smali/com/phonepe/app").mkdir(parents=True, exist_ok=True)

            (artifact_dir / "smali/com/PhonePeTweak/Def/PhonePeHelper.smali").write_text(
                ".class public Lcom/PhonePeTweak/Def/PhonePeHelper;\n",
                encoding="utf-8",
            )
            (artifact_dir / "smali/com/phonepehelper/NavpayBridgeProvider.smali").write_text(
                "com.indipay.inject.Dispatcher\n",
                encoding="utf-8",
            )
            (artifact_dir / "smali/com/phonepehelper/NavpayBridgeVersionProvider.smali").write_text(
                ".class public Lcom/phonepehelper/NavpayBridgeVersionProvider;\n",
                encoding="utf-8",
            )
            (artifact_dir / "smali/com/indipay/inject/Dispatcher.smali").write_text(
                "invoke-static {p0}, Lcom/phonepehelper/ModuleInit;->init(Landroid/content/Context;)V\n",
                encoding="utf-8",
            )
            (artifact_dir / "smali/com/phonepe/app/PhonePeApplication.smali").write_text(
                ".class public Lcom/phonepe/app/PhonePeApplication;\n",
                encoding="utf-8",
            )

            manifest = target_dir / "AndroidManifest.xml"
            manifest.write_text(
                "<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\" package=\"com.phonepe.app\">"
                "<application />"
                "</manifest>",
                encoding="utf-8",
            )

            bridge_version = "26.04.10.1"
            bridge_schema_version = "3"
            bridge_built_at_ms = "1710000000000"
            env = os.environ.copy()
            env.update(
                {
                    "NAVPAY_SKIP_APP_DISPATCHER_INJECT": "1",
                    "BRIDGE_VERSION": bridge_version,
                    "BRIDGE_SCHEMA_VERSION": bridge_schema_version,
                    "BRIDGE_BUILT_AT_MS": bridge_built_at_ms,
                }
            )

            subprocess.run(
                [str(MERGE_SH), "--artifact-dir", str(artifact_dir), str(target_dir)],
                cwd=REPO_ROOT,
                env=env,
                check=True,
                capture_output=True,
                text=True,
            )

            tree = ET.parse(manifest)
            root_node = tree.getroot()
            app = root_node.find("application")
            self.assertIsNotNone(app)
            assert app is not None

            providers = {
                node.get(f"{{{ANDROID_NS}}}name"): node
                for node in app.findall("provider")
            }
            self.assertIn("com.phonepehelper.NavpayBridgeProvider", providers)
            self.assertIn("com.phonepehelper.NavpayBridgeVersionProvider", providers)

            version_provider = providers["com.phonepehelper.NavpayBridgeVersionProvider"]
            self.assertEqual(
                version_provider.get(f"{{{ANDROID_NS}}}authorities"),
                "com.phonepe.navpay.bridge.version.provider",
            )

            meta = {
                node.get(f"{{{ANDROID_NS}}}name"): node.get(f"{{{ANDROID_NS}}}value")
                for node in version_provider.findall("meta-data")
            }
            self.assertEqual(meta["navpay.bridge.version"], bridge_version)
            self.assertEqual(meta["navpay.bridge.schema.version"], bridge_schema_version)
            self.assertEqual(meta["navpay.bridge.built.at.ms"], bridge_built_at_ms)


if __name__ == "__main__":
    unittest.main()
