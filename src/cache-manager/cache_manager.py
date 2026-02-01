#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from typing import Optional
from datetime import datetime
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
MANIFEST_PATH = SCRIPT_DIR / "cache_manifest.json"

DEFAULT_PACKAGE = "com.phonepe.app"
DEFAULT_SERIAL = "emulator-5554"
SIGBYPASS_BUILD_DIR = "cache/phonepe_sigbypass_build"
HTTPS_BUILD_DIR = "cache/phonepe_https_interceptor_build"
PHONEPEHELPER_BUILD_DIR = "cache/phonepe_phonepehelper_build"
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
DEFAULT_TEST_MODE = "sigbypass"

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


def log_run(cmd):
    cmd_str = " ".join(cmd)
    print(f"{COLOR_DIM}[RUN]{COLOR_RESET} {cmd_str}")


def log_cmd_output(label: str, line: str):
    label_str = f"[{label}]"
    print(f"{COLOR_DIM}{label_str}{COLOR_RESET} {line.rstrip()}")

MODULE_DEFAULTS = {
    "phonepe_sigbypass": {
        "label": "SIGBYPASS",
        "build_dir": SIGBYPASS_BUILD_DIR,
        "log_tag": SIGBYPASS_LOG_TAG,
        "login_activity": SIGBYPASS_LOGIN_ACTIVITY,
        "clear_data": True,
        "test_mode": "sigbypass",
        "supports_rerun": False,
    },
    "phonepe_https_interceptor": {
        "label": "HTTPS",
        "build_dir": HTTPS_BUILD_DIR,
        "log_tag": HTTPS_LOG_TAG,
        "login_activity": None,
        "clear_data": False,
        "test_mode": "sigbypass",
        "supports_rerun": True,
    },
    "phonepe_phonepehelper": {
        "label": "PPHELPER",
        "build_dir": PHONEPEHELPER_BUILD_DIR,
        "log_tag": PPHELPER_LOG_TAG,
        "login_activity": None,
        "clear_data": False,
        "test_mode": "phonepehelper",
        "supports_rerun": False,
    },
}


def load_manifest():
    if not MANIFEST_PATH.exists():
        raise FileNotFoundError(f"Missing manifest: {MANIFEST_PATH}")
    data = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    for name, cfg in data.items():
        if "deps" not in cfg or "path" not in cfg:
            raise ValueError(f"Invalid manifest entry: {name}")
    return data


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


def set_readonly(path: Path):
    if not path.exists():
        return
    for root, dirs, files in os.walk(path, topdown=False):
        for name in files:
            p = Path(root) / name
            try:
                p.chmod(p.stat().st_mode & ~0o222)
            except Exception:
                pass
        for name in dirs:
            p = Path(root) / name
            try:
                p.chmod(p.stat().st_mode & ~0o222)
            except Exception:
                pass
    try:
        path.chmod(path.stat().st_mode & ~0o222)
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


def run(cmd, cwd=None, env=None):
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
        if line.strip():
            log_cmd_output(label, line)
    proc.wait()
    if proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, cmd)


def adb_path():
    android_sdk = os.environ.get("ANDROID_HOME") or os.path.expanduser("~/Library/Android/sdk")
    adb = Path(android_sdk) / "platform-tools" / "adb"
    if adb.exists():
        return str(adb)
    return "adb"

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
    set_readonly(cache_path)


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
    set_readonly(cache_path)


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
    set_readonly(cache_path)

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

def pre_cache(cache_path: Path, source_root: Path, reset_paths, added_paths, delete_first: bool, label: str):
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
        "mode": "pre-cache",
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

    if missing_apktool or empty_smali:
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
            f"Check upstream cache: {source_root} or re-run pre-cache with --delete."
        )

def inject(cache_path: Path, inject_script: Path, reset_paths, added_paths, label: str):
    if not cache_path.exists():
        raise RuntimeError(f"{label} cache not found: {cache_path}")
    if not inject_script.exists():
        raise RuntimeError(f"Inject script not found: {inject_script}")
    if not os.access(inject_script, os.X_OK):
        raise RuntimeError(f"Inject script not executable: {inject_script}")
    ensure_writable_shallow(cache_path)
    for rel in (reset_paths or []):
        for p in expand_globs(cache_path, rel):
            ensure_writable_shallow(p)
    for rel in (added_paths or []):
        for p in expand_globs(cache_path, rel):
            ensure_writable_shallow(p)
    run([str(inject_script), str(cache_path)], cwd=REPO_ROOT)

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

    build_jobs = max(1, os.cpu_count() or 1)
    run(["apktool", "b", "-j", str(build_jobs), "-nc", str(cache_path), "-o", str(unsigned)], env=env)
    run([str(zipalign), "-f", "4", str(unsigned), str(aligned)], env=env)
    run([str(apksigner), "sign", "--ks", str(keystore), "--ks-pass", "pass:android", "--out", str(signed), str(aligned)], env=env)
    run([str(apksigner), "verify", "-v", str(signed)], env=env)

