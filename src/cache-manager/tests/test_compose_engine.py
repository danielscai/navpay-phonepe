import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from compose_engine import detect_conflicts


class ComposeEngineTest(unittest.TestCase):
    def test_detect_conflicts_raises_on_same_reset_path(self) -> None:
        manifest = {
            "phonepe_sigbypass": {
                "reset_paths": [
                    "smali/com/phonepe/app/PhonePeApplication.smali",
                ]
            },
            "phonepe_https_interceptor": {
                "reset_paths": [
                    "smali/com/phonepe/app/PhonePeApplication.smali",
                ]
            },
        }

        with self.assertRaises(ValueError) as exc:
            detect_conflicts(
                manifest,
                ["phonepe_sigbypass", "phonepe_https_interceptor"],
            )

        self.assertIn("reset_paths conflict", str(exc.exception))

    def test_detect_conflicts_no_conflict(self) -> None:
        manifest = {
            "phonepe_sigbypass": {
                "reset_paths": [
                    "smali/com/phonepe/app/PhonePeApplication.smali",
                ]
            },
            "phonepe_https_interceptor": {
                "reset_paths": [
                    "AndroidManifest.xml",
                ]
            },
        }

        detect_conflicts(
            manifest,
            ["phonepe_sigbypass", "phonepe_https_interceptor"],
        )


if __name__ == "__main__":
    unittest.main()
