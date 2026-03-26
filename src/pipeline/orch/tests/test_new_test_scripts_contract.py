import unittest
from pathlib import Path


class NewTestScriptsContractTest(unittest.TestCase):
    def test_new_fast_test_scripts_exist_and_executable(self) -> None:
        for script_path in (
            Path("src/pipeline/tools/test_profile_smoke.sh"),
            Path("src/pipeline/tools/test_profile_full.sh"),
        ):
            self.assertTrue(script_path.exists(), msg=f"Missing script: {script_path}")
            self.assertTrue(script_path.is_file(), msg=f"Not a file: {script_path}")

    def test_test_scripts_delegate_to_orchestrator_only(self) -> None:
        smoke_script = Path("src/pipeline/tools/test_profile_smoke.sh").read_text(encoding="utf-8")
        full_script = Path("src/pipeline/tools/test_profile_full.sh").read_text(encoding="utf-8")
        self.assertIn("orchestrator.py test --smoke", smoke_script)
        self.assertNotIn("orchestrator.py pre-cache", smoke_script)
        self.assertIn("orchestrator.py test --serial", full_script)
        self.assertNotIn("orchestrator.py pre-cache", full_script)

    def test_legacy_scripts_have_been_removed(self) -> None:
        removed = (
            Path("src/apk/signature_bypass/tools/inject.sh"),
            Path("src/apk/signature_bypass/tools/merge.sh"),
            Path("src/apk/signature_bypass/tools/inject_hook.py"),
            Path("src/apk/signature_bypass/scripts/verify_injection.sh"),
            Path("src/apk/https_interceptor/build_and_install.sh"),
            Path("src/pipeline/tools/inject.sh"),
            Path("src/pipeline/tools/test_signature_bypass.sh"),
        )
        for path in removed:
            self.assertFalse(path.exists(), msg=f"Legacy script still present: {path}")


if __name__ == "__main__":
    unittest.main()