def unified_test(
    signed_apk: Path,
    package: str,
    activity: str,
    login_activity: str,
    log_tag: str,
    timeout_sec: int,
    serial: str,
    clear_data: bool = False,
    start_retries: int = 3,
    check_interval: int = 1,
):
    if not signed_apk.exists():
        raise RuntimeError(f"Signed APK not found: {signed_apk}")
    adb = adb_path()
    device = select_device(adb, serial)

    work_dir = signed_apk.parent
    logcat_path = work_dir / f"logcat_{log_tag}.txt"
    dumpsys_path = work_dir / "dumpsys_activities.txt"

    run([adb, "-s", device, "shell", "am", "force-stop", package])
    stopped = False
    for _ in range(5):
        try:
            out = subprocess.check_output([adb, "-s", device, "shell", "pidof", package], text=True).strip()
        except subprocess.CalledProcessError:
            out = ""
        if not out:
            stopped = True
            break
        time.sleep(1)
        run([adb, "-s", device, "shell", "am", "force-stop", package])
    if not stopped:
        raise RuntimeError(f"Failed to stop app before install: {package}")

    run([adb, "-s", device, "logcat", "-c"])
    run([adb, "-s", device, "install", "-r", str(signed_apk)])
    if clear_data:
        run([adb, "-s", device, "shell", "pm", "clear", package])
    last_start_out = ""
    for _ in range(max(1, start_retries)):
        run([adb, "-s", device, "shell", "am", "force-stop", package])
        out = subprocess.check_output(
            [adb, "-s", device, "shell", "am", "start", "-n", f"{package}/{activity}"],
            text=True,
        )
        last_start_out = out or ""
        if "Error:" not in last_start_out and "Exception" not in last_start_out:
            break
        time.sleep(1)

    log_step(f"Test: wait for activities + log tag '{log_tag}'")
    deadline = datetime.now().timestamp() + timeout_sec
    found_log = False
    found_activity = False
    found_login = False
    last_log = ""
    last_dumpsys = ""
    last_crash = ""
    crash_path = work_dir / "logcat_crash.txt"
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
        if not pid:
            crash = subprocess.check_output([adb, "-s", device, "logcat", "-d", "-b", "crash"], text=True)
            last_crash = crash
            if crash.strip():
                crash_path.write_text(crash, encoding="utf-8")
                lines = [ln for ln in crash.splitlines() if ln.strip()]
                if lines:
                    log_error("Crash log (latest, max 10 lines):")
                    for ln in lines[-10:]:
                        log_error(ln)
            log_error("TEST RESULT: FAILED (app exited)")
            raise RuntimeError(f"App process not running; possible crash. See: {crash_path}")
        if found_activity and found_login:
            if found_activity and found_login:
                log_info(f"[TEST] activities ready: {activity} + {login_activity}")
            out = subprocess.check_output([adb, "-s", device, "logcat", "-d", "-s", log_tag], text=True)
            if out.strip():
                last_log = out
                found_log = True
                break
        time.sleep(check_interval)

    if not found_activity or not found_login:
        dumpsys_path.write_text(last_dumpsys or "", encoding="utf-8")
        log_error("TEST RESULT: FAILED (activity check)")
        raise RuntimeError(
            f"Activity check failed (activity={activity}, login={login_activity}). "
            f"See: {dumpsys_path}"
        )
    crash = subprocess.check_output([adb, "-s", device, "logcat", "-d", "-b", "crash"], text=True)
    if crash.strip():
        last_crash = crash
        crash_path.write_text(crash, encoding="utf-8")
        lines = [ln for ln in crash.splitlines() if ln.strip()]
        if lines:
            log_error("Crash log (latest, max 10 lines):")
            for ln in lines[-10:]:
                log_error(ln)
        log_error("TEST RESULT: FAILED (crash detected)")
        raise RuntimeError(f"Crash detected in logcat crash buffer. See: {crash_path}")
    if not found_log:
        logcat_path.write_text(last_log or "", encoding="utf-8")
        log_error("TEST RESULT: FAILED (log tag not found)")
        raise RuntimeError(
            f"No log output for tag '{log_tag}' within {timeout_sec}s. "
            f"See: {logcat_path}"
        )
    log_info(f"[TEST] injection verified: log tag '{log_tag}' present")
    log_step(f"TEST RESULT: SUCCESS ({log_tag})")


