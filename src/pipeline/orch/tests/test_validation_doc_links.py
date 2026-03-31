import unittest
from pathlib import Path


class ValidationDocLinksTest(unittest.TestCase):
    def test_validation_doc_references_new_test_commands(self) -> None:
        validation_doc = Path("docs/plans/2026-03-02-profile-based-build-refactor-validation.md")
        text = validation_doc.read_text(encoding="utf-8")

        self.assertIn("orchestrator.py test --smoke", text)
        self.assertIn("orchestrator.py test --serial", text)

    def test_heartbeat_bridge_validation_doc_exists_and_mentions_targeted_pytest(self) -> None:
        validation_doc = Path("docs/verification/heartbeat_bridge_validation.md")
        text = validation_doc.read_text(encoding="utf-8")

        self.assertIn("full", text)
        self.assertIn("heartbeat_bridge", text)
        self.assertNotIn("resolve_profile(\"heartbeat_bridge\")", text)


if __name__ == "__main__":
    unittest.main()
