import sys
import tempfile
import unittest
from pathlib import Path


CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as cache_manager  # noqa: E402


class ProfileInjectionVerificationTest(unittest.TestCase):
    def test_verify_profile_injection_accepts_https_and_phonepehelper_markers(self) -> None:
        manifest = {}
        with tempfile.TemporaryDirectory() as tempdir:
            workspace = Path(tempdir)
            builder_smali = workspace / "smali_classes2/okhttp3/OkHttpClient$Builder.smali"
            hookutil_smali = workspace / "smali_classes3/com/httpinterceptor/hook/HookUtil.smali"
            helper_smali = workspace / "smali_classes4/com/phonepehelper/ModuleInit.smali"
            legacy_helper_smali = workspace / "smali_classes4/com/PhonePeTweak/Def/PhonePeHelper.smali"
            dispatcher_smali = workspace / "smali_classes4/com/indipay/inject/Dispatcher.smali"
            app_smali = workspace / "smali/com/phonepe/app/PhonePeApplication.smali"

            builder_smali.parent.mkdir(parents=True, exist_ok=True)
            hookutil_smali.parent.mkdir(parents=True, exist_ok=True)
            helper_smali.parent.mkdir(parents=True, exist_ok=True)
            legacy_helper_smali.parent.mkdir(parents=True, exist_ok=True)
            dispatcher_smali.parent.mkdir(parents=True, exist_ok=True)
            app_smali.parent.mkdir(parents=True, exist_ok=True)

            builder_smali.write_text(
                "invoke-static {p0}, Lcom/httpinterceptor/hook/HookUtil;->build(Lokhttp3/OkHttpClient$Builder;)Lokhttp3/OkHttpClient;\n",
                encoding="utf-8",
            )
            hookutil_smali.write_text(".class public Lcom/httpinterceptor/hook/HookUtil;\n", encoding="utf-8")
            helper_smali.write_text(".class public Lcom/phonepehelper/ModuleInit;\n", encoding="utf-8")
            legacy_helper_smali.write_text(".class public Lcom/PhonePeTweak/Def/PhonePeHelper;\n", encoding="utf-8")
            dispatcher_smali.write_text(
                "invoke-static {p0}, Lcom/sigbypass/HookEntry;->init(Landroid/content/Context;)V\n"
                "invoke-static {p0}, Lcom/phonepehelper/ModuleInit;->init(Landroid/content/Context;)V\n",
                encoding="utf-8",
            )
            app_smali.write_text(
                "invoke-static {p0}, Lcom/indipay/inject/Dispatcher;->init(Landroid/content/Context;)V\n",
                encoding="utf-8",
            )

            cache_manager.verify_profile_injection(
                manifest,
                workspace,
                ["phonepe_https_interceptor", "phonepe_phonepehelper"],
            )


if __name__ == "__main__":
    unittest.main()
