import unittest
from pathlib import Path


class NewTestScriptsContractTest(unittest.TestCase):
    def test_new_fast_test_scripts_exist_and_executable(self) -> None:
        for script_path in (
            Path("src/tools/test_profile_smoke.sh"),
            Path("src/tools/test_profile_full.sh"),
            Path("src/tools/test_module_independent.sh"),
        ):
            self.assertTrue(script_path.exists(), msg=f"Missing script: {script_path}")
            self.assertTrue(script_path.is_file(), msg=f"Not a file: {script_path}")

    def test_test_scripts_delegate_to_orchestrator_only(self) -> None:
        smoke_script = Path("src/tools/test_profile_smoke.sh").read_text(encoding="utf-8")
        full_script = Path("src/tools/test_profile_full.sh").read_text(encoding="utf-8")
        independent_script = Path("src/tools/test_module_independent.sh").read_text(encoding="utf-8")
        self.assertIn("orchestrator.py test --profile", smoke_script)
        self.assertNotIn("orchestrator.py pre-cache", smoke_script)
        self.assertIn("orchestrator.py test --serial", full_script)
        self.assertNotIn("orchestrator.py pre-cache", full_script)
        self.assertIn("--profile sigbypass-only", independent_script)
        self.assertIn("--profile https-only", independent_script)
        self.assertIn("--profile phonepehelper-only", independent_script)
        self.assertNotIn("orchestrator.py pre-cache", independent_script)

    def test_legacy_scripts_have_been_removed(self) -> None:
        removed = (
            Path("src/signature_bypass/tools/inject.sh"),
            Path("src/signature_bypass/tools/merge.sh"),
            Path("src/signature_bypass/tools/inject_hook.py"),
            Path("src/signature_bypass/scripts/verify_injection.sh"),
            Path("src/https_interceptor/build_and_install.sh"),
            Path("src/tools/inject.sh"),
            Path("src/tools/test_signature_bypass.sh"),
        )
        for path in removed:
            self.assertFalse(path.exists(), msg=f"Legacy script still present: {path}")


if __name__ == "__main__":
    unittest.main()
