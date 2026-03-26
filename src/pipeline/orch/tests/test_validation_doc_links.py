import unittest
from pathlib import Path


class ValidationDocLinksTest(unittest.TestCase):
    def test_validation_doc_references_new_test_commands(self) -> None:
        validation_doc = Path("docs/plans/2026-03-02-profile-based-build-refactor-validation.md")
        text = validation_doc.read_text(encoding="utf-8")

        self.assertIn("orchestrator.py test --smoke", text)
        self.assertIn("orchestrator.py test --serial", text)


if __name__ == "__main__":
    unittest.main()
