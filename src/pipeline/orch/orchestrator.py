#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from typing import Optional
from datetime import datetime
from pathlib import Path

from compose_engine import (
    detect_conflicts,
    profile_build_path,
    profile_workspace_path,
    refresh_profile_workspace,
)
from profile_resolver import resolve_profile


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
MANIFEST_PATH = SCRIPT_DIR / "cache_manifest.json"
EMULATOR_CONFIG_PATH = SCRIPT_DIR / "emulators.json"

DEFAULT_PACKAGE = "com.phonepe.app"
DEFAULT_SERIAL = "GSLDU18106001520"
DEFAULT_PROFILE = "full"
SUPPORTED_TOP_LEVEL_PROFILES = (DEFAULT_PROFILE,)
SIGBYPASS_BUILD_DIR = "cache/phonepe_sigbypass_build"
HTTPS_BUILD_DIR = "cache/phonepe_https_interceptor_build"
PHONEPEHELPER_BUILD_DIR = "cache/phonepe_phonepehelper_build"
HEARTBEAT_BRIDGE_BUILD_DIR = "cache/heartbeat_bridge_build"
DEFAULT_UNSIGNED_APK = "patched_unsigned.apk"
DEFAULT_ALIGNED_APK = "patched_aligned.apk"
DEFAULT_SIGNED_APK = "patched_signed.apk"
DEFAULT_ACTIVITY = ".launch.core.main.ui.MainActivity"
SIGBYPASS_LOG_TAG = "SigBypass"
HTTPS_LOG_TAG = "HttpInterceptor"
PPHELPER_LOG_TAG = "PPHelper"
PPHELPER_LOG_MATCH = ("PhonePeHelper initialized", "PhonePeHelper already initialized")
SIGBYPASS_LOGIN_ACTIVITY = "com.phonepe.login.internal.ui.views.LoginActivity"
DEFAULT_TIMEOUT_SEC = 12
SMOKE_TIMEOUT_SEC = 20
DEFAULT_TEST_MODE = "sigbypass"
DEFAULT_EMULATOR_BOOT_TIMEOUT = 20
REUSE_STATE_FILE = "reuse_artifacts_state.json"
MERGE_STATE_FILE = "profile_merge_state.json"
DEFAULT_SPLIT_SEED_DIR = "cache/phonepe/from_device"
DEFAULT_REQUIRED_SPLITS = (
    "split_config.arm64_v8a.apk",
    "split_config.xxhdpi.apk",
)
ARTIFACT_INJECT_MODULES = {
    "phonepe_sigbypass",
    "phonepe_https_interceptor",
    "phonepe_phonepehelper",
    "heartbeat_bridge",
}

COLOR_RESET = "\033[0m"
COLOR_BLUE = "\033[0;34m"
COLOR_GREEN = "\033[0;32m"
COLOR_YELLOW = "\033[1;33m"
COLOR_RED = "\033[0;31m"
COLOR_DIM = "\033[2m"


def log_step(msg: str):
    print(f"{COLOR_BLUE}== {msg} =={COLOR_RESET}")


def log_info(msg: str):
    print(f"{COLOR_GREEN}[INFO]{COLOR_RESET} {msg}")


def log_warn(msg: str):
    print(f"{COLOR_YELLOW}[WARN]{COLOR_RESET} {msg}")


def log_error(msg: str):
    print(f"{COLOR_RED}[FAIL]{COLOR_RESET} {msg}")


def summarize_cmd(cmd) -> str:
    if not cmd:
        return "执行任务"
    tool = Path(cmd[0]).name
    args = cmd[1:]

    if tool == "adb":
        # Normalize optional target serial: adb -s <serial> ...
        if len(args) >= 2 and args[0] == "-s":
            args = args[2:]
        if "install" in args:
            return "向设备安装 APK"
        if "uninstall" in args:
            return "卸载设备上的旧版本应用"
        if "reverse" in args:
            return "配置 adb 端口反向映射"
        if args[:5] == ["shell", "am", "force-stop", DEFAULT_PACKAGE]:
            return "停止目标应用进程"
        if args[:2] == ["shell", "pidof"]:
            return "检查应用进程状态"
        if args[:3] == ["shell", "am", "start"]:
            return "启动应用入口 Activity"
        if args[:2] == ["logcat", "-c"]:
            return "清空设备 logcat 缓冲区"
        if "pull" in args:
            return "从设备拉取文件到本地缓存"
        return "执行 adb 设备操作"

    if tool == "apktool":
        if "d" in args:
            return "反编译 APK 到工作目录"
        if "b" in args:
            return "回编 APK 产物"
        return "执行 apktool 任务"

    if tool == "zipalign":
        return "对 APK 执行 zipalign 对齐"
    if tool == "apksigner":
        if "verify" in args:
            return "校验 APK 签名"
        return "对 APK 执行签名"
    if tool in {"python", "python3"} and any("orchestrator.py" in part for part in cmd):
        return "执行编排流程阶段"
    if tool == "node" and any("server.js" in part for part in cmd):
        return "启动日志服务进程"
    return f"执行 {tool} 任务"


def log_run(cmd):
    print(f"{COLOR_DIM}[RUN]{COLOR_RESET} {summarize_cmd(cmd)}")


def log_cmd_output(label: str, line: str):
    label_str = f"[{label}]"
    print(f"{COLOR_DIM}{label_str}{COLOR_RESET} {line.rstrip()}")

MODULE_DEFAULTS = {
    "phonepe_from_device": {
        "path": "cache/phonepe/from_device",
    },
    "phonepe_merged": {
        "path": "cache/phonepe/merged",
    },
    "phonepe_decompiled": {
        "path": "cache/phonepe/decompiled",
    },
    "phonepe_sigbypass": {
        "label": "SIGBYPASS",
        "path": "cache/phonepe_sigbypass",
        "build_dir": SIGBYPASS_BUILD_DIR,
        "log_tag": SIGBYPASS_LOG_TAG,
        "login_activity": SIGBYPASS_LOGIN_ACTIVITY,
        "test_mode": "unified",
        "merge_script": "src/apk/signature_bypass/scripts/merge.sh",
    },
    "phonepe_https_interceptor": {
        "label": "HTTPS",
        "path": "cache/phonepe_https_interceptor",
        "build_dir": HTTPS_BUILD_DIR,
        "log_tag": HTTPS_LOG_TAG,
        "runtime_log_required": False,
        "login_activity": SIGBYPASS_LOGIN_ACTIVITY,
        "test_mode": "unified",
        "merge_script": "src/apk/https_interceptor/scripts/merge.sh",
    },
    "phonepe_phonepehelper": {
        "label": "PPHELPER",
        "path": "cache/phonepe_phonepehelper",
        "build_dir": PHONEPEHELPER_BUILD_DIR,
        "log_tag": PPHELPER_LOG_TAG,
        "login_activity": SIGBYPASS_LOGIN_ACTIVITY,
        "test_mode": "unified",
        "merge_script": "src/apk/phonepehelper/scripts/merge.sh",
    },
    "heartbeat_bridge": {
        "label": "HEARTBEAT",
        "path": "cache/heartbeat_bridge",
        "build_dir": HEARTBEAT_BRIDGE_BUILD_DIR,
        "log_tag": "HeartbeatBridge",
        "runtime_log_required": False,
        "login_activity": SIGBYPASS_LOGIN_ACTIVITY,
        "test_mode": "unified",
        "merge_script": "src/apk/heartbeat_bridge/scripts/merge.sh",
    },
}

TOP_LEVEL_PROFILE_ACTIONS = {"plan", "prepare", "smali", "merge", "apk", "test"}


def load_manifest():
    if not MANIFEST_PATH.exists():
        raise FileNotFoundError(f"Missing manifest: {MANIFEST_PATH}")
    data = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    for name, cfg in data.items():
        if "deps" not in cfg:
            raise ValueError(f"Invalid manifest entry: {name}")
    return data


def load_emulators():
    if not EMULATOR_CONFIG_PATH.exists():
        return []
    data = json.loads(EMULATOR_CONFIG_PATH.read_text(encoding="utf-8"))
    emulators = data.get("emulators", [])
    if not isinstance(emulators, list):
        raise ValueError("Invalid emulators config: 'emulators' must be a list")
    return emulators


def emulator_path():
    android_sdk = os.environ.get("ANDROID_HOME") or os.path.expanduser("~/Library/Android/sdk")
    candidates = [
        Path(android_sdk) / "emulator" / "emulator",
    ]
    for p in candidates:
        if p.exists():
            return str(p)
    return "emulator"



def resolve_cache_path(rel_path: str) -> Path:
    return (REPO_ROOT / rel_path).resolve()


def build_reverse_deps(manifest):
    rev = {k: [] for k in manifest.keys()}
    for name, cfg in manifest.items():
        for dep in cfg.get("deps", []):
            rev.setdefault(dep, []).append(name)
    return rev


def topo_sort(manifest):
    deps = {k: set(v.get("deps", [])) for k, v in manifest.items()}
    order = []
    while deps:
        ready = sorted([k for k, v in deps.items() if not v])
        if not ready:
            raise RuntimeError("Dependency cycle detected")
        for k in ready:
            order.append(k)
            deps.pop(k)
            for v in deps.values():
                v.discard(k)
    return order


def set_writable(path: Path):
    if not path.exists():
        return
    for root, dirs, files in os.walk(path, topdown=False):
        for name in files:
            p = Path(root) / name
            try:
                p.chmod(p.stat().st_mode | 0o200)
            except Exception:
                pass
        for name in dirs:
            p = Path(root) / name
            try:
                p.chmod(p.stat().st_mode | 0o200)
            except Exception:
                pass
    try:
        path.chmod(path.stat().st_mode | 0o200)
    except Exception:
        pass


def ensure_writable(path: Path):
    if not path.exists():
        return
    if path.is_dir():
        set_writable(path)
    else:
        try:
            path.chmod(path.stat().st_mode | 0o200)
        except Exception:
            pass

def ensure_writable_shallow(path: Path):
    if not path.exists():
        return
    try:
        path.chmod(path.stat().st_mode | 0o200)
    except Exception:
        pass


def delete_cache_dir(path: Path):
    if not path.exists():
        return
    set_writable(path)
    shutil.rmtree(path)

def copy_path(src_path: Path, src_root: Path, dst_root: Path):
    rel = src_path.relative_to(src_root)
    dst_path = dst_root / rel
    if src_path.is_dir():
        if dst_path.exists():
            delete_cache_dir(dst_path)
        shutil.copytree(src_path, dst_path)
    else:
        dst_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_path, dst_path)


def run(cmd, cwd=None, env=None, check: bool = True, concise: bool = False):
    log_run(cmd)
    label = Path(cmd[0]).name if cmd else "cmd"
    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        if not line.strip():
            continue
        if concise:
            upper = line.upper()
            if not (
                "[WARN]" in upper
                or "[ERROR]" in upper
                or "[FAIL]" in upper
                or "==== 完成 ====" in line
                or "完成" in line
                or "SUCCESS" in upper
            ):
                continue
        log_cmd_output(label, line)
    proc.wait()
    if proc.returncode != 0 and check:
        raise subprocess.CalledProcessError(proc.returncode, cmd)


