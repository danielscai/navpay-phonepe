import sys
import unittest
from pathlib import Path
from unittest import mock

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as cache_manager  # noqa: E402


class CollectEmulatorSnapshotTest(unittest.TestCase):
    def test_collect_emulator_args_strip_snapshot_disable_flags(self) -> None:
        args = ["-gpu", "swiftshader_indirect", "-no-snapshot-load", "-no-snapshot-save"]
        sanitized = cache_manager.collect_emulator_args_with_snapshot(args)
        self.assertNotIn("-no-snapshot-load", sanitized)
        self.assertNotIn("-no-snapshot-save", sanitized)
        self.assertEqual(sanitized, ["-gpu", "swiftshader_indirect"])

    def test_shutdown_collect_emulators_saves_snapshot_before_kill(self) -> None:
        run_state = {"_collect_serials": ["emulator-5554", "FAKE_DEVICE_01"]}
        with mock.patch.object(cache_manager, "adb_path", return_value="adb"), \
            mock.patch.object(cache_manager.subprocess, "run") as run_mock:
            cache_manager.shutdown_collect_emulators(run_state)

        calls = [c.args[0] for c in run_mock.call_args_list]
        self.assertEqual(
            calls,
            [
                ["adb", "-s", "emulator-5554", "emu", "avd", "snapshot", "save", "navpay_collect_last"],
                ["adb", "-s", "emulator-5554", "emu", "kill"],
            ],
        )


if __name__ == "__main__":
    unittest.main()
