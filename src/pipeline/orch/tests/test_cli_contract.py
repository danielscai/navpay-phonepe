import unittest
import sys
from pathlib import Path

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as orch  # noqa: E402


class CliContractTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
