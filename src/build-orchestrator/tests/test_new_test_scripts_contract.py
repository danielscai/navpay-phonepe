import unittest
from pathlib import Path


class NewTestScriptsContractTest(unittest.TestCase):
    def test_new_fast_test_scripts_exist_and_executable(self) -> None:
        for script_path in (
            Path("src/tools/test_profile_full.sh"),
            Path("src/tools/test_module_independent.sh"),
        ):
            self.assertTrue(script_path.exists(), msg=f"Missing script: {script_path}")
            self.assertTrue(script_path.is_file(), msg=f"Not a file: {script_path}")

    def test_test_scripts_prepare_workspace_with_pre_cache(self) -> None:
        full_script = Path("src/tools/test_profile_full.sh").read_text(encoding="utf-8")
        independent_script = Path("src/tools/test_module_independent.sh").read_text(encoding="utf-8")
        self.assertIn("orchestrator.py pre-cache", full_script)
        self.assertIn("--profile sigbypass-only", independent_script)
        self.assertIn("--profile https-only", independent_script)
        self.assertIn("--profile phonepehelper-only", independent_script)


if __name__ == "__main__":
    unittest.main()