def rerun_app(signed_apk: Path, package: str, activity: str, serial: str, retries: int = 3):
    if not signed_apk.exists():
        raise RuntimeError(f"Signed APK not found: {signed_apk}")
    adb = adb_path()
    device = select_device(adb, serial)

    run([adb, "-s", device, "install", "-r", str(signed_apk)])

    last_out = ""
    for _ in range(retries):
        run([adb, "-s", device, "shell", "am", "force-stop", package])
        out = subprocess.check_output(
            [adb, "-s", device, "shell", "am", "start", "-n", f"{package}/{activity}"],
            text=True,
        )
        last_out = out or ""
        if "Error:" not in last_out and "Exception" not in last_out:
            return
        time.sleep(1)
    raise RuntimeError(f"Failed to start activity after {retries} attempts: {last_out.strip()}")


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
        path = resolve_cache_path(cfg["path"])
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
    path = resolve_cache_path(manifest[name]["path"])
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
            path = resolve_cache_path(manifest[name]["path"])
            delete_cache_dir(path)


def cmd_rebuild(manifest, target=None, serial=None, package=None, with_downstream=False):
    serial = serial or DEFAULT_SERIAL
    package = package or DEFAULT_PACKAGE

    def build_one(name):
        path = resolve_cache_path(manifest[name]["path"])
        if name == "phonepe_from_device":
            build_phonepe_from_device(path, package, serial)
        elif name == "phonepe_merged":
            input_path = resolve_cache_path(manifest["phonepe_from_device"]["path"])
            build_phonepe_merged(path, input_path, package, serial)
        elif name == "phonepe_decompiled":
            merged_path = resolve_cache_path(manifest["phonepe_merged"]["path"])
            build_phonepe_decompiled(path, merged_path)
        elif name == "phonepe_sigbypass":
            cfg = manifest[name]
            source_cache = cfg.get("source_cache")
            if not source_cache or source_cache not in manifest:
                raise RuntimeError("phonepe_sigbypass missing valid source_cache in manifest")
            source_root = resolve_cache_path(manifest[source_cache]["path"])
            source_subdir = cfg.get("source_subdir")
            if source_subdir:
                source_root = source_root / source_subdir
            reset_paths = cfg.get("reset_paths", [])
            added_paths = cfg.get("added_paths", [])
            if not reset_paths:
                raise RuntimeError("phonepe_sigbypass missing reset_paths in manifest")
            refresh_cache_paths(path, source_root, reset_paths, added_paths, "SIGBYPASS")
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


def resolve_module_spec(manifest, name: str):
    cfg = manifest.get(name)
    if not cfg:
        raise RuntimeError(f"{name} missing from manifest")
    source_cache = cfg.get("source_cache")
    if not source_cache or source_cache not in manifest:
        raise RuntimeError(f"{name} missing valid source_cache in manifest")

    cache_path = resolve_cache_path(cfg["path"])
    source_root = resolve_cache_path(manifest[source_cache]["path"])
    source_subdir = cfg.get("source_subdir")
    if source_subdir:
        source_root = source_root / source_subdir

    reset_paths = cfg.get("reset_paths", [])
    added_paths = cfg.get("added_paths", [])
    if not reset_paths:
        raise RuntimeError(f"{name} missing reset_paths in manifest")

    inject_script_cfg = cfg.get("inject_script")
    if not inject_script_cfg:
        raise RuntimeError(f"{name} missing inject_script in manifest")
    inject_script = (REPO_ROOT / inject_script_cfg).resolve()

    build_dir = cfg.get("build_dir") or default_module_option(name, "build_dir")
    if not build_dir:
        raise RuntimeError(f"{name} missing build_dir")

    test_mode = cfg.get("test_mode") or default_module_option(name, "test_mode", DEFAULT_TEST_MODE)

    return {
        "name": name,
        "label": cfg.get("label") or default_module_option(name, "label", name.upper()),
        "cache_path": cache_path,
        "source_root": source_root,
        "reset_paths": reset_paths,
        "added_paths": added_paths,
        "inject_script": inject_script,
        "work_dir": resolve_cache_path(build_dir),
        "unsigned": cfg.get("unsigned") or DEFAULT_UNSIGNED_APK,
        "aligned": cfg.get("aligned") or DEFAULT_ALIGNED_APK,
        "signed": cfg.get("signed") or DEFAULT_SIGNED_APK,
        "package": cfg.get("package") or DEFAULT_PACKAGE,
        "activity": cfg.get("activity") or DEFAULT_ACTIVITY,
        "log_tag": cfg.get("log_tag") or default_module_option(name, "log_tag"),
        "timeout": cfg.get("timeout_sec") or DEFAULT_TIMEOUT_SEC,
        "login_activity": cfg.get("login_activity") or default_module_option(name, "login_activity"),
        "clear_data": bool(cfg.get("clear_data", default_module_option(name, "clear_data", False))),
        "test_mode": test_mode,
        "supports_rerun": bool(cfg.get("supports_rerun", default_module_option(name, "supports_rerun", False))),
    }