def adb_path():
    android_sdk = os.environ.get("ANDROID_HOME") or os.path.expanduser("~/Library/Android/sdk")
    adb = Path(android_sdk) / "platform-tools" / "adb"
    if adb.exists():
        return str(adb)
    return "adb"

def list_connected_devices(adb: str):
    out = subprocess.check_output([adb, "devices"], text=True)
    return {
        line.split()[0]
        for line in out.splitlines()
        if line.endswith("device") and not line.startswith("List")
    }

def list_devices_with_details(adb: str):
    out = subprocess.check_output([adb, "devices", "-l"], text=True)
    devices = []
    for line in out.splitlines():
        if not line.strip() or line.startswith("List"):
            continue
        parts = line.split()
        if len(parts) < 2 or parts[1] != "device":
            continue
        info = {"serial": parts[0]}
        for part in parts[2:]:
            if ":" in part:
                k, v = part.split(":", 1)
                info[k] = v
        devices.append(info)
    return devices

def is_boot_completed(adb: str, serial: str) -> bool:
    try:
        out = subprocess.check_output(
            [adb, "-s", serial, "shell", "getprop", "sys.boot_completed"],
            text=True,
        ).strip()
        return out == "1"
    except Exception:
        return False

def avd_exists(avd_name: str) -> bool:
    avd_dir = Path.home() / ".android" / "avd" / f"{avd_name}.avd"
    return avd_dir.exists()

def find_emulator_by_module(emulators, module_name: str):
    for cfg in emulators:
        if module_name in cfg.get("modules", []):
            return cfg
    return None

def find_emulator_by_avd(emulators, avd_name: str):
    for cfg in emulators:
        if cfg.get("avd_name") == avd_name:
            return cfg
    return None

def get_avd_name(adb: str, serial: str) -> str:
    try:
        out = subprocess.check_output([adb, "-s", serial, "emu", "avd", "name"], text=True)
        lines = [ln.strip() for ln in out.splitlines() if ln.strip()]
        for ln in lines[::-1]:
            if ln.upper() == "OK":
                continue
            return ln
    except Exception:
        pass
    for prop in ("ro.boot.qemu.avd_name", "ro.kernel.qemu.avd_name"):
        try:
            out = subprocess.check_output([adb, "-s", serial, "shell", "getprop", prop], text=True).strip()
        except Exception:
            out = ""
        if out:
            return out
    return ""

def find_serial_for_avd(adb: str, avd_name: str) -> str:
    for info in list_devices_with_details(adb):
        if info.get("avd") == avd_name:
            return info["serial"]
    for serial in list_connected_devices(adb):
        if not serial.startswith("emulator-"):
            continue
        if get_avd_name(adb, serial) == avd_name:
            return serial
    return ""

def ensure_emulator_running(emulator_cfg, adb: str, timeout_sec: int = DEFAULT_EMULATOR_BOOT_TIMEOUT):
    avd_name = emulator_cfg.get("avd_name")
    if not avd_name:
        raise RuntimeError("Emulator config missing avd_name")

    serial = find_serial_for_avd(adb, avd_name)
    if serial:
        return serial

    if not avd_exists(avd_name):
        raise RuntimeError(f"AVD not found: {avd_name}. Create it before running tests.")

    emulator_bin = emulator_path()
    cmd = [emulator_bin, "-avd", avd_name]
    extra_args = emulator_cfg.get("args", [])
    if extra_args:
        cmd += list(extra_args)
    log_info(f"Starting emulator {avd_name}")
    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        serial = find_serial_for_avd(adb, avd_name)
        if not serial:
            time.sleep(1)
            continue
        if not is_boot_completed(adb, serial):
            time.sleep(1)
            continue
        return serial
    raise RuntimeError(f"Emulator {avd_name} did not boot to home within {timeout_sec}s")

def resolve_test_serial(spec, serial: str):
    adb = adb_path()
    emulators = load_emulators()
    if serial:
        if serial in list_connected_devices(adb):
            return serial
        return serial

    if DEFAULT_SERIAL:
        if DEFAULT_SERIAL in list_connected_devices(adb):
            return DEFAULT_SERIAL

    cfg = find_emulator_by_module(emulators, spec["name"])
    if cfg:
        return ensure_emulator_running(cfg, adb)

    devices = list_connected_devices(adb)
    if devices:
        return sorted(devices)[0]
    raise RuntimeError("No adb devices found for test/rerun")

def find_build_tool(name: str) -> Path:
    sdk = os.environ.get("ANDROID_HOME") or os.path.expanduser("~/Library/Android/sdk")
    build_tools = Path(sdk) / "build-tools"
    if not build_tools.exists():
        return Path(name)
    versions = sorted([p for p in build_tools.iterdir() if p.is_dir()], reverse=True)
    for v in versions:
        candidate = v / name
        if candidate.exists():
            return candidate
    return Path(name)


def normalize_signing_digest(raw: str) -> str:
    return raw.replace(":", "").strip().lower()


def read_apk_signing_digest(apksigner: Path, apk_path: Path) -> str:
    out = subprocess.check_output(
        [str(apksigner), "verify", "--print-certs", str(apk_path)],
        text=True,
    )
    match = re.search(r"Signer #1 certificate SHA-256 digest:\s*([A-Fa-f0-9:\s]+)", out)
    if not match or not match.group(1).strip():
        raise RuntimeError(f"Unable to parse signing digest for {apk_path}")
    return normalize_signing_digest(match.group(1))


def ensure_profile_release_splits_signed(work_dir: Path, source_dir: Path, base_apk: Path):
    if not base_apk.exists():
        raise RuntimeError(f"Base APK not found for release split prep: {base_apk}")
    if not source_dir.exists():
        raise RuntimeError(f"Split source directory not found: {source_dir}")

    apksigner = find_build_tool("apksigner")
    if not Path(apksigner).exists():
        raise RuntimeError(f"apksigner not found: {apksigner}")
    keystore = Path.home() / ".android" / "debug.keystore"
    if not keystore.exists():
        raise RuntimeError(f"debug.keystore not found: {keystore}")

    env = os.environ.copy()
    if not env.get("JAVA_HOME"):
        candidate = "/opt/homebrew/opt/openjdk"
        if Path(candidate).exists():
            env["JAVA_HOME"] = candidate
    if env.get("JAVA_HOME"):
        env["PATH"] = f"{env['JAVA_HOME']}/bin:" + env.get("PATH", "")

    base_digest = read_apk_signing_digest(Path(apksigner), base_apk)
    for split_name in DEFAULT_REQUIRED_SPLITS:
        source_split = source_dir / split_name
        target_split = work_dir / split_name
        if not source_split.exists():
            raise RuntimeError(f"Required split not found: {source_split}")

        source_digest = read_apk_signing_digest(Path(apksigner), source_split)
        if source_digest == base_digest:
            shutil.copy2(source_split, target_split)
        else:
            run(
                [
                    str(apksigner),
                    "sign",
                    "--ks",
                    str(keystore),
                    "--ks-pass",
                    "pass:android",
                    "--out",
                    str(target_split),
                    str(source_split),
                ],
                env=env,
            )

        target_digest = read_apk_signing_digest(Path(apksigner), target_split)
        if target_digest != base_digest:
            raise RuntimeError(
                f"Prepared split signature mismatch for {target_split}: "
                f"base={base_digest} split={target_digest}"
            )

    log_info(
        "[PROFILE] release split signatures aligned with base APK: "
        + ", ".join(DEFAULT_REQUIRED_SPLITS)
    )


def select_device(adb, serial=None):
    if serial:
        return serial
    out = subprocess.check_output([adb, "devices"], text=True)
    devices = [line.split()[0] for line in out.splitlines() if line.endswith("device") and not line.startswith("List")]
    if not devices:
        raise RuntimeError("No adb devices found")
    if len(devices) == 1:
        return devices[0]
    emu = [d for d in devices if d.startswith("emulator-")]
    if emu:
        return emu[0]
    raise RuntimeError("Multiple devices found; specify --serial")


def get_pkg_version(adb, serial, package):
    try:
        out = subprocess.check_output([adb, "-s", serial, "shell", "dumpsys", "package", package], text=True)
        version_name = ""
        version_code = ""
        for line in out.splitlines():
            if "versionName=" in line:
                version_name = line.strip().split("versionName=")[-1]
            if "versionCode=" in line:
                version_code = line.strip().split("versionCode=")[-1].split(" ")[0]
        return version_name, version_code
    except Exception:
        return "", ""


def write_meta(path: Path, payload: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True), encoding="utf-8")


def build_phonepe_from_device(cache_path: Path, package: str, serial: str):
    adb = adb_path()
    device = select_device(adb, serial)

    # Ensure package exists
    out = subprocess.check_output([adb, "-s", device, "shell", "pm", "list", "packages"], text=True)
    if package not in out:
        raise RuntimeError(f"Package not installed on device: {package}")

    delete_cache_dir(cache_path)
    cache_path.mkdir(parents=True, exist_ok=True)

    apk_paths = subprocess.check_output([adb, "-s", device, "shell", "pm", "path", package], text=True)
    apk_paths = [line.replace("package:", "").strip() for line in apk_paths.splitlines() if line.strip()]
    if not apk_paths:
        raise RuntimeError("Unable to resolve APK paths")

    for p in apk_paths:
        run([adb, "-s", device, "pull", p, str(cache_path)])

    required = [
        cache_path / "base.apk",
        cache_path / "split_config.arm64_v8a.apk",
        cache_path / "split_config.xxhdpi.apk",
    ]
    for f in required:
        if not f.exists() or f.stat().st_size <= 0:
            raise RuntimeError(f"Missing or empty file: {f}")

    version_name, version_code = get_pkg_version(adb, device, package)
    meta = {
        "created_at": datetime.now().isoformat(),
        "source": "adb_pull",
        "device_serial": device,
        "package": package,
        "version_name": version_name,
        "version_code": version_code,
        "apk_paths": apk_paths,
    }
    write_meta(cache_path / "meta.json", meta)


def build_phonepe_merged(cache_path: Path, input_path: Path, package: str, serial: str):
    merge_script = REPO_ROOT / "tools" / "merge_split_apks.sh"
    if not merge_script.exists():
        raise RuntimeError(f"Missing merge script: {merge_script}")
    if not input_path.exists():
        raise RuntimeError(f"Input cache not found: {input_path}")

    delete_cache_dir(cache_path)
    cache_path.mkdir(parents=True, exist_ok=True)

    args = [str(merge_script), "-d", str(input_path), "-p", package, "-o", str(cache_path)]
    if serial:
        args += ["-s", serial]
    run(args)

    signed = list(cache_path.glob("*_merged_signed.apk"))
    if len(signed) != 1:
        raise RuntimeError(f"Expected one signed APK in {cache_path}")

    meta = {
        "created_at": datetime.now().isoformat(),
        "source": "merge_split_apks.sh",
        "package": package,
        "signed_apk": signed[0].name,
        "input_cache": str(input_path),
    }
    write_meta(cache_path / "meta.json", meta)


