import unittest
from pathlib import Path


class ValidationDocLinksTest(unittest.TestCase):
    def test_docs_reference_standardized_commands_and_multi_app_collect(self) -> None:
        design_doc = Path("docs/orch_standardization_design.md").read_text(encoding="utf-8")
        orch_readme = Path("src/pipeline/orch/README.md").read_text(encoding="utf-8")
        policy_doc = Path("docs/编排统一规范.md").read_text(encoding="utf-8")

        for text in (design_doc, orch_readme, policy_doc):
            self.assertIn("orch collect", text)
            self.assertIn("orch collect phonepe", text)
            self.assertIn("orch info", text)
            self.assertIn("orch decompile phonepe 26022705", text)

    def test_validation_doc_references_new_test_commands(self) -> None:
        validation_doc = Path("docs/plans/2026-03-02-profile-based-build-refactor-validation.md")
        text = validation_doc.read_text(encoding="utf-8")

        self.assertIn("orchestrator.py test --smoke", text)
        self.assertIn("orchestrator.py test --serial", text)

    def test_orchestrator_readme_mentions_snapshot_seed_versioning(self) -> None:
        readme = Path("src/pipeline/orch/README.md")
        text = readme.read_text(encoding="utf-8")

        self.assertIn("--snapshot-version", text)
        self.assertIn("cache/apps/phonepe/snapshot_seed", text)
        self.assertNotIn("cache_manifest.json", text)

    def test_orchestrator_policy_doc_uses_snapshot_seed_cache_root(self) -> None:
        policy_doc = Path("docs/编排统一规范.md")
        text = policy_doc.read_text(encoding="utf-8")

        self.assertIn("cache/apps/phonepe/snapshot_seed", text)
        self.assertNotIn("cache/phonepe/from_device", text)

    def test_release_doc_mentions_snapshot_seed_paths(self) -> None:
        release_doc = Path("docs/release-to-admin.md")
        text = release_doc.read_text(encoding="utf-8")

        self.assertIn("cache/apps/phonepe/snapshot_seed/base.apk", text)
        self.assertIn("cache/apps/phonepe/snapshot_seed/split_config.arm64_v8a.apk", text)

    def test_verification_doc_mentions_snapshot_seed_paths(self) -> None:
        verification_doc = Path("docs/verification/2026-04-07-patched-signed-split-signature-alignment.md")
        text = verification_doc.read_text(encoding="utf-8")

        self.assertIn("cache/apps/phonepe/snapshot_seed", text)
        self.assertNotIn("cache/phonepe/from_device/base.apk", text)

    def test_heartbeat_bridge_validation_doc_exists_and_mentions_targeted_pytest(self) -> None:
        validation_doc = Path("docs/verification/heartbeat_bridge_validation.md")
        text = validation_doc.read_text(encoding="utf-8")

        self.assertIn("full", text)
        self.assertIn("heartbeat_bridge", text)
        self.assertNotIn("resolve_profile(\"heartbeat_bridge\")", text)


if __name__ == "__main__":
    unittest.main()
