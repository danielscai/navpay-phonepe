import unittest
import sys
from pathlib import Path

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as orch  # noqa: E402


class CliContractTest(unittest.TestCase):
    def test_cli_supports_app_scoped_commands_and_default_help(self) -> None:
        parser = orch.build_parser()
        args = parser.parse_args(["build", "phonepe"])
        self.assertEqual(args.cmd, "build")
        self.assertEqual(args.app, "phonepe")

    def test_top_level_profile_actions_exist(self) -> None:
        parser = orch.build_parser()
        for cmd in ("plan", "prepare", "smali", "merge", "apk", "test"):
            args = parser.parse_args([cmd])
            self.assertEqual(args.cmd, cmd)
            self.assertEqual(args.profile, "full")

    def test_legacy_aliases_are_removed(self) -> None:
        parser = orch.build_parser()
        for legacy in ("profile", "sigbypass", "https", "phonepehelper"):
            with self.assertRaises(SystemExit):
                parser.parse_args([legacy])

    def test_main_rejects_smoke_for_non_test_action(self) -> None:
        with self.assertRaises(SystemExit) as exc:
            orch.main(["plan", "--smoke"])
        self.assertEqual(exc.exception.code, 2)

    def test_device_command_accepts_optional_serial(self) -> None:
        parser = orch.build_parser()
        args = parser.parse_args(["device"])
        self.assertEqual(args.cmd, "device")
        self.assertIsNone(args.serial)

        args_with_serial = parser.parse_args(["device", "21359de40707"])
        self.assertEqual(args_with_serial.cmd, "device")
        self.assertEqual(args_with_serial.serial, "21359de40707")

    def test_collect_command_accepts_matrix_and_resume_args(self) -> None:
        parser = orch.build_parser()
        args = parser.parse_args(["collect", "--matrix", "a.json", "--resume", "run_1"])
        self.assertEqual(args.cmd, "collect")
        self.assertEqual(args.matrix, "a.json")
        self.assertEqual(args.resume, "run_1")

    def test_profile_actions_accept_snapshot_version_arg(self) -> None:
        parser = orch.build_parser()
        for cmd in ("plan", "prepare", "smali", "merge", "apk", "test"):
            with self.subTest(cmd=cmd):
                args = parser.parse_args([cmd, "--snapshot-version", "26022705"])
                self.assertEqual(args.cmd, cmd)
                self.assertEqual(args.snapshot_version, "26022705")


if __name__ == "__main__":
    unittest.main()


def test_main_without_args_prints_help_and_exits_zero(capsys):
    code = orch.main([])
    out = capsys.readouterr().out
    assert code == 0
    assert "collect" in out
    assert "decompiled" in out