def module_pre_cache(spec, delete_first: bool):
    pre_cache(
        spec["cache_path"],
        spec["source_root"],
        spec["reset_paths"],
        spec["added_paths"],
        delete_first,
        spec["label"],
    )


def module_inject(spec, delete_first: bool):
    module_pre_cache(spec, delete_first)
    inject(
        spec["cache_path"],
        spec["inject_script"],
        spec["reset_paths"],
        spec["added_paths"],
        spec["label"],
    )


def module_compile(spec, delete_first: bool):
    module_inject(spec, delete_first)
    sigbypass_compile(
        spec["cache_path"],
        spec["work_dir"],
        spec["unsigned"],
        spec["aligned"],
        spec["signed"],
    )


def module_test(spec, delete_first: bool, serial: str):
    module_compile(spec, delete_first)
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
            spec["clear_data"],
            3,
        )
    else:
        raise RuntimeError(f"Unknown test_mode: {spec['test_mode']}")


def module_rerun(spec, serial: str):
    if not spec["supports_rerun"]:
        raise RuntimeError(f"Rerun not supported for module: {spec['name']}")
    signed_apk = spec["work_dir"] / spec["signed"]
    rerun_app(signed_apk, spec["package"], spec["activity"], serial)


def run_module_action(spec, action: str, delete_first: bool, serial: str):
    if action == "pre-cache":
        module_pre_cache(spec, delete_first)
    elif action == "inject":
        module_inject(spec, delete_first)
    elif action == "compile":
        module_compile(spec, delete_first)
    elif action == "test":
        module_test(spec, delete_first, serial)
    elif action == "rerun":
        module_rerun(spec, serial)
    else:
        raise RuntimeError(f"Unknown action: {action}")


def main():
    parser = argparse.ArgumentParser(description="Cache manager")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("graph")
    sub.add_parser("status")

    reset = sub.add_parser("reset")
    reset.add_argument("--from", dest="target")

    rebuild = sub.add_parser("rebuild")
    rebuild.add_argument("--only", dest="target")
    rebuild.add_argument("--with-downstream", action="store_true")
    rebuild.add_argument("--serial")
    rebuild.add_argument("--package")

    sigbypass = sub.add_parser("sigbypass")
    sigbypass.add_argument("action", choices=["pre-cache", "inject", "compile", "test"])
    sigbypass.add_argument("--serial")
    sigbypass.add_argument("-d", "--delete", action="store_true", default=False)

    https = sub.add_parser("https")
    https.add_argument("action", choices=["pre-cache", "inject", "compile", "test", "rerun"])
    https.add_argument("--serial")
    https.add_argument("-d", "--delete", action="store_true", default=False)

    phonepehelper = sub.add_parser("phonepehelper")
    phonepehelper.add_argument("action", choices=["pre-cache", "inject", "compile", "test"])
    phonepehelper.add_argument("--serial")
    phonepehelper.add_argument("-d", "--delete", action="store_true", default=False)

    args = parser.parse_args()
    manifest = load_manifest()

    if args.cmd == "graph":
        cmd_graph(manifest)
    elif args.cmd == "status":
        cmd_status(manifest)
    elif args.cmd == "reset":
        cmd_reset(manifest, args.target)
    elif args.cmd == "rebuild":
        cmd_rebuild(manifest, args.target, args.serial, args.package, args.with_downstream)
    elif args.cmd == "sigbypass":
        spec = resolve_module_spec(manifest, "phonepe_sigbypass")
        run_module_action(spec, args.action, args.delete, args.serial or "")
    elif args.cmd == "https":
        spec = resolve_module_spec(manifest, "phonepe_https_interceptor")
        run_module_action(spec, args.action, args.delete, args.serial or "")
    elif args.cmd == "phonepehelper":
        spec = resolve_module_spec(manifest, "phonepe_phonepehelper")
        run_module_action(spec, args.action, args.delete, args.serial or "")
    else:
        raise RuntimeError("Unknown command")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[FAIL] {exc}")
        sys.exit(1)