def build_phonepe_decompiled(cache_path: Path, merged_cache: Path):
    signed = list(merged_cache.glob("*_merged_signed.apk"))
    if len(signed) != 1:
        raise RuntimeError(f"Expected one signed APK in {merged_cache}")

    delete_cache_dir(cache_path)
    cache_path.mkdir(parents=True, exist_ok=True)
    target = cache_path / "base_decompiled_clean"

    run(["apktool", "d", "-f", str(signed[0]), "-o", str(target)])

    meta = {
        "created_at": datetime.now().isoformat(),
        "source": signed[0].name,
        "input_cache": str(merged_cache),
    }
    write_meta(cache_path / "meta.json", meta)

def has_wildcards(rel: str) -> bool:
    return "*" in rel or "?" in rel or "[" in rel

def expand_globs(root: Path, rel: str):
    if has_wildcards(rel):
        return list(root.glob(rel))
    return [root / rel]

def refresh_cache_paths(cache_path: Path, source_root: Path, reset_paths, added_paths, label: str):
    if not source_root.exists():
        raise RuntimeError(f"Source decompiled cache not found: {source_root}")

    log_info(f"[{label}] target={cache_path}")
    log_info(f"[{label}] source={source_root}")
    if reset_paths:
        log_info(f"[{label}] reset_paths={len(reset_paths)}")
    if added_paths:
        log_info(f"[{label}] added_paths={len(added_paths)}")

    if not cache_path.exists():
        shutil.copytree(source_root, cache_path)
    else:
        for rel in added_paths:
            for dst in expand_globs(cache_path, rel):
                src = source_root / dst.relative_to(cache_path)
                if src.exists():
                    continue
                if dst.exists():
                    log_info(f"[{label}] delete added {dst}")
                    if dst.is_dir():
                        ensure_writable(dst)
                        delete_cache_dir(dst)
                    else:
                        ensure_writable(dst)
                        dst.unlink()

        for rel in reset_paths:
            if has_wildcards(rel):
                src_matches = list(source_root.glob(rel))
                if src_matches:
                    for src in src_matches:
                        dst = cache_path / src.relative_to(source_root)
                        print(f"[{label}] copy {src}")
                        ensure_writable(dst)
                        copy_path(src, source_root, cache_path)
                else:
                    for dst in cache_path.glob(rel):
                        log_info(f"[{label}] remove missing {dst}")
                        if dst.is_dir():
                            ensure_writable(dst)
                            delete_cache_dir(dst)
                        else:
                            ensure_writable(dst)
                            dst.unlink()
            else:
                src = source_root / rel
                dst = cache_path / rel
                if src.exists():
                    log_info(f"[{label}] copy {src}")
                    ensure_writable(dst)
                    copy_path(src, source_root, cache_path)
                else:
                    if dst.exists():
                        log_info(f"[{label}] remove missing {dst}")
                        if dst.is_dir():
                            ensure_writable(dst)
                            delete_cache_dir(dst)
                        else:
                            ensure_writable(dst)
                            dst.unlink()

    meta = {
        "created_at": datetime.now().isoformat(),
        "source": str(source_root),
        "mode": "refresh",
        "reset_paths": reset_paths,
        "added_paths": added_paths,
    }
    write_meta(cache_path / "meta.json", meta)

def prepare_cache(cache_path: Path, source_root: Path, reset_paths, added_paths, delete_first: bool, label: str):
    if not source_root.exists():
        raise RuntimeError(f"Source decompiled cache not found: {source_root}")

    if delete_first and cache_path.exists():
        delete_cache_dir(cache_path)

    if not cache_path.exists():
        shutil.copytree(source_root, cache_path)
    else:
        require_top_level_match(cache_path, source_root, label)
        refresh_cache_paths(cache_path, source_root, reset_paths, added_paths, label)
        src_apktool = source_root / "apktool.yml"
        dst_apktool = cache_path / "apktool.yml"
        if src_apktool.exists() and not dst_apktool.exists():
            copy_path(src_apktool, source_root, cache_path)
    validate_cache_integrity(cache_path, source_root, label)
    meta = {
        "created_at": datetime.now().isoformat(),
        "source": str(source_root),
        "mode": "prepare",
        "delete": bool(delete_first),
    }
    write_meta(cache_path / "meta.json", meta)

def require_top_level_match(cache_path: Path, source_root: Path, label: str):
    if not cache_path.exists() or not source_root.exists():
        return
    src_items = {p.name for p in source_root.iterdir()}
    cache_items = {p.name for p in cache_path.iterdir()}
    missing = sorted(src_items - cache_items)
    if missing:
        preview = ", ".join(missing[:6])
        suffix = "" if len(missing) <= 6 else f" (+{len(missing) - 6} more)"
        raise RuntimeError(
            f"[{label}] cache missing top-level items vs source: {preview}{suffix}. "
            f"Re-run with --delete for a full rebuild."
        )

def validate_cache_integrity(cache_path: Path, source_root: Path, label: str):
    missing_apktool = (source_root / "apktool.yml").exists() and not (cache_path / "apktool.yml").exists()
    missing_smali = (source_root / "smali").exists() and not (cache_path / "smali").exists()
    empty_smali = []
    for root, _, files in os.walk(cache_path):
        for name in files:
            if not name.endswith(".smali"):
                continue
            p = Path(root) / name
            try:
                if p.stat().st_size == 0:
                    empty_smali.append(p)
            except Exception:
                continue

    if missing_apktool or missing_smali or empty_smali:
        details = []
        if missing_apktool:
            details.append("missing apktool.yml")
        if missing_smali:
            details.append("missing smali/")
        if empty_smali:
            rels = [str(p.relative_to(cache_path)) for p in empty_smali[:5]]
            suffix = "" if len(empty_smali) <= 5 else f" (+{len(empty_smali) - 5} more)"
            details.append(f"empty smali: {', '.join(rels)}{suffix}")
        detail_msg = "; ".join(details)
        raise RuntimeError(
            f"[{label}] cache integrity check failed: {detail_msg}. "
            f"Check upstream cache: {source_root} or re-run prepare with --delete."
        )

def merge(
    cache_path: Path,
    merge_script: Path,
    reset_paths,
    added_paths,
    label: str,
    artifact_dir: Optional[Path] = None,
):
    if not cache_path.exists():
        raise RuntimeError(f"{label} cache not found: {cache_path}")
    if not merge_script.exists():
        raise RuntimeError(f"Merge script not found: {merge_script}")
    if not os.access(merge_script, os.X_OK):
        raise RuntimeError(f"Merge script not executable: {merge_script}")
    ensure_writable_shallow(cache_path)
    for rel in (reset_paths or []):
        for p in expand_globs(cache_path, rel):
            ensure_writable_shallow(p)
    for rel in (added_paths or []):
        for p in expand_globs(cache_path, rel):
            ensure_writable_shallow(p)
    cmd = [str(merge_script)]
    if artifact_dir is not None:
        cmd.extend(["--artifact-dir", str(artifact_dir)])
    cmd.append(str(cache_path))
    run(cmd, cwd=REPO_ROOT, concise=True)


def compute_inputs_fingerprint(root: Path) -> str:
    if not root.exists():
        raise RuntimeError(f"Input path not found for fingerprint: {root}")

    def file_digest(path: Path) -> bytes:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
        return digest.digest()

    hasher = hashlib.sha256()
    if root.is_file():
        paths = [root]
        base = root.parent
    else:
        paths = sorted([p for p in root.rglob("*") if p.is_file()], key=lambda p: str(p.relative_to(root)))
        base = root

    for path in paths:
        rel = path.relative_to(base)
        stat = path.stat()
        hasher.update(str(rel).encode("utf-8"))
        hasher.update(b"\0")
        hasher.update(str(stat.st_size).encode("ascii"))
        hasher.update(b"\0")
        hasher.update(file_digest(path))
        hasher.update(b"\n")
    return hasher.hexdigest()


def compute_profile_reuse_fingerprint(manifest, profile_name: str, workspace: Path) -> str:
    modules = resolve_profile_modules(manifest, profile_name)
    state = read_profile_merge_state(workspace)
    if state.get("profile") == profile_name and state.get("modules") == modules:
        cached_fingerprints = state.get("module_fingerprints")
        if isinstance(cached_fingerprints, dict):
            current_fingerprints = {}
            fingerprints_match = True
            for module in modules:
                spec = resolve_module_spec(manifest, module)
                current = compute_module_fingerprint(spec)
                current_fingerprints[module] = current
                if cached_fingerprints.get(module) != current:
                    fingerprints_match = False
                    break
            if fingerprints_match and has_required_workspace_inputs(workspace):
                payload = {
                    "mode": "merge_state_fast_v1",
                    "profile": profile_name,
                    "modules": modules,
                    "module_fingerprints": current_fingerprints,
                }
                return hashlib.sha256(
                    json.dumps(payload, ensure_ascii=True, sort_keys=True).encode("utf-8")
                ).hexdigest()

    hasher = hashlib.sha256()
    hasher.update(compute_inputs_fingerprint(workspace).encode("ascii"))
    hasher.update(b"\0")
    for module in modules:
        spec = resolve_module_spec(manifest, module)
        hasher.update(module.encode("utf-8"))
        hasher.update(b"\0")
        hasher.update(compute_module_fingerprint(spec).encode("ascii"))
        hasher.update(b"\n")
    return hasher.hexdigest()


