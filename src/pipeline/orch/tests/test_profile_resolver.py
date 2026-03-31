import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from profile_resolver import resolve_profile


class ProfileResolverTest(unittest.TestCase):
    def test_full_profile_order(self) -> None:
        modules = resolve_profile("full")
        self.assertEqual(
            modules,
            [
                "phonepe_sigbypass",
                "phonepe_https_interceptor",
                "phonepe_phonepehelper",
                "heartbeat_bridge",
            ],
        )

    def test_unknown_profile_raises(self) -> None:
        with self.assertRaises(ValueError) as exc:
            resolve_profile("not-exists")
        self.assertIn("Unknown profile", str(exc.exception))

    def test_duplicate_modules_raises(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            profile_path = Path(temp_dir) / "profiles.json"
            profile_path.write_text(
                json.dumps(
                    {
                        "dup": [
                            "phonepe_sigbypass",
                            "phonepe_sigbypass",
                        ]
                    }
                ),
                encoding="utf-8",
            )

            with self.assertRaises(ValueError) as exc:
                resolve_profile("dup", profile_path)

            self.assertIn("duplicate", str(exc.exception).lower())


if __name__ == "__main__":
    unittest.main()
