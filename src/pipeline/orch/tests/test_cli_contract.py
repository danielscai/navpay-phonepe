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

    def test_removed_stage_subcommands_are_rejected(self) -> None:
        parser = orch.build_parser()
        for cmd in ("plan", "prepare", "smali", "merge", "apk"):
            with self.assertRaises(SystemExit):
                parser.parse_args([cmd])

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
        self.assertEqual(args.yes, False)

        args_yes = parser.parse_args(["collect", "-y"])
        self.assertEqual(args_yes.cmd, "collect")
        self.assertEqual(args_yes.yes, True)

    def test_build_and_test_accept_snapshot_version_arg(self) -> None:
        parser = orch.build_parser()
        for cmd in ("build", "test"):
            with self.subTest(cmd=cmd):
                base_args = [cmd]
                if cmd == "build":
                    base_args.append("phonepe")
                args = parser.parse_args(base_args + ["--snapshot-version", "26022705"])
                self.assertEqual(args.cmd, cmd)
                self.assertEqual(args.snapshot_version, "26022705")

    def test_build_accepts_stage_flags(self) -> None:
        parser = orch.build_parser()
        args = parser.parse_args(["build", "phonepe", "--smali"])
        self.assertTrue(args.smali)
        self.assertFalse(args.merge)
        args = parser.parse_args(["build", "phonepe", "--merge"])
        self.assertTrue(args.merge)
        self.assertFalse(args.smali)

    def test_install_accepts_rebuild_flag(self) -> None:
        parser = orch.build_parser()
        args = parser.parse_args(["install", "phonepe", "--rebuild"])
        self.assertEqual(args.cmd, "install")
        self.assertEqual(args.app, "phonepe")
        self.assertTrue(args.rebuild)


if __name__ == "__main__":
    unittest.main()


def test_main_without_args_prints_help_and_exits_zero(capsys):
    code = orch.main([])
    out = capsys.readouterr().out
    assert code == 0
    assert "collect" in out
    assert "decompile" in out


def test_build_command_routes_to_profile_apk(monkeypatch):
    calls = []
    monkeypatch.setattr(orch, "load_manifest", lambda: {"dummy": {"deps": []}})

    def fake_profile_apk(manifest, profile_name, fresh=False, snapshot_version=""):
        del manifest
        calls.append((profile_name, fresh, snapshot_version))

    monkeypatch.setattr(orch, "profile_apk", fake_profile_apk)
    orch.main(["build", "phonepe"])
    assert calls == [("compose", False, "")]


def test_build_smali_flag_routes_to_smali_stage(monkeypatch):
    called = {"smali": 0, "apk": 0}
    monkeypatch.setattr(orch, "load_manifest", lambda: {"dummy": {"deps": []}})
    monkeypatch.setattr(orch, "profile_build_modules", lambda manifest, profile: called.__setitem__("smali", called["smali"] + 1))
    monkeypatch.setattr(orch, "profile_apk", lambda *args, **kwargs: called.__setitem__("apk", called["apk"] + 1))
    orch.main(["build", "phonepe", "--smali"])
    assert called == {"smali": 1, "apk": 0}


def test_build_merge_flag_routes_to_merge_stage(monkeypatch):
    called = {"merge": 0, "apk": 0}
    monkeypatch.setattr(orch, "load_manifest", lambda: {"dummy": {"deps": []}})
    monkeypatch.setattr(orch, "profile_merge", lambda *args, **kwargs: called.__setitem__("merge", called["merge"] + 1))
    monkeypatch.setattr(orch, "profile_apk", lambda *args, **kwargs: called.__setitem__("apk", called["apk"] + 1))
    orch.main(["build", "phonepe", "--merge"])
    assert called == {"merge": 1, "apk": 0}


def test_main_without_explicit_argv_uses_process_args(monkeypatch):
    calls = []
    monkeypatch.setattr(orch, "load_manifest", lambda: {"dummy": {"deps": []}})
    monkeypatch.setattr(sys, "argv", ["orchestrator.py", "build", "phonepe"])

    def fake_profile_apk(manifest, profile_name, fresh=False, snapshot_version=""):
        del manifest
        calls.append((profile_name, fresh, snapshot_version))

    monkeypatch.setattr(orch, "profile_apk", fake_profile_apk)
    assert orch.main() == 0
    assert calls == [("compose", False, "")]


def test_collect_yes_routes_to_run_collect_with_auto_yes(monkeypatch):
    monkeypatch.setattr(orch, "load_manifest", lambda: {"dummy": {"deps": []}})
    monkeypatch.setattr(orch, "resolve_app_package", lambda app: "com.phonepe.app" if app == "phonepe" else app)
    monkeypatch.setattr(orch, "snapshots_root_for_app", lambda app: Path(f"/tmp/cache/apps/{app}/snapshots"))

    captured = {}

    def fake_run_collect(matrix_path, package, resume=None, snapshots_root=None, auto_yes=False):
        captured["matrix_path"] = matrix_path
        captured["package"] = package
        captured["resume"] = resume
        captured["snapshots_root"] = snapshots_root
        captured["auto_yes"] = auto_yes
        return 0

    monkeypatch.setattr(orch, "run_collect", fake_run_collect)
    code = orch.main(["collect", "phonepe", "--matrix", "a.json", "-y"])
    assert code == 0
    assert captured["matrix_path"] == "a.json"
    assert captured["package"] == "com.phonepe.app"
    assert str(captured["snapshots_root"]) == "/tmp/cache/apps/phonepe/snapshots"
    assert captured["auto_yes"] is True
