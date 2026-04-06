import subprocess
import sys
from pathlib import Path

import pytest

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import orchestrator as cache_manager  # noqa: E402


def _patch_runtime_for_unified_test(monkeypatch, activity: str, package: str):
    monkeypatch.setattr(cache_manager, "adb_path", lambda: "adb")
    monkeypatch.setattr(cache_manager, "select_device", lambda adb, serial: serial or "emulator-5554")
    monkeypatch.setattr(cache_manager, "run", lambda *args, **kwargs: None)

    install_calls = []
    state = {"started": False}

    def fake_run(cmd, stdout=None, stderr=None, text=None, check=False, concise=False):
        if isinstance(cmd, list) and cmd[-3:] == ["shell", "getprop", "ro.product.cpu.abilist"]:
            return subprocess.CompletedProcess(cmd, 0, stdout="arm64-v8a\n", stderr="")
        if isinstance(cmd, list) and cmd[-3:] == ["shell", "wm", "density"]:
            return subprocess.CompletedProcess(cmd, 0, stdout="Physical density: 420\n", stderr="")
        if isinstance(cmd, list) and "install-multiple" in cmd:
            install_calls.append(cmd)
            return subprocess.CompletedProcess(cmd, 0, stdout="Success\n", stderr="")
        if isinstance(cmd, list) and cmd[-4:] == ["shell", "pm", "path", package]:
            return subprocess.CompletedProcess(cmd, 0, stdout=f"package:/data/app/{package}/base.apk\n", stderr="")
        if isinstance(cmd, list) and "am" in cmd and "start" in cmd:
            state["started"] = True
            return subprocess.CompletedProcess(cmd, 0, stdout="Status: ok\n", stderr="")
        if isinstance(cmd, list) and "monkey" in cmd:
            return subprocess.CompletedProcess(cmd, 0, stdout="Events injected: 1\n", stderr="")
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(cache_manager.subprocess, "run", fake_run)

    def fake_check_output(cmd, text=True):
        if cmd[-2:] == ["pidof", package]:
            if state["started"]:
                return "1234\n"
            raise subprocess.CalledProcessError(1, cmd)
        if "dumpsys" in cmd and "activities" in cmd:
            return f"top={activity}\n"
        if "logcat" in cmd and "-b" in cmd and "crash" in cmd:
            return ""
        if "logcat" in cmd and "AndroidRuntime" in cmd:
            return ""
        if "logcat" in cmd and "ActivityManager" in cmd:
            return ""
        return ""

    monkeypatch.setattr(cache_manager.subprocess, "check_output", fake_check_output)
    return install_calls


def test_unified_test_uses_install_multiple_when_mode_split_session(monkeypatch, tmp_path):
    signed_apk = tmp_path / "patched_signed.apk"
    base_apk = tmp_path / "base.apk"
    abi_split = tmp_path / "split_config.arm64_v8a.apk"
    density_split = tmp_path / "split_config.xxhdpi.apk"
    for path in (signed_apk, base_apk, abi_split, density_split):
        path.write_text("x", encoding="utf-8")

    install_calls = _patch_runtime_for_unified_test(monkeypatch, ".launch.core.main.ui.MainActivity", "com.phonepe.app")
    cache_manager.unified_test(
        signed_apk,
        "com.phonepe.app",
        ".launch.core.main.ui.MainActivity",
        "com.phonepe.login.internal.ui.views.LoginActivity",
        "",
        1,
        "emulator-5554",
        install_mode="split-session",
        split_base_apk=base_apk,
        split_apks_dir=tmp_path,
    )

    assert install_calls, "expected adb install-multiple to be called"
    cmd = install_calls[0]
    assert cmd[:5] == ["adb", "-s", "emulator-5554", "install-multiple", "--no-incremental"]
    assert cmd[5:] == [str(base_apk), str(abi_split), str(density_split)]


def test_split_session_mode_requires_base_and_selected_splits(monkeypatch, tmp_path):
    signed_apk = tmp_path / "patched_signed.apk"
    signed_apk.write_text("x", encoding="utf-8")

    _patch_runtime_for_unified_test(monkeypatch, ".launch.core.main.ui.MainActivity", "com.phonepe.app")

    with pytest.raises(RuntimeError, match="split-session requires --base-apk and --splits-dir"):
        cache_manager.unified_test(
            signed_apk,
            "com.phonepe.app",
            ".launch.core.main.ui.MainActivity",
            "com.phonepe.login.internal.ui.views.LoginActivity",
            "",
            1,
            "emulator-5554",
            install_mode="split-session",
        )


def test_profile_test_clean_uses_split_session_with_extended_timeout(monkeypatch, tmp_path):
    manifest = {}
    work_dir = tmp_path / "build"
    workspace = tmp_path / "workspace"
    work_dir.mkdir()
    workspace.mkdir()
    (work_dir / "patched_signed.apk").write_text("x", encoding="utf-8")
    primary_spec = {"name": "phonepe_sigbypass", "log_tag": "SigBypass"}

    with monkeypatch.context() as m:
        m.setattr(cache_manager, "resolve_profile_modules", lambda _m, _p: ["phonepe_sigbypass"])
        m.setattr(cache_manager, "profile_build_modules", lambda _m, _p: None)
        m.setattr(cache_manager, "profile_apk", lambda _m, _p, fresh=False: work_dir)
        m.setattr(cache_manager, "resolve_module_spec", lambda _m, _n: primary_spec)
        m.setattr(cache_manager, "resolve_profile_workspace", lambda _p: workspace)
        m.setattr(cache_manager, "resolve_test_serial", lambda _spec, _serial: "emulator-5554")
        m.setattr(cache_manager, "verify_profile_injection", lambda *_args, **_kwargs: None)
        m.setattr(cache_manager, "verify_profile_log_tags", lambda *_args, **_kwargs: None)

        def fake_unified_test(*args, **kwargs):
            assert kwargs["install_mode"] == "split-session"
            assert args[5] == 30

        m.setattr(cache_manager, "unified_test", fake_unified_test)
        cache_manager.profile_test(manifest, "full", "emulator-5554", smoke=False, install_mode="clean")
