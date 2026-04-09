import sys
import unittest
from pathlib import Path
from unittest import mock


CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as cache_manager  # noqa: E402


class ModuleArtifactPlanningTest(unittest.TestCase):
    def test_top_level_parser_accepts_build_modules_action(self) -> None:
        args = cache_manager.build_parser().parse_args(["smali"])
        self.assertEqual(args.cmd, "smali")
        self.assertFalse(hasattr(args, "profile"))

    def test_profile_plan_build_returns_resolved_profile_modules(self) -> None:
        manifest = {"any": {}}
        with mock.patch.object(
            cache_manager,
            "resolve_profile_modules",
            return_value=["phonepe_sigbypass", "phonepe_https_interceptor"],
        ) as resolve_mock:
            result = cache_manager.profile_plan_build(manifest, "full")

        self.assertEqual(result, ["phonepe_sigbypass", "phonepe_https_interceptor"])
        resolve_mock.assert_called_once_with(manifest, "full")

    def test_resolve_module_spec_exposes_builder_metadata(self) -> None:
        manifest = cache_manager.load_manifest()
        expected = {
            "phonepe_sigbypass": {
                "command": "src/apk/signature_bypass/scripts/compile.sh",
                "args": [],
                "fingerprint_inputs": [
                    cache_manager.REPO_ROOT / "src/apk/signature_bypass/src/main/java",
                    cache_manager.REPO_ROOT / "src/apk/signature_bypass/scripts/compile.sh",
                    cache_manager.REPO_ROOT / "src/apk/signature_bypass/scripts/merge.sh",
                    cache_manager.REPO_ROOT / "src/pipeline/tools/lib/dispatcher.sh",
                ],
                "outputs": {
                    "smali": cache_manager.REPO_ROOT / "src/apk/signature_bypass/build/smali",
                    "pine_smali": cache_manager.REPO_ROOT / "src/apk/signature_bypass/build/pine_smali",
                    "classes.dex": cache_manager.REPO_ROOT / "src/apk/signature_bypass/build/classes.dex",
                    "libs/jni": cache_manager.REPO_ROOT / "src/apk/signature_bypass/libs/jni",
                },
            },
            "phonepe_https_interceptor": {
                "command": "src/apk/https_interceptor/scripts/compile.sh",
                "args": [],
                "fingerprint_inputs": [
                    cache_manager.REPO_ROOT / "src/apk/https_interceptor/app/build.gradle",
                    cache_manager.REPO_ROOT / "src/apk/https_interceptor/app/src/main/java/com/httpinterceptor/interceptor/RemoteLoggingInterceptor.java",
                    cache_manager.REPO_ROOT / "src/apk/https_interceptor/app/src/main/java/com/httpinterceptor/interceptor/LogSender.java",
                    cache_manager.REPO_ROOT / "src/apk/https_interceptor/app/src/main/java/com/httpinterceptor/hook/HookUtil.java",
                    cache_manager.REPO_ROOT / "src/apk/https_interceptor/scripts/compile.sh",
                    cache_manager.REPO_ROOT / "src/apk/https_interceptor/scripts/merge.sh",
                ],
                "outputs": {
                    "smali": cache_manager.REPO_ROOT / "src/apk/https_interceptor/build/smali",
                },
            },
            "phonepe_phonepehelper": {
                "command": "src/apk/phonepehelper/scripts/compile.sh",
                "args": [],
                "fingerprint_inputs": [
                    cache_manager.REPO_ROOT / "src/apk/phonepehelper/src/main/java",
                    cache_manager.REPO_ROOT / "src/apk/phonepehelper/scripts/merge.sh",
                    cache_manager.REPO_ROOT / "src/apk/phonepehelper/scripts/compile.sh",
                ],
                "outputs": {
                    "smali": cache_manager.REPO_ROOT / "src/apk/phonepehelper/build/smali",
                },
            },
        }

        for module_name, expected_spec in expected.items():
            with self.subTest(module=module_name):
                spec = cache_manager.resolve_module_spec(manifest, module_name)
                self.assertEqual(spec["builder"]["command"], expected_spec["command"])
                self.assertEqual(spec["builder"]["args"], expected_spec["args"])
                self.assertEqual(
                    {item["target"]: item["source"] for item in spec["builder"]["outputs"]},
                    expected_spec["outputs"],
                )
                self.assertEqual(spec["fingerprint_inputs"], expected_spec["fingerprint_inputs"])
                self.assertTrue(all(isinstance(path, Path) and path.is_absolute() for path in spec["fingerprint_inputs"]))

    def test_profile_build_modules_builds_modules_in_profile_order(self) -> None:
        manifest = cache_manager.load_manifest()
        ordered_modules = [
            "phonepe_sigbypass",
            "phonepe_https_interceptor",
            "phonepe_phonepehelper",
        ]
        specs = {
            module: {
                "name": module,
                "builder": {"command": "noop", "args": []},
                "fingerprint_inputs": [cache_manager.REPO_ROOT / "README.md"],
            }
            for module in ordered_modules
        }

        with mock.patch.object(
            cache_manager,
            "resolve_profile_modules",
            return_value=ordered_modules,
        ), mock.patch.object(
            cache_manager,
            "resolve_module_spec",
            side_effect=lambda _manifest, module: specs[module],
        ), mock.patch.object(
            cache_manager,
            "ensure_module_artifact",
        ) as ensure_mock:
            result = cache_manager.profile_build_modules(manifest, "full")

        self.assertEqual(result, ordered_modules)
        self.assertEqual(
            [call.args[0]["name"] for call in ensure_mock.call_args_list],
            ordered_modules,
        )
        self.assertEqual(
            [call.args[1] for call in ensure_mock.call_args_list],
            [cache_manager.module_artifact_path(module) for module in ordered_modules],
        )

    def test_profile_merge_passes_artifact_dir_for_phonepehelper(self) -> None:
        manifest = {"phonepe_phonepehelper": {"deps": []}}
        workspace = Path("/tmp/profile-workspace")
        spec = {
            "name": "phonepe_phonepehelper",
            "merge_script": Path("/tmp/merge.sh"),
            "reset_paths": [],
            "added_paths": [],
        }

        with mock.patch.object(
            cache_manager,
            "resolve_profile_modules",
            return_value=["phonepe_phonepehelper"],
        ), mock.patch.object(
            cache_manager,
            "profile_prepare",
            return_value=(["phonepe_phonepehelper"], workspace),
        ), mock.patch.object(
            cache_manager,
            "resolve_module_spec",
            return_value=spec,
        ), mock.patch.object(
            cache_manager,
            "ensure_module_artifact",
            return_value=True,
        ) as ensure_mock, mock.patch.object(
            cache_manager,
            "merge",
        ) as merge_mock:
            result = cache_manager.profile_merge(manifest, "full")

        self.assertEqual(result, workspace)
        ensure_mock.assert_called_once_with(
            spec,
            cache_manager.module_artifact_path("phonepe_phonepehelper"),
        )
        self.assertEqual(merge_mock.call_args.kwargs["artifact_dir"], cache_manager.module_artifact_path("phonepe_phonepehelper"))

    def test_profile_merge_passes_artifact_dir_for_https(self) -> None:
        manifest = {"phonepe_https_interceptor": {"deps": []}}
        workspace = Path("/tmp/profile-workspace")
        spec = {
            "name": "phonepe_https_interceptor",
            "merge_script": Path("/tmp/merge.sh"),
            "reset_paths": [],
            "added_paths": [],
        }

        with mock.patch.object(
            cache_manager,
            "resolve_profile_modules",
            return_value=["phonepe_https_interceptor"],
        ), mock.patch.object(
            cache_manager,
            "profile_prepare",
            return_value=(["phonepe_https_interceptor"], workspace),
        ), mock.patch.object(
            cache_manager,
            "resolve_module_spec",
            return_value=spec,
        ), mock.patch.object(
            cache_manager,
            "ensure_module_artifact",
            return_value=True,
        ) as ensure_mock, mock.patch.object(
            cache_manager,
            "merge",
        ) as merge_mock:
            result = cache_manager.profile_merge(manifest, "full")

        self.assertEqual(result, workspace)
        ensure_mock.assert_called_once_with(
            spec,
            cache_manager.module_artifact_path("phonepe_https_interceptor"),
        )
        self.assertEqual(
            merge_mock.call_args.kwargs["artifact_dir"],
            cache_manager.module_artifact_path("phonepe_https_interceptor"),
        )

    def test_profile_merge_refreshes_workspace_before_injecting(self) -> None:
        manifest = {"phonepe_sigbypass": {"deps": []}}
        workspace = Path("/tmp/profile-workspace")
        spec = {
            "name": "phonepe_sigbypass",
            "merge_script": Path("/tmp/merge.sh"),
            "reset_paths": [],
            "added_paths": [],
        }

        with mock.patch.object(
            cache_manager,
            "resolve_profile_modules",
            return_value=["phonepe_sigbypass"],
        ), mock.patch.object(
            cache_manager,
            "profile_prepare",
            return_value=(["phonepe_sigbypass"], workspace),
        ) as pre_cache_mock, mock.patch.object(
            cache_manager,
            "resolve_module_spec",
            return_value=spec,
        ), mock.patch.object(
            cache_manager,
            "ensure_module_artifact",
            return_value=True,
        ), mock.patch.object(
            cache_manager,
            "merge",
        ) as merge_mock:
            result = cache_manager.profile_merge(manifest, "full")

        self.assertEqual(result, workspace)
        pre_cache_mock.assert_called_once_with(manifest, "full", "")
        self.assertEqual(merge_mock.call_args.args[0], workspace)

    def test_module_merge_passes_artifact_dir_for_supported_module(self) -> None:
        spec = {
            "name": "phonepe_sigbypass",
            "cache_path": Path("/tmp/cache"),
            "merge_script": Path("/tmp/merge.sh"),
            "reset_paths": [],
            "added_paths": [],
            "label": "SIGBYPASS",
        }

        with mock.patch.object(cache_manager, "module_prepare") as pre_cache_mock, \
            mock.patch.object(cache_manager, "ensure_module_artifact", return_value=True) as ensure_mock, \
            mock.patch.object(cache_manager, "merge") as merge_mock:
            cache_manager.module_merge(spec, delete_first=False)

        pre_cache_mock.assert_called_once_with(spec, False)
        ensure_mock.assert_called_once_with(spec, cache_manager.module_artifact_path("phonepe_sigbypass"))
        self.assertEqual(
            merge_mock.call_args.kwargs["artifact_dir"],
            cache_manager.module_artifact_path("phonepe_sigbypass"),
        )


if __name__ == "__main__":
    unittest.main()
