import unittest
from pathlib import Path


MERGE_SH = (
    Path(__file__).resolve().parents[3]
    / "apk"
    / "phonepehelper"
    / "scripts"
    / "merge.sh"
)


class EntryContractTest(unittest.TestCase):
    def test_phonepehelper_merge_no_hookentry_file_patch_logic(self) -> None:
        content = MERGE_SH.read_text(encoding="utf-8")
        self.assertNotIn("com/sigbypass/HookEntry.smali", content)

    def test_phonepehelper_merge_uses_dispatcher_injection_contract(self) -> None:
        content = MERGE_SH.read_text(encoding="utf-8")
        self.assertIn("_framework/dispatcher/scripts/inject_entry.py", content)
        self.assertIn("Dispatcher.smali", content)
        self.assertIn(
            "Lcom/phonepehelper/ModuleInit;->init(Landroid/content/Context;)V",
            content,
        )


if __name__ == "__main__":
    unittest.main()