def read_reuse_state(state_path: Path) -> dict:
    if not state_path.exists():
        return {}
    try:
        return json.loads(state_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def read_profile_merge_state(workspace: Path) -> dict:
    state_path = workspace / MERGE_STATE_FILE
    if not state_path.exists():
        return {}
    try:
        return json.loads(state_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def has_required_workspace_inputs(workspace: Path) -> bool:
    required = (
        workspace / "AndroidManifest.xml",
        workspace / "apktool.yml",
        workspace / "res" / "values" / "public.xml",
    )
    return all(path.exists() for path in required)


def write_profile_merge_state(manifest, profile_name: str, workspace: Path, modules):
    state_path = workspace / MERGE_STATE_FILE
    payload = {
        "created_at": datetime.now().isoformat(),
        "profile": profile_name,
        "modules": modules,
        "module_fingerprints": {
            module: compute_module_fingerprint(resolve_module_spec(manifest, module))
            for module in modules
        },
    }
    write_meta(state_path, payload)


def has_reusable_merged_workspace(manifest, profile_name: str, workspace: Path, modules) -> bool:
    if not has_required_workspace_inputs(workspace):
        return False
    state = read_profile_merge_state(workspace)
    if not state:
        return False
    if state.get("profile") != profile_name:
        return False
    cached_modules = state.get("modules")
    if cached_modules != modules:
        return False
    cached_fingerprints = state.get("module_fingerprints")
    if not isinstance(cached_fingerprints, dict):
        return False
    for module in modules:
        current_fp = compute_module_fingerprint(resolve_module_spec(manifest, module))
        if cached_fingerprints.get(module) != current_fp:
            return False
    return True


def maybe_reuse_profile_artifacts(manifest, profile_name: str, workspace: Path, work_dir: Path) -> bool:
    signed_apk = work_dir / DEFAULT_SIGNED_APK
    state_path = work_dir / REUSE_STATE_FILE
    fingerprint = compute_profile_reuse_fingerprint(manifest, profile_name, workspace)
    state = read_reuse_state(state_path)
    cached_fp = state.get("fingerprint")

    if signed_apk.exists() and cached_fp == fingerprint:
        log_info(f"[PROFILE:{profile_name}] 命中缓存，复用已构建 APK")
        return True

    reasons = []
    if not signed_apk.exists():
        reasons.append("signed apk missing")
    if not cached_fp:
        reasons.append("reuse state missing")
    elif cached_fp != fingerprint:
        reasons.append("input fingerprint changed")
    reason_text = ", ".join(reasons) if reasons else "unknown"
    log_info(f"[PROFILE:{profile_name}] 未命中缓存，需要重新构建（{reason_text}）")
    return False


def write_reuse_state(manifest, profile_name: str, workspace: Path, work_dir: Path):
    state_path = work_dir / REUSE_STATE_FILE
    payload = {
        "created_at": datetime.now().isoformat(),
        "profile": profile_name,
        "workspace": str(workspace),
        "signed_apk": DEFAULT_SIGNED_APK,
        "fingerprint": compute_profile_reuse_fingerprint(manifest, profile_name, workspace),
    }
    write_meta(state_path, payload)


def compute_module_fingerprint(spec) -> str:
    def normalize(value):
        if isinstance(value, Path):
            return str(value)
        if isinstance(value, dict):
            return {str(k): normalize(v) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [normalize(v) for v in value]
        return value

    def update_path(path: Path, hasher):
        hasher.update(str(path).encode("utf-8"))
        hasher.update(b"\0")
        if path.is_file():
            hasher.update(path.read_bytes())
            hasher.update(b"\n")
            return
        if path.is_dir():
            for root, dirs, files in os.walk(path):
                dirs.sort()
                for name in sorted(files):
                    file_path = Path(root) / name
                    rel = file_path.relative_to(path)
                    hasher.update(str(rel).encode("utf-8"))
                    hasher.update(b"\0")
                    hasher.update(file_path.read_bytes())
                    hasher.update(b"\n")
            return
        hasher.update(b"<missing>\n")

    hasher = hashlib.sha256()
    builder = spec.get("builder") or {}
    if not isinstance(builder, dict):
        builder = {}
    builder_payload = normalize({
        "command": builder.get("command", ""),
        "args": list(builder.get("args", [])) if isinstance(builder.get("args", []), list) else [],
        "outputs": builder.get("outputs", []),
    })
    hasher.update(json.dumps(builder_payload, sort_keys=True, ensure_ascii=True).encode("utf-8"))
    hasher.update(b"\0")
    inputs = spec.get("fingerprint_inputs")
    if inputs:
        for item in inputs:
            update_path(Path(item), hasher)
        return hasher.hexdigest()

    name = spec.get("name", "")
    hasher.update(str(name).encode("utf-8"))
    return hasher.hexdigest()


def module_artifact_root() -> Path:
    return resolve_cache_path("cache/module_artifacts")


def module_artifact_path(module_name: str) -> Path:
    return module_artifact_root() / module_name


def artifact_output_exists(path: Path) -> bool:
    if not path.exists():
        return False
    if path.is_file():
        return path.stat().st_size > 0
    if path.is_dir():
        return any(path.rglob("*"))
    return True


def declared_module_artifact_outputs(spec):
    outputs = []
    builder = spec.get("builder") or {}
    if not isinstance(builder, dict):
        return outputs
    for item in builder.get("outputs", []):
        if not isinstance(item, dict):
            continue
        source = item.get("source")
        target = item.get("target")
        if not source or not target:
            continue
        outputs.append(
            {
                "source": Path(source),
                "target": Path(target),
            }
        )
    return outputs


def copy_module_artifact_output(src: Path, dst: Path):
    if dst.exists():
        if dst.is_dir():
            delete_cache_dir(dst)
        else:
            dst.unlink()
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.is_dir():
        shutil.copytree(src, dst)
    else:
        shutil.copy2(src, dst)


def read_module_artifact_manifest(artifact_dir: Path) -> dict:
    manifest_path = artifact_dir / "manifest.json"
    if not manifest_path.exists():
        return {}
    try:
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def run_module_builder(spec, artifact_dir: Path):
    builder = spec.get("builder")
    artifact_dir.mkdir(parents=True, exist_ok=True)
    if callable(builder):
        return builder(spec, artifact_dir)
    if isinstance(builder, dict) and builder.get("command"):
        cmd = [builder["command"]]
        cmd.extend(builder.get("args", []))
        run(cmd, cwd=REPO_ROOT)
        for output in declared_module_artifact_outputs(spec):
            src = output["source"]
            dst = artifact_dir / output["target"]
            if not src.exists():
                raise RuntimeError(
                    f"Builder output missing for {spec.get('name', '<unknown>')}: {src}"
                )
            copy_module_artifact_output(src, dst)
        return None
    if isinstance(builder, str):
        run([builder], cwd=REPO_ROOT)
        return None
    raise RuntimeError(f"Unsupported module builder for {spec.get('name', '<unknown>')}")


def ensure_module_artifact(spec, artifact_dir: Path) -> bool:
    fingerprint = compute_module_fingerprint(spec)
    manifest = read_module_artifact_manifest(artifact_dir)
    if manifest.get("fingerprint") == fingerprint and all(
        artifact_output_exists(artifact_dir / output["target"])
        for output in declared_module_artifact_outputs(spec)
    ):
        return True

    if artifact_dir.exists():
        delete_cache_dir(artifact_dir)
    run_module_builder(spec, artifact_dir)
    builder = spec.get("builder") or {}
    if not isinstance(builder, dict):
        builder = {}
    manifest_builder = {
        "command": builder.get("command", ""),
        "args": list(builder.get("args", [])) if isinstance(builder.get("args", []), list) else [],
        "outputs": [
            {"source": str(output["source"]), "target": str(output["target"])}
            for output in declared_module_artifact_outputs(spec)
        ],
    }
    write_meta(
        artifact_dir / "manifest.json",
        {
            "name": spec.get("name", ""),
            "fingerprint": fingerprint,
            "updated_at": datetime.now().isoformat(),
            "builder": manifest_builder,
            "outputs": manifest_builder["outputs"],
        },
    )
    return False

def sigbypass_compile(cache_path: Path, work_dir: Path, unsigned_apk: str, aligned_apk: str, signed_apk: str):
    if not cache_path.exists():
        raise RuntimeError(f"Sigbypass cache not found: {cache_path}")
    work_dir.mkdir(parents=True, exist_ok=True)

    unsigned = work_dir / unsigned_apk
    aligned = work_dir / aligned_apk
    signed = work_dir / signed_apk

    zipalign = find_build_tool("zipalign")
    apksigner = find_build_tool("apksigner")
    keystore = Path.home() / ".android" / "debug.keystore"

    if not Path(zipalign).exists():
        raise RuntimeError(f"zipalign not found: {zipalign}")
    if not Path(apksigner).exists():
        raise RuntimeError(f"apksigner not found: {apksigner}")
    if not keystore.exists():
        raise RuntimeError(f"debug.keystore not found: {keystore}")

    env = os.environ.copy()
    if not env.get("JAVA_HOME"):
        candidate = "/opt/homebrew/opt/openjdk"
        if Path(candidate).exists():
            env["JAVA_HOME"] = candidate
    if env.get("JAVA_HOME"):
        env["PATH"] = f"{env['JAVA_HOME']}/bin:" + env.get("PATH", "")

    enforce_dex_compression(cache_path)
    build_jobs = max(1, os.cpu_count() or 1)
    run(["apktool", "b", "-j", str(build_jobs), "-nc", str(cache_path), "-o", str(unsigned)], env=env)
    ensure_primary_dex_first(unsigned)
    run([str(zipalign), "-f", "4", str(unsigned), str(aligned)], env=env)
    run([str(apksigner), "sign", "--ks", str(keystore), "--ks-pass", "pass:android", "--out", str(signed), str(aligned)], env=env)
    run([str(apksigner), "verify", "-v", str(signed)], env=env)


def enforce_dex_compression(cache_path: Path):
    apktool_yml = cache_path / "apktool.yml"
    if not apktool_yml.exists():
        return

    lines = apktool_yml.read_text(encoding="utf-8").splitlines(keepends=True)
    in_do_not_compress = False
    changed = False
    out = []

    for line in lines:
        stripped = line.strip()
        if stripped == "doNotCompress:":
            in_do_not_compress = True
            out.append(line)
            continue
        if in_do_not_compress and line and not line[0].isspace() and stripped.endswith(":"):
            in_do_not_compress = False
        if in_do_not_compress and stripped == "- dex":
            changed = True
            continue
        out.append(line)

    if changed:
        apktool_yml.write_text("".join(out), encoding="utf-8")
        log_info("Removed doNotCompress:dex from apktool.yml to keep dex entries compressed")


def ensure_primary_dex_first(apk_path: Path):
    import re
    import zipfile
    from tempfile import NamedTemporaryFile

    if not apk_path.exists():
        return

    dex_pattern = re.compile(r"^classes(?:\d+)?\.dex$")
    with zipfile.ZipFile(apk_path, "r") as zf:
        infos = zf.infolist()
        dex_infos = [i for i in infos if dex_pattern.match(i.filename)]
        if not dex_infos:
            return
        first_dex = dex_infos[0].filename
        if first_dex == "classes.dex":
            return
        log_warn(f"Reordering dex entries in {apk_path.name}: primary was {first_dex}")

        def dex_key(name: str):
            if name == "classes.dex":
                return 0
            m = re.match(r"^classes(\d+)\.dex$", name)
            return int(m.group(1)) if m else 9999

        ordered_dex = sorted(dex_infos, key=lambda i: dex_key(i.filename))
        dex_names = {i.filename for i in dex_infos}
        other_infos = [i for i in infos if i.filename not in dex_names]

        with NamedTemporaryFile(delete=False, suffix=".apk", dir=str(apk_path.parent)) as tmp:
            temp_path = Path(tmp.name)
        with zipfile.ZipFile(temp_path, "w") as out:
            for info in ordered_dex + other_infos:
                data = zf.read(info.filename)
                out.writestr(info, data)

        apk_path.unlink()
        temp_path.rename(apk_path)

def unified_test(
    signed_apk: Path,
    package: str,
    activity: str,
    login_activity: str,
    log_tag: str,
    timeout_sec: int,
    serial: str,
    start_retries: int = 3,
    check_interval: int = 1,
    install_mode: str = "clean",
    split_base_apk: Optional[Path] = None,
    split_apks_dir: Optional[Path] = None,
):
    if not signed_apk.exists():
        raise RuntimeError(f"Signed APK not found: {signed_apk}")
    adb = adb_path()
    device = select_device(adb, serial)

    work_dir = signed_apk.parent
    has_log_tag = bool(log_tag.strip())
    logcat_path = (work_dir / f"logcat_{log_tag}.txt") if has_log_tag else (work_dir / "logcat_smoke.txt")
    dumpsys_path = work_dir / "dumpsys_activities.txt"

    def run_capture(cmd, check: bool = True) -> str:
        log_run(cmd)
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        output = proc.stdout or ""
        label = Path(cmd[0]).name if cmd else "cmd"
        for line in output.splitlines():
            if line.strip():
                log_cmd_output(label, line)
        if proc.returncode != 0 and check:
            raise subprocess.CalledProcessError(proc.returncode, cmd, output=output)
        return output

    def ensure_process_stopped(max_tries: int = 5):
        run([adb, "-s", device, "shell", "am", "force-stop", package], check=False, concise=True)
        for _ in range(max_tries):
            try:
                out = subprocess.check_output([adb, "-s", device, "shell", "pidof", package], text=True).strip()
            except subprocess.CalledProcessError:
                out = ""
            if not out:
                return
            time.sleep(1)
            run([adb, "-s", device, "shell", "am", "force-stop", package], check=False, concise=True)
        raise RuntimeError(f"Failed to stop app before launch/install: {package}")

    def extract_app_crash_lines(crash_text: str, android_rt_text: str):
        """Only treat app-specific fatal signals as crash, ignore tooling runtime noise (e.g. monkey)."""
        lines = []
        for raw in (crash_text.splitlines() + android_rt_text.splitlines()):
            line = raw.strip()
            if not line:
                continue
            upper = line.upper()
            if f">>> {package} <<<" in line:
                lines.append(line)
                continue
            if package in line and (
                "ANDROIDRUNTIME" in upper
                or "FATAL EXCEPTION" in upper
                or "PROCESS:" in upper
                or "SIGSEGV" in upper
                or "SIGABRT" in upper
                or "BACKTRACE" in upper
            ):
                lines.append(line)
                continue
                if "FATAL EXCEPTION" in upper:
                    lines.append(line)
        return lines

    def _normalize_abi_token(abi: str) -> str:
        return abi.replace("-", "_")

    def select_abi_split(files, supported_abis):
        split_files = [Path(path) for path in files]
        for abi in supported_abis:
            token = f"split_config.{_normalize_abi_token(abi)}.apk"
            for file_path in split_files:
                if file_path.name == token:
                    return file_path
        return None

    def select_density_split(files, density_bucket):
        target = f"split_config.{density_bucket}.apk"
        for file_path in files:
            path = Path(file_path)
            if path.name == target:
                return path
        return None

    def get_supported_abis(adb_bin: str, device_serial: str):
        out = run_capture([adb_bin, "-s", device_serial, "shell", "getprop", "ro.product.cpu.abilist"], check=False).strip()
        if out:
            return [item.strip() for item in out.split(",") if item.strip()]
        out = run_capture([adb_bin, "-s", device_serial, "shell", "getprop", "ro.product.cpu.abi"], check=False).strip()
        return [out] if out else []

    def density_to_bucket(density: int) -> str:
        if density <= 120:
            return "ldpi"
        if density <= 160:
            return "mdpi"
        if density <= 240:
            return "hdpi"
        if density <= 320:
            return "xhdpi"
        if density <= 480:
            return "xxhdpi"
        return "xxxhdpi"

    def get_density_bucket(adb_bin: str, device_serial: str):
        out = run_capture([adb_bin, "-s", device_serial, "shell", "wm", "density"], check=False)
        match = re.search(r"(\d+)", out)
        if not match:
            out = run_capture([adb_bin, "-s", device_serial, "shell", "getprop", "ro.sf.lcd_density"], check=False)
            match = re.search(r"(\d+)", out)
        if not match:
            raise RuntimeError("split-session failed: unable to read device density")
        return density_to_bucket(int(match.group(1)))

    log_info("准备安装环境：停止旧进程并清理 logcat")
    ensure_process_stopped()
    run([adb, "-s", device, "logcat", "-c"], concise=True)
    # Disable incremental install to avoid transient class loading failures
    # (e.g. NoClassDefFoundError right after install when package is still frozen).
    base_install_cmd = [adb, "-s", device, "install", "--no-incremental"]
    if install_mode == "clean":
        log_info("安装前清理：卸载旧版本应用")
        run([adb, "-s", device, "uninstall", package], check=False, concise=True)
        install_cmd = [*base_install_cmd, str(signed_apk)]
    elif install_mode == "split-session":
        if split_base_apk is None or split_apks_dir is None:
            raise RuntimeError("split-session requires --base-apk and --splits-dir")
        base_apk = Path(split_base_apk)
        splits_dir = Path(split_apks_dir)
        if not base_apk.exists():
            raise RuntimeError(f"split-session base apk not found: {base_apk}")
        split_files = sorted(splits_dir.glob("split_config.*.apk"))
        supported_abis = get_supported_abis(adb, device)
        density_bucket = get_density_bucket(adb, device)
        abi_split = select_abi_split(split_files, supported_abis)
        density_split = select_density_split(split_files, density_bucket)
        if abi_split is None:
            raise RuntimeError(f"split-session missing ABI split for {supported_abis}")
        if density_split is None:
            raise RuntimeError(f"split-session missing density split for {density_bucket}")
        log_info(f"split-session 选择 ABI split: {abi_split.name}")
        log_info(f"split-session 选择 density split: {density_split.name}")
        log_info("安装前清理：卸载旧版本应用")
        run([adb, "-s", device, "uninstall", package], check=False, concise=True)
        install_cmd = [
            adb,
            "-s",
            device,
            "install-multiple",
            "--no-incremental",
            str(base_apk),
            str(abi_split),
            str(density_split),
        ]
    elif install_mode == "keep":
        log_info("安装前执行 keep 模式：卸载程序但保留数据（pm uninstall -k --user 0）")
        run([adb, "-s", device, "shell", "pm", "uninstall", "-k", "--user", "0", package], check=False, concise=True)
        install_cmd = [*base_install_cmd, str(signed_apk)]
    elif install_mode == "reinstall":
        log_info("安装前保留应用数据：跳过卸载")
        install_cmd = [*base_install_cmd, "-r", str(signed_apk)]
    else:
        raise RuntimeError(f"Unknown install mode: {install_mode}")
    log_info("安装测试 APK 到设备")
    last_install_error = ""
    for install_attempt in range(1, 3):
        try:
            run_capture(install_cmd, check=True)
            last_install_error = ""
            break
        except subprocess.CalledProcessError as exc:
            last_install_error = (exc.output or "").strip()
            if install_attempt >= 2:
                break
            log_warn(f"安装失败，准备重试 ({install_attempt}/2)")
            run([adb, "-s", device, "wait-for-device"], concise=True)
            time.sleep(1)
    if last_install_error:
        raise RuntimeError(f"APK 安装失败（重试后仍失败）: {last_install_error}")
    if install_mode == "split-session":
        install_output = run_capture([adb, "-s", device, "shell", "pm", "path", package], check=False)
        if "package:" not in install_output:
            raise RuntimeError("split-session install verification failed: pm path returned empty")
    log_info("尝试拉起应用并等待进入目标页面")
    last_start_out = ""
    total_start_retries = max(1, start_retries)
    for attempt in range(1, total_start_retries + 1):
        log_info(f"应用拉起尝试 {attempt}/{total_start_retries}")
        ensure_process_stopped()
        run([adb, "-s", device, "shell", "input", "keyevent", "KEYCODE_HOME"], concise=True)
        out = run_capture(
            [
                adb,
                "-s",
                device,
                "shell",
                "am",
                "start",
                "-W",
                "-a",
                "android.intent.action.MAIN",
                "-c",
                "android.intent.category.LAUNCHER",
                # NEW_TASK | CLEAR_TASK: clear stale top task (e.g. GMS PhoneNumberHintActivity)
                # so launcher entry behaves like a fresh icon launch.
                "-f",
                "0x10008000",
                "-n",
                f"{package}/{activity}",
            ],
            check=True,
        )
        last_start_out = out or ""
        has_error = "Error:" in last_start_out or "Exception" in last_start_out
        top_instance_warning = "Warning: Activity not started" in last_start_out
        if top_instance_warning:
            log_warn("检测到任务栈拦截，切换为 LAUNCHER 点击模拟再次拉起")
            monkey_out = run_capture(
                [adb, "-s", device, "shell", "monkey", "-p", package, "-c", "android.intent.category.LAUNCHER", "1"],
                check=True,
            )
            last_start_out = (last_start_out.rstrip() + "\n" + monkey_out.strip()).strip()
            time.sleep(2)
        try:
            pid_after_start = subprocess.check_output([adb, "-s", device, "shell", "pidof", package], text=True).strip()
        except subprocess.CalledProcessError:
            pid_after_start = ""
        if not has_error and pid_after_start:
            break
        if attempt < total_start_retries:
            time.sleep(1)
            continue
    if last_start_out.strip():
        for line in last_start_out.splitlines():
            if "Warning" in line or "Error" in line:
                log_warn(f"[am start] {line.strip()}")

    if has_log_tag:
        log_step(f"测试中：等待目标页面与日志标签（{log_tag}）")
    else:
        log_step("测试中：等待目标页面（smoke 模式跳过日志标签校验）")
    deadline = datetime.now().timestamp() + timeout_sec
    found_log = False
    found_activity = False
    found_login = False
    seen_pid = False
    missing_pid_count = 0
    last_log = ""
    last_dumpsys = ""
    last_crash = ""
    last_android = ""
    crash_path = work_dir / "logcat_crash.txt"
    start_time = datetime.now().timestamp()
    while datetime.now().timestamp() < deadline:
        dumpsys = subprocess.check_output([adb, "-s", device, "shell", "dumpsys", "activity", "activities"], text=True)
        last_dumpsys = dumpsys
        if activity in dumpsys:
            found_activity = True
        if login_activity in dumpsys:
            found_login = True
        try:
            pid = subprocess.check_output([adb, "-s", device, "shell", "pidof", package], text=True).strip()
        except subprocess.CalledProcessError:
            pid = ""
        if pid:
            seen_pid = True
            missing_pid_count = 0
        if not pid:
            # Give logcat a moment to flush crash info
            time.sleep(1)
            crash = subprocess.check_output([adb, "-s", device, "logcat", "-d", "-b", "crash"], text=True)
            android_rt = subprocess.check_output([adb, "-s", device, "logcat", "-d", "-s", "AndroidRuntime"], text=True)
            activity_mgr = subprocess.check_output([adb, "-s", device, "logcat", "-d", "-s", "ActivityManager"], text=True)
            last_crash = crash
            last_android = android_rt
            crash_lines = extract_app_crash_lines(crash, android_rt)
            debug_blob = "\n".join([crash.strip(), android_rt.strip(), activity_mgr.strip()]).strip()
            if debug_blob:
                crash_path.write_text(debug_blob + "\n", encoding="utf-8")
            if crash_lines:
                log_error("Crash log (latest, max 10 lines):")
                for ln in crash_lines[-10:]:
                    log_error(ln)
                log_error("测试失败：检测到崩溃日志")
                raise RuntimeError(f"Crash detected. See: {crash_path}")
            elapsed = datetime.now().timestamp() - start_time
            missing_pid_count += 1
            if seen_pid and missing_pid_count >= 3 and (found_activity or found_login):
                if debug_blob:
                    crash_path.write_text(debug_blob + "\n", encoding="utf-8")
                log_error("测试失败：应用进程已退出")
                log_error("Debug cmds: adb logcat -d -b crash; adb logcat -d -s AndroidRuntime; adb logcat -d -s ActivityManager")
                raise RuntimeError(f"App process not running after activity appeared. See: {crash_path}")
            if elapsed > timeout_sec:
                if debug_blob:
                    crash_path.write_text(debug_blob + "\n", encoding="utf-8")
                log_error("测试失败：应用未成功拉起")
                log_error("Debug cmds: adb logcat -d -b crash; adb logcat -d -s AndroidRuntime; adb logcat -d -s ActivityManager")
                raise RuntimeError(f"App process not running within timeout. See: {crash_path}")
            time.sleep(check_interval)
            continue
        if found_activity or found_login:
            which = []
            if found_activity:
                which.append(activity)
            if found_login:
                which.append(login_activity)
            log_info(f"[测试] 页面已就绪：{' | '.join(which)}")
            if not has_log_tag:
                found_log = True
                break
            out = subprocess.check_output([adb, "-s", device, "logcat", "-d", "-s", log_tag], text=True)
            if out.strip():
                last_log = out
                found_log = True
                break
        time.sleep(check_interval)

    if not found_activity and not found_login:
        dumpsys_path.write_text(last_dumpsys or "", encoding="utf-8")
        log_error("测试失败：未进入预期页面")
        raise RuntimeError(
            f"Activity check failed (activity={activity} OR login={login_activity}). "
            f"See: {dumpsys_path}"
        )
    crash = subprocess.check_output([adb, "-s", device, "logcat", "-d", "-b", "crash"], text=True)
    android_rt = subprocess.check_output([adb, "-s", device, "logcat", "-d", "-s", "AndroidRuntime"], text=True)
    activity_mgr = subprocess.check_output([adb, "-s", device, "logcat", "-d", "-s", "ActivityManager"], text=True)
    crash_lines = extract_app_crash_lines(crash, android_rt)
    if crash_lines:
        last_crash = crash
        last_android = android_rt
        debug_blob = "\n".join([crash.strip(), android_rt.strip(), activity_mgr.strip()]).strip()
        if debug_blob:
            crash_path.write_text(debug_blob + "\n", encoding="utf-8")
        log_error("Crash log (latest, max 10 lines):")
        for ln in crash_lines[-10:]:
            log_error(ln)
        log_error("测试失败：检测到崩溃日志")
        log_error("Debug cmds: adb logcat -d -b crash; adb logcat -d -s AndroidRuntime; adb logcat -d -s ActivityManager")
        raise RuntimeError(f"Crash detected. See: {crash_path}")
    if has_log_tag and not found_log:
        logcat_path.write_text(last_log or "", encoding="utf-8")
        log_error("测试失败：未检测到预期日志标签")
        raise RuntimeError(
            f"No log output for tag '{log_tag}' within {timeout_sec}s. "
            f"See: {logcat_path}"
        )
    if has_log_tag:
        log_info(f"[测试] 注入校验通过：检测到日志标签 {log_tag}")
        log_step(f"测试结果：成功（{log_tag}）")
    else:
        log_info("[测试] smoke 校验通过：应用已安装且页面可见")
        log_step("测试结果：成功（smoke）")


def cmd_graph(manifest):
    rev = build_reverse_deps(manifest)
    roots = [name for name, cfg in manifest.items() if not cfg.get("deps")]

    def print_tree(name, indent=""):
        print(f"{indent}{name}")
        for child in rev.get(name, []):
            print_tree(child, indent + "  -> ")

    for r in roots:
        print_tree(r)


def cmd_status(manifest):
    for name, cfg in manifest.items():
        path = resolve_manifest_path(manifest, name)
        status = "present" if path.exists() else "missing"
        meta = path / "meta.json"
        meta_info = ""
        if meta.exists():
            try:
                meta_data = json.loads(meta.read_text(encoding="utf-8"))
                meta_info = f" ({meta_data.get('created_at', '')})"
            except Exception:
                meta_info = ""
        print(f"{name}: {status}{meta_info} -> {path}")


def delete_with_downstream(name, manifest, rev):
    for child in rev.get(name, []):
        delete_with_downstream(child, manifest, rev)
    path = resolve_manifest_path(manifest, name)
    delete_cache_dir(path)


def collect_downstream(name, rev, acc=None):
    if acc is None:
        acc = set()
    for child in rev.get(name, []):
        if child not in acc:
            acc.add(child)
            collect_downstream(child, rev, acc)
    return acc


def cmd_reset(manifest, target=None):
    rev = build_reverse_deps(manifest)
    if target:
        if target not in manifest:
            raise RuntimeError(f"Unknown cache: {target}")
        delete_with_downstream(target, manifest, rev)
    else:
        for name in topo_sort(manifest)[::-1]:
            path = resolve_manifest_path(manifest, name)
            delete_cache_dir(path)


def cmd_rebuild(manifest, target=None, serial=None, package=None, with_downstream=False):
    serial = serial or DEFAULT_SERIAL
    package = package or DEFAULT_PACKAGE

    def refresh_module_cache(name: str, label: str):
        path = resolve_manifest_path(manifest, name)
        cfg = manifest[name]
        source_root = resolve_manifest_source_root(name, cfg, manifest)
        reset_paths = cfg.get("reset_paths", [])
        added_paths = cfg.get("added_paths", [])
        if not reset_paths:
            raise RuntimeError(f"{name} missing reset_paths in manifest")
        refresh_cache_paths(path, source_root, reset_paths, added_paths, label)

    def build_one(name):
        path = resolve_manifest_path(manifest, name)
        if name == "phonepe_from_device":
            build_phonepe_from_device(path, package, serial)
        elif name == "phonepe_merged":
            input_path = resolve_manifest_path(manifest, "phonepe_from_device")
            build_phonepe_merged(path, input_path, package, serial)
        elif name == "phonepe_decompiled":
            merged_path = resolve_manifest_path(manifest, "phonepe_merged")
            build_phonepe_decompiled(path, merged_path)
        elif name == "phonepe_sigbypass":
            refresh_module_cache(name, "SIGBYPASS")
        elif name == "phonepe_https_interceptor":
            refresh_module_cache(name, "HTTPS")
        elif name == "phonepe_phonepehelper":
            refresh_module_cache(name, "PPHELPER")
        else:
            raise RuntimeError(f"No builder for cache: {name}")

    rev = build_reverse_deps(manifest)

    if target:
        if target not in manifest:
            raise RuntimeError(f"Unknown cache: {target}")
        delete_with_downstream(target, manifest, rev)
        build_one(target)
        if with_downstream:
            downstream = collect_downstream(target, rev)
            for name in topo_sort(manifest):
                if name in downstream:
                    build_one(name)
    else:
        # full rebuild
        cmd_reset(manifest)
        for name in topo_sort(manifest):
            build_one(name)

def default_module_option(name, key, fallback=None):
    return MODULE_DEFAULTS.get(name, {}).get(key, fallback)

def resolve_cfg_value(name, cfg, key, fallback=None, required: bool = False):
    if key in cfg:
        return cfg[key]
    value = default_module_option(name, key, fallback)
    if required and value is None:
        raise RuntimeError(f"{name} missing {key}")
    return value

def resolve_manifest_path(manifest, name: str) -> Path:
    cfg = manifest.get(name)
    if not cfg:
        raise RuntimeError(f"{name} missing from manifest")
    rel = resolve_cfg_value(name, cfg, "path", required=True)
    return resolve_cache_path(rel)


def resolve_manifest_source_cache(name: str, cfg, manifest) -> str:
    source_cache = cfg.get("source_cache")
    if source_cache is None:
        raise RuntimeError(f"{name} missing source_cache in manifest")
    if source_cache not in manifest:
        raise RuntimeError(f"{name} missing valid source_cache in manifest")
    return source_cache


def resolve_manifest_source_root(name: str, cfg, manifest) -> Path:
    source_cache = resolve_manifest_source_cache(name, cfg, manifest)
    source_root = resolve_manifest_path(manifest, source_cache)
    source_subdir = cfg.get("source_subdir")
    if source_subdir:
        source_root = source_root / source_subdir
        if not source_root.exists():
            raise RuntimeError(f"{name} source_subdir not found: {source_root}")
    return source_root


def resolve_repo_path(rel_path: str) -> Path:
    path = Path(rel_path)
    if path.is_absolute():
        return path
    return (REPO_ROOT / path).resolve()


def resolve_module_spec(manifest, name: str):
    cfg = manifest.get(name)
    if not cfg:
        raise RuntimeError(f"{name} missing from manifest")

    cache_path = resolve_manifest_path(manifest, name)
    source_root = resolve_manifest_source_root(name, cfg, manifest)

    reset_paths = cfg.get("reset_paths", [])
    added_paths = cfg.get("added_paths", [])
    if not reset_paths:
        raise RuntimeError(f"{name} missing reset_paths in manifest")

    merge_script_cfg = resolve_cfg_value(name, cfg, "merge_script", required=True)
    merge_script = (REPO_ROOT / merge_script_cfg).resolve()

    build_dir = resolve_cfg_value(name, cfg, "build_dir", required=True)

    test_mode = resolve_cfg_value(name, cfg, "test_mode", DEFAULT_TEST_MODE)
    builder_cfg = resolve_cfg_value(name, cfg, "builder", required=True)
    if not isinstance(builder_cfg, dict):
        raise RuntimeError(f"{name} builder must be an object")

    builder_command = resolve_cfg_value(name, builder_cfg, "command", required=True)
    builder_args = builder_cfg.get("args", [])
    if not isinstance(builder_args, list):
        raise RuntimeError(f"{name} builder.args must be a list")
    fingerprint_inputs = builder_cfg.get("fingerprint_inputs", [])
    if not isinstance(fingerprint_inputs, list):
        raise RuntimeError(f"{name} builder.fingerprint_inputs must be a list")
    builder_outputs = builder_cfg.get("outputs", [])
    if not isinstance(builder_outputs, list):
        raise RuntimeError(f"{name} builder.outputs must be a list")

    return {
        "name": name,
        "label": resolve_cfg_value(name, cfg, "label", name.upper()),
        "cache_path": cache_path,
        "source_root": source_root,
        "reset_paths": reset_paths,
        "added_paths": added_paths,
        "merge_script": merge_script,
        "work_dir": resolve_cache_path(build_dir),
        "unsigned": cfg.get("unsigned") or DEFAULT_UNSIGNED_APK,
        "aligned": cfg.get("aligned") or DEFAULT_ALIGNED_APK,
        "signed": cfg.get("signed") or DEFAULT_SIGNED_APK,
        "package": cfg.get("package") or DEFAULT_PACKAGE,
        "activity": cfg.get("activity") or DEFAULT_ACTIVITY,
        "log_tag": resolve_cfg_value(name, cfg, "log_tag"),
        "runtime_log_required": resolve_cfg_value(name, cfg, "runtime_log_required", True),
        "timeout": cfg.get("timeout_sec") or DEFAULT_TIMEOUT_SEC,
        "login_activity": resolve_cfg_value(name, cfg, "login_activity"),
        "test_mode": test_mode,
        "uninstall_before_install": cfg.get("uninstall_before_install", True),
        "builder": {
            "command": builder_command,
            "args": builder_args,
            "outputs": [
                {
                    "source": resolve_repo_path(item["source"]),
                    "target": item["target"],
                }
                for item in builder_outputs
                if isinstance(item, dict) and item.get("source") and item.get("target")
            ],
        },
        "fingerprint_inputs": [resolve_repo_path(item) for item in fingerprint_inputs],
    }


def module_prepare(spec, delete_first: bool):
    prepare_cache(
        spec["cache_path"],
        spec["source_root"],
        spec["reset_paths"],
        spec["added_paths"],
        delete_first,
        spec["label"],
    )


def module_merge(spec, delete_first: bool):
    module_prepare(spec, delete_first)
    artifact_dir = module_artifact_path(spec["name"]) if spec["name"] in ARTIFACT_INJECT_MODULES else None
    if artifact_dir is not None:
        ensure_module_artifact(spec, artifact_dir)
    merge(
        spec["cache_path"],
        spec["merge_script"],
        spec["reset_paths"],
        spec["added_paths"],
        spec["label"],
        artifact_dir=artifact_dir,
    )


def module_apk(spec, delete_first: bool):
    module_merge(spec, delete_first)
    sigbypass_compile(
        spec["cache_path"],
        spec["work_dir"],
        spec["unsigned"],
        spec["aligned"],
        spec["signed"],
    )


def module_test(spec, delete_first: bool, serial: str):
    serial = resolve_test_serial(spec, serial)
    module_apk(spec, delete_first)
    run_test(spec, serial)


def run_test(spec, serial: str):
    signed_apk = spec["work_dir"] / spec["signed"]
    if spec["test_mode"] in ("sigbypass", "unified"):
        unified_test(
            signed_apk,
            spec["package"],
            spec["activity"],
            spec["login_activity"],
            spec["log_tag"],
            spec["timeout"],
            serial,
            start_retries=3,
            uninstall_before_install=spec.get("uninstall_before_install", True),
        )
    else:
        raise RuntimeError(f"Unknown test_mode: {spec['test_mode']}")


def module_rerun(spec, serial: str):
    serial = resolve_test_serial(spec, serial)
    run_test(spec, serial)


def run_module_action(spec, action: str, delete_first: bool, serial: str):
    if action == "prepare":
        module_prepare(spec, delete_first)
    elif action == "merge":
        module_merge(spec, delete_first)
    elif action == "apk":
        module_apk(spec, delete_first)
    elif action == "test":
        module_test(spec, delete_first, serial)
    elif action == "rerun":
        module_rerun(spec, serial)
    else:
        raise RuntimeError(f"Unknown action: {action}")

def resolve_profile_modules(manifest, profile_name: str):
    modules = resolve_profile(profile_name)
    missing = [name for name in modules if name not in manifest]
    if missing:
        raise RuntimeError(f"Profile contains unknown modules: {', '.join(missing)}")
    return modules


def ensure_supported_profile(profile_name: str):
    if profile_name not in SUPPORTED_TOP_LEVEL_PROFILES:
        allowed = ", ".join(SUPPORTED_TOP_LEVEL_PROFILES)
        raise RuntimeError(
            f"Unsupported profile for top-level workflow: {profile_name}. "
            f"Allowed: {allowed}"
        )


def profile_plan_build(manifest, profile_name: str):
    return resolve_profile_modules(manifest, profile_name)


def profile_build_modules(manifest, profile_name: str):
    modules = resolve_profile_modules(manifest, profile_name)
    detect_conflicts(manifest, modules)
    for module in modules:
        spec = resolve_module_spec(manifest, module)
        ensure_module_artifact(spec, module_artifact_path(module))
    return modules

def resolve_profile_workspace(profile_name: str) -> Path:
    workspace = profile_workspace_path(profile_name)
    if not workspace.exists():
        raise RuntimeError(
            f"Profile workspace not found: {workspace}. "
            f"Run 'python3 src/pipeline/orch/orchestrator.py prepare --profile {profile_name}' first."
        )
    return workspace

def profile_prepare(manifest, profile_name: str):
    modules = resolve_profile_modules(manifest, profile_name)
    detect_conflicts(manifest, modules)
    baseline = resolve_manifest_path(manifest, "phonepe_decompiled") / "base_decompiled_clean"
    workspace = refresh_profile_workspace(profile_name, baseline)
    log_info(f"[PROFILE:{profile_name}] workspace refreshed: {workspace}")
    return modules, workspace

def profile_merge(
    manifest,
    profile_name: str,
    reuse_artifacts: bool = False,
    refresh_workspace: bool = True,
):
    modules = resolve_profile_modules(manifest, profile_name)
    detect_conflicts(manifest, modules)
    if refresh_workspace:
        _, workspace = profile_prepare(manifest, profile_name)
    else:
        try:
            workspace = resolve_profile_workspace(profile_name)
            log_info(f"[PROFILE:{profile_name}] workspace reused: {workspace}")
        except RuntimeError:
            _, workspace = profile_prepare(manifest, profile_name)
    for module in modules:
        spec = resolve_module_spec(manifest, module)
        artifact_dir = module_artifact_path(module) if module in ARTIFACT_INJECT_MODULES else None
        if artifact_dir is not None:
            ensure_module_artifact(spec, artifact_dir)
        merge(
            workspace,
            spec["merge_script"],
            spec["reset_paths"],
            spec["added_paths"],
            f"PROFILE:{profile_name}:{module}",
            artifact_dir=artifact_dir,
        )
        log_info(f"[PROFILE:{profile_name}] merged: {module}")
    write_profile_merge_state(manifest, profile_name, workspace, modules)
    return workspace


def profile_apk(manifest, profile_name: str, fresh: bool = False):
    reuse_artifacts = not fresh
    work_dir = profile_build_path(profile_name)
    work_dir.mkdir(parents=True, exist_ok=True)
    split_seed_dir = resolve_cache_path(DEFAULT_SPLIT_SEED_DIR)
    signed_apk_path = work_dir / DEFAULT_SIGNED_APK
    workspace = None
    if reuse_artifacts:
        try:
            workspace = resolve_profile_workspace(profile_name)
        except RuntimeError:
            workspace = None
        if workspace is not None and maybe_reuse_profile_artifacts(manifest, profile_name, workspace, work_dir):
            ensure_profile_release_splits_signed(work_dir, split_seed_dir, signed_apk_path)
            return work_dir
    if workspace is not None and reuse_artifacts:
        modules = resolve_profile_modules(manifest, profile_name)
        if has_reusable_merged_workspace(manifest, profile_name, workspace, modules):
            log_info(f"[PROFILE:{profile_name}] 模块合并结果可复用，跳过 merge")
        else:
            workspace = profile_merge(manifest, profile_name, reuse_artifacts=reuse_artifacts)
    else:
        workspace = profile_merge(manifest, profile_name, reuse_artifacts=reuse_artifacts)
    sigbypass_compile(
        workspace,
        work_dir,
        DEFAULT_UNSIGNED_APK,
        DEFAULT_ALIGNED_APK,
        DEFAULT_SIGNED_APK,
    )
    ensure_profile_release_splits_signed(work_dir, split_seed_dir, signed_apk_path)
    if reuse_artifacts:
        write_reuse_state(manifest, profile_name, workspace, work_dir)
    return work_dir


def find_workspace_matches(workspace: Path, relative_path: str):
    return sorted(workspace.glob(f"smali*/{relative_path}"))


def workspace_contains_text(paths, needle: str) -> bool:
    for path in paths:
        try:
            if needle in path.read_text(encoding="utf-8"):
                return True
        except OSError:
            continue
    return False


def verify_profile_injection(manifest, workspace: Path, modules):
    missing = []
    checked_labels = []

    for module in modules:
        checked_labels.append(resolve_cfg_value(module, manifest.get(module, {}), "label", module.upper()))
        if module == "phonepe_https_interceptor":
            hookutil_paths = find_workspace_matches(workspace, "com/httpinterceptor/hook/HookUtil.smali")
            builder_paths = find_workspace_matches(workspace, "okhttp3/OkHttpClient$Builder.smali")
            if not hookutil_paths:
                missing.append("phonepe_https_interceptor: missing HookUtil.smali")
            if not workspace_contains_text(
                builder_paths,
                "Lcom/httpinterceptor/hook/HookUtil;->build(Lokhttp3/OkHttpClient$Builder;)Lokhttp3/OkHttpClient;",
            ):
                missing.append("phonepe_https_interceptor: OkHttpClient$Builder not patched to HookUtil.build()")
        elif module == "phonepe_phonepehelper":
            module_init_paths = find_workspace_matches(workspace, "com/phonepehelper/ModuleInit.smali")
            helper_paths = find_workspace_matches(workspace, "com/PhonePeTweak/Def/PhonePeHelper.smali")
            dispatcher_paths = find_workspace_matches(workspace, "com/indipay/inject/Dispatcher.smali")
            app_paths = find_workspace_matches(workspace, "com/phonepe/app/PhonePeApplication.smali")
            if not module_init_paths:
                missing.append("phonepe_phonepehelper: missing ModuleInit.smali")
            if not helper_paths:
                missing.append("phonepe_phonepehelper: missing PhonePeHelper.smali")
            if not workspace_contains_text(
                dispatcher_paths,
                "Lcom/phonepehelper/ModuleInit;->init(Landroid/content/Context;)V",
            ):
                missing.append("phonepe_phonepehelper: Dispatcher missing ModuleInit registration")
            if not workspace_contains_text(
                app_paths,
                "Lcom/indipay/inject/Dispatcher;->init(Landroid/content/Context;)V",
            ):
                missing.append("phonepe_phonepehelper: PhonePeApplication missing Dispatcher entry")
        elif module == "phonepe_sigbypass":
            hook_entry_paths = find_workspace_matches(workspace, "com/sigbypass/HookEntry.smali")
            dispatcher_paths = find_workspace_matches(workspace, "com/indipay/inject/Dispatcher.smali")
            app_paths = find_workspace_matches(workspace, "com/phonepe/app/PhonePeApplication.smali")
            if not hook_entry_paths:
                missing.append("phonepe_sigbypass: missing HookEntry.smali")
            if not workspace_contains_text(
                dispatcher_paths,
                "Lcom/sigbypass/HookEntry;->init(Landroid/content/Context;)V",
            ):
                missing.append("phonepe_sigbypass: Dispatcher missing HookEntry registration")
            if not workspace_contains_text(
                app_paths,
                "Lcom/indipay/inject/Dispatcher;->init(Landroid/content/Context;)V",
            ):
                missing.append("phonepe_sigbypass: PhonePeApplication missing Dispatcher entry")
        elif module == "heartbeat_bridge":
            provider_paths = find_workspace_matches(workspace, "com/heartbeatbridge/HeartbeatBridgeProvider.smali")
            sender_paths = find_workspace_matches(workspace, "com/heartbeatbridge/HeartbeatSender.smali")
            scheduler_paths = find_workspace_matches(workspace, "com/heartbeatbridge/HeartbeatScheduler.smali")
            contract_paths = find_workspace_matches(workspace, "com/heartbeatbridge/HeartbeatBridgeContract.smali")
            module_init_paths = find_workspace_matches(workspace, "com/heartbeatbridge/ModuleInit.smali")
            if not provider_paths:
                missing.append("heartbeat_bridge: missing HeartbeatBridgeProvider.smali")
            if not sender_paths:
                missing.append("heartbeat_bridge: missing HeartbeatSender.smali")
            if not scheduler_paths:
                missing.append("heartbeat_bridge: missing HeartbeatScheduler.smali")
            if not contract_paths:
                missing.append("heartbeat_bridge: missing HeartbeatBridgeContract.smali")
            if not module_init_paths:
                missing.append("heartbeat_bridge: missing ModuleInit.smali")

    if missing:
        raise RuntimeError("Profile static injection verification failed:\n- " + "\n- ".join(missing))
    if checked_labels:
        log_info(f"[PROFILE] static injection verified: {', '.join(checked_labels)}")


def verify_profile_log_tags(manifest, modules, serial: str, strict: bool = False):
    adb = adb_path()
    missing_tags = []
    checked_tags = []
    for module in modules:
        spec = resolve_module_spec(manifest, module)
        if not spec.get("runtime_log_required", True):
            continue
        tag = spec.get("log_tag")
        if not tag or tag in checked_tags:
            continue
        checked_tags.append(tag)
        out = subprocess.check_output([adb, "-s", serial, "logcat", "-d", "-s", tag], text=True)
        if not out.strip():
            missing_tags.append(tag)
    if missing_tags:
        msg = f"Missing profile runtime log tags: {', '.join(missing_tags)}"
        if strict:
            raise RuntimeError(msg)
        log_warn(msg)
        return False
    if not checked_tags:
        return True
    log_info(f"[PROFILE] all required log tags detected: {', '.join(checked_tags)}")
    return True

def profile_test(
    manifest,
    profile_name: str,
    serial: str,
    smoke: bool = False,
    install_mode: str = "reinstall",
):
    log_step(f"[PROFILE:{profile_name}] 准备测试上下文")
    modules = resolve_profile_modules(manifest, profile_name)
    log_info(f"[PROFILE:{profile_name}] 激活模块: {', '.join(modules)}")
    log_step(f"[PROFILE:{profile_name}] 检查并构建模块产物")
    profile_build_modules(manifest, profile_name)
    log_step(f"[PROFILE:{profile_name}] 组装并获取可测试 APK")
    work_dir = profile_apk(manifest, profile_name, fresh=False)
    workspace = resolve_profile_workspace(profile_name)
    signed_apk = work_dir / DEFAULT_SIGNED_APK
    primary_spec = resolve_module_spec(manifest, modules[0])
    effective_install_mode = "split-session" if install_mode == "clean" else install_mode
    preserve_mode = effective_install_mode in {"reinstall", "keep"}
    primary_log_tag = ""
    if not smoke and effective_install_mode != "split-session":
        primary_log_tag = primary_spec.get("log_tag") or SIGBYPASS_LOG_TAG
    test_serial = resolve_test_serial(primary_spec, serial)
    log_info(f"[PROFILE:{profile_name}] 目标设备: {test_serial}")
    timeout_sec = SMOKE_TIMEOUT_SEC if smoke else DEFAULT_TIMEOUT_SEC
    if preserve_mode:
        timeout_sec = 25 if smoke else 30
    if effective_install_mode == "split-session":
        timeout_sec = 25 if smoke else 30
    # preserve-data modes are more sensitive to historical app state; retry activity launch up to 3 times.
    if preserve_mode:
        start_retries = 3
    else:
        start_retries = 1 if smoke else 3
    if install_mode == "clean":
        mode_desc = "clean（先卸载，再执行 split-session install-multiple）"
    elif effective_install_mode == "split-session":
        mode_desc = "split-session（base.apk + required splits 单会话安装）"
    elif effective_install_mode == "reinstall":
        mode_desc = "reinstall（不卸载，直接 install -r）"
    elif effective_install_mode == "keep":
        mode_desc = "keep（pm uninstall -k --user 0 后 fresh install）"
    else:
        raise RuntimeError(f"Unknown install mode: {effective_install_mode}")
    log_info(f"[PROFILE:{profile_name}] 安装策略: {mode_desc}")
    log_info(f"[PROFILE:{profile_name}] 拉起重试次数: {start_retries}")
    if preserve_mode:
        log_info(f"[PROFILE:{profile_name}] keep 模式等待窗口: {timeout_sec}s")
    log_step(f"[PROFILE:{profile_name}] 部署 APK 并执行启动验证")
    unified_test(
        signed_apk,
        DEFAULT_PACKAGE,
        DEFAULT_ACTIVITY,
        SIGBYPASS_LOGIN_ACTIVITY,
        primary_log_tag,
        timeout_sec,
        test_serial,
        start_retries=start_retries,
        install_mode=effective_install_mode,
        split_base_apk=signed_apk,
        split_apks_dir=work_dir,
    )
    if not smoke:
        verify_profile_injection(manifest, workspace, modules)
        if effective_install_mode != "split-session":
            # Primary module log is already validated in unified_test.
            # Secondary module logs are best-effort at startup and should not block full test.
            verify_profile_log_tags(manifest, modules[1:], test_serial, strict=False)
        else:
            log_info(f"[PROFILE:{profile_name}] split-session 模式跳过运行时日志标签强校验")


def run_profile_action(
    manifest,
    action: str,
    profile_name: str,
    serial: str,
    smoke: bool,
    fresh: bool,
    install_mode: str,
):
    ensure_supported_profile(profile_name)
    if smoke and action != "test":
        raise RuntimeError("--smoke is only supported for 'test'")
    if fresh and action != "apk":
        raise RuntimeError("--fresh is only supported for 'apk'")
    if install_mode != "reinstall" and action != "test":
        raise RuntimeError("--install-mode is only supported for 'test'")

    if action == "plan":
        modules = resolve_profile_modules(manifest, profile_name)
        print(json.dumps(modules, ensure_ascii=True))
    elif action == "prepare":
        profile_prepare(manifest, profile_name)
    elif action == "smali":
        profile_build_modules(manifest, profile_name)
    elif action == "merge":
        profile_merge(manifest, profile_name, refresh_workspace=False)
    elif action == "apk":
        profile_apk(manifest, profile_name, fresh=fresh)
    elif action == "test":
        profile_test(manifest, profile_name, serial, smoke=smoke, install_mode=install_mode)
    else:
        raise RuntimeError(f"Unknown profile action: {action}")


def parse_test_mode_tokens(tokens, smoke: bool, install_mode: str, serial: str):
    mode_smoke = smoke
    mode_install = install_mode
    mode_serial = serial
    items = [t for t in (tokens or []) if t]
    idx = 0

    if idx < len(items) and items[idx] == "smoke":
        mode_smoke = True
        idx += 1

    if idx < len(items):
        token = items[idx]
        if token in ("clean", "keep", "reinstall", "split-session", "preserve"):
            if token == "preserve":
                mode_install = "reinstall"
            else:
                mode_install = token
            idx += 1

    if idx < len(items):
        mode_serial = items[idx]
        idx += 1

    if idx < len(items):
        raise RuntimeError("Too many test mode arguments. Use: test [smoke] [reinstall|clean|keep|split-session] [serial]")

    return mode_smoke, mode_install, mode_serial


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build orchestrator")
    sub = parser.add_subparsers(dest="cmd", required=True)

    def add_profile_args(cmd_parser, *, allow_serial: bool = True, allow_smoke: bool = False, allow_fresh: bool = False):
        cmd_parser.add_argument("--profile", choices=SUPPORTED_TOP_LEVEL_PROFILES, default=DEFAULT_PROFILE)
        if allow_serial:
            cmd_parser.add_argument("--serial")
        if allow_smoke:
            cmd_parser.add_argument("--smoke", action="store_true", default=False)
        if allow_fresh:
            cmd_parser.add_argument("--fresh", action="store_true", default=False)

    for action in ("plan", "prepare", "smali", "merge"):
        action_parser = sub.add_parser(action)
        add_profile_args(action_parser, allow_serial=False)

    apk_parser = sub.add_parser("apk")
    add_profile_args(apk_parser, allow_serial=False, allow_fresh=True)

    test_parser = sub.add_parser("test")
    add_profile_args(test_parser, allow_serial=True, allow_smoke=True)
    test_parser.add_argument(
        "--install-mode",
        choices=("reinstall", "clean", "keep", "split-session"),
        default="split-session",
        help="split-session: install-multiple base+splits; reinstall: keep app and install -r; clean: uninstall then split-session; keep: pm uninstall -k --user 0 then install",
    )
    test_parser.add_argument(
        "test_mode",
        nargs="*",
        help="Shorthand: test [smoke] [reinstall|clean|keep|split-session] [serial]",
    )

    sub.add_parser("graph")
    sub.add_parser("status")

    reset = sub.add_parser("reset")
    reset.add_argument("--from", dest="target")

    rebuild = sub.add_parser("rebuild")
    rebuild.add_argument("--only", dest="target")
    rebuild.add_argument("--with-downstream", action="store_true")
    rebuild.add_argument("--serial")
    rebuild.add_argument("--package")

    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    manifest = load_manifest()

    if args.cmd == "graph":
        cmd_graph(manifest)
    elif args.cmd == "status":
        cmd_status(manifest)
    elif args.cmd == "reset":
        cmd_reset(manifest, args.target)
    elif args.cmd == "rebuild":
        cmd_rebuild(manifest, args.target, args.serial, args.package, args.with_downstream)
    elif args.cmd in TOP_LEVEL_PROFILE_ACTIONS:
        smoke = getattr(args, "smoke", False)
        install_mode = getattr(args, "install_mode", "reinstall")
        serial = getattr(args, "serial", "") or ""
        if args.cmd == "test":
            smoke, install_mode, serial = parse_test_mode_tokens(
                getattr(args, "test_mode", []),
                smoke,
                install_mode,
                serial,
            )
        run_profile_action(
            manifest,
            args.cmd,
            args.profile,
            serial,
            smoke,
            getattr(args, "fresh", False),
            install_mode,
        )
    else:
        raise RuntimeError("Unknown command")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[FAIL] {exc}")
        sys.exit(1)
