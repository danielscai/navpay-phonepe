import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as cache_manager  # noqa: E402


class CollectExecuteTargetTest(unittest.TestCase):
    def test_execute_collect_target_returns_real_anchor_and_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            run_dir = root / "run"
            run_dir.mkdir(parents=True, exist_ok=True)

            package = "com.phonepe.app"
            matrix = {"package": package}
            target = {
                "target_id": "emu_arm64_xxhdpi",
                "serial_alias": "emulator-5554",
                "expected_split_abi": "arm64_v8a",
                "expected_split_density": "xxhdpi",
            }

            fake_device_dir = root / "device"
            fake_device_dir.mkdir(parents=True, exist_ok=True)
            (fake_device_dir / "base.apk").write_text("base", encoding="utf-8")
            (fake_device_dir / "split_config.arm64_v8a.apk").write_text("abi", encoding="utf-8")
            (fake_device_dir / "split_config.x86_64.apk").write_text("abi-x86_64", encoding="utf-8")
            (fake_device_dir / "split_config.xxhdpi.apk").write_text("density", encoding="utf-8")
            (fake_device_dir / "split_config.xhdpi.apk").write_text("density-xhdpi", encoding="utf-8")

            def fake_run(cmd, cwd=None, env=None, check=True, concise=False):
                del cwd, env, check, concise
                if len(cmd) >= 6 and cmd[0] == "adb" and cmd[3] == "pull":
                    src = Path(cmd[4]).name
                    dst_dir = Path(cmd[5])
                    dst_dir.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(fake_device_dir / src, dst_dir / src)

            def fake_check_output(cmd, text=True, stderr=None, timeout=None):
                del text, stderr, timeout
                if cmd[:6] == ["adb", "-s", "emulator-5554", "shell", "pm", "path"]:
                    return "\n".join(
                        [
                            "package:/data/app/com.phonepe.app/base.apk",
                            "package:/data/app/com.phonepe.app/split_config.arm64_v8a.apk",
                            "package:/data/app/com.phonepe.app/split_config.x86_64.apk",
                            "package:/data/app/com.phonepe.app/split_config.xxhdpi.apk",
                            "package:/data/app/com.phonepe.app/split_config.xhdpi.apk",
                        ]
                    )
                if cmd[:6] == ["adb", "-s", "emulator-5554", "shell", "dumpsys", "package"]:
                    return "versionCode=26040100 minSdk=24"
                raise AssertionError(f"Unexpected command: {cmd}")

            with mock.patch.object(cache_manager, "adb_path", return_value="adb"), \
                mock.patch.object(cache_manager, "select_device", return_value="emulator-5554"), \
                mock.patch.object(cache_manager, "run", side_effect=fake_run), \
                mock.patch.object(cache_manager.subprocess, "check_output", side_effect=fake_check_output), \
                mock.patch.object(cache_manager, "read_supported_abis", return_value=["arm64-v8a"]), \
                mock.patch.object(cache_manager, "read_density_value", return_value=420), \
                mock.patch.object(cache_manager, "find_build_tool", return_value=Path("/tmp/apksigner")), \
                mock.patch.object(cache_manager, "read_apk_signing_digest", return_value="abc123"):
                result = cache_manager.execute_collect_target(matrix, target, {}, run_dir)

            self.assertEqual(result["status"], "done")
            self.assertEqual(result["anchor"]["packageName"], package)
            self.assertEqual(result["anchor"]["versionCode"], "26040100")
            self.assertEqual(result["anchor"]["signingDigest"], "abc123")
            self.assertTrue(Path(result["artifacts"]["base_apk"]).exists())
            self.assertTrue(Path(result["artifacts"]["abi_split_apk"]).exists())
            self.assertTrue(Path(result["artifacts"]["density_split_apk"]).exists())
            self.assertEqual(len(result["artifacts"]["split_apks"]), 4)


if __name__ == "__main__":
    unittest.main()
