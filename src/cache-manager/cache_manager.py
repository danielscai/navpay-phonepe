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
DEFAULT_UNSIGNED_APK = "patched_unsigned.apk"
DEFAULT_ALIGNED_APK = "patched_aligned.apk"
DEFAULT_SIGNED_APK = "patched_signed.apk"
DEFAULT_ACTIVITY = ".launch.core.main.ui.MainActivity"
SIGBYPASS_LOG_TAG = "SigBypass"
HTTPS_LOG_TAG = "HttpInterceptor"
SIGBYPASS_LOGIN_ACTIVITY = "com.phonepe.login.internal.ui.views.LoginActivity"
DEFAULT_TIMEOUT_SEC = 12


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
    print(f"[RUN] {' '.join(cmd)}")
    subprocess.check_call(cmd, cwd=cwd, env=env)


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

    print(f"[{label}] target={cache_path}")
    print(f"[{label}] source={source_root}")
    if reset_paths:
        print(f"[{label}] reset_paths={len(reset_paths)}")
    if added_paths:
        print(f"[{label}] added_paths={len(added_paths)}")

    if not cache_path.exists():
        shutil.copytree(source_root, cache_path)
    else:
        for rel in added_paths:
            for dst in expand_globs(cache_path, rel):
                src = source_root / dst.relative_to(cache_path)
                if src.exists():
                    continue
                if dst.exists():
                    print(f"[{label}] delete added {dst}")
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
                        print(f"[{label}] remove missing {dst}")
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
                    print(f"[{label}] copy {src}")
                    ensure_writable(dst)
                    copy_path(src, source_root, cache_path)
                else:
                    if dst.exists():
                        print(f"[{label}] remove missing {dst}")
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

def sigbypass_pre_cache(cache_path: Path, source_root: Path, reset_paths, added_paths, delete_first: bool):
    if not source_root.exists():
        raise RuntimeError(f"Source decompiled cache not found: {source_root}")

    if delete_first and cache_path.exists():
        delete_cache_dir(cache_path)

    if not cache_path.exists():
        shutil.copytree(source_root, cache_path)
    else:
        refresh_cache_paths(cache_path, source_root, reset_paths, added_paths, "SIGBYPASS")
    meta = {
        "created_at": datetime.now().isoformat(),
        "source": str(source_root),
        "mode": "pre-cache",
        "delete": bool(delete_first),
    }
    write_meta(cache_path / "meta.json", meta)

def https_pre_cache(cache_path: Path, source_root: Path, reset_paths, added_paths, delete_first: bool):
    if not source_root.exists():
        raise RuntimeError(f"Source cache not found: {source_root}")

    if delete_first and cache_path.exists():
        delete_cache_dir(cache_path)

    if not cache_path.exists():
        shutil.copytree(source_root, cache_path)
    else:
        refresh_cache_paths(cache_path, source_root, reset_paths, added_paths, "HTTPS")
    meta = {
        "created_at": datetime.now().isoformat(),
        "source": str(source_root),
        "mode": "pre-cache",
        "delete": bool(delete_first),
    }
    write_meta(cache_path / "meta.json", meta)

def sigbypass_inject(cache_path: Path, inject_script: Path, reset_paths, added_paths):
    if not cache_path.exists():
        raise RuntimeError(f"Sigbypass cache not found: {cache_path}")
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

def https_inject(cache_path: Path, inject_script: Path, reset_paths, added_paths):
    if not cache_path.exists():
        raise RuntimeError(f"HTTPS cache not found: {cache_path}")
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

    run(["apktool", "b", str(cache_path), "-o", str(unsigned)], env=env)
    run([str(zipalign), "-f", "4", str(unsigned), str(aligned)], env=env)
    run([str(apksigner), "sign", "--ks", str(keystore), "--ks-pass", "pass:android", "--out", str(signed), str(aligned)], env=env)
    run([str(apksigner), "verify", "-v", str(signed)], env=env)

def sigbypass_test(
    signed_apk: Path,
    package: str,
    activity: str,
    log_tag: str,
    timeout_sec: int,
    serial: str,
    login_activity: Optional[str] = None,
    clear_data: bool = False,
):
    if not signed_apk.exists():
        raise RuntimeError(f"Signed APK not found: {signed_apk}")
    adb = adb_path()
    device = select_device(adb, serial)

    work_dir = signed_apk.parent
    logcat_path = work_dir / f"logcat_{log_tag}.txt"
    dumpsys_path = work_dir / "dumpsys_activities.txt"

    run([adb, "-s", device, "logcat", "-c"])
    run([adb, "-s", device, "install", "-r", str(signed_apk)])
    if clear_data:
        run([adb, "-s", device, "shell", "pm", "clear", package])
    run([adb, "-s", device, "shell", "am", "force-stop", package])
    run([adb, "-s", device, "shell", "am", "start", "-n", f"{package}/{activity}"])

    deadline = datetime.now().timestamp() + timeout_sec
    found_log = False
    found_login = login_activity is None
    last_log = ""
    last_dumpsys = ""
    while datetime.now().timestamp() < deadline:
        out = subprocess.check_output([adb, "-s", device, "logcat", "-d", "-s", log_tag], text=True)
        if out.strip():
            last_log = out
            found_log = True
        if login_activity:
            dumpsys = subprocess.check_output([adb, "-s", device, "shell", "dumpsys", "activity", "activities"], text=True)
            last_dumpsys = dumpsys
            if login_activity in dumpsys:
                found_login = True
        if found_log and found_login:
            break
        time.sleep(1)
    if not found_log:
        logcat_path.write_text(last_log or "", encoding="utf-8")
        raise RuntimeError(
            f"No log output for tag '{log_tag}' within {timeout_sec}s. "
            f"See: {logcat_path}"
        )
    if not found_login:
        dumpsys_path.write_text(last_dumpsys or "", encoding="utf-8")
        raise RuntimeError(
            f"Login activity not detected in task stack: {login_activity}. "
            f"See: {dumpsys_path}"
        )


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
        cfg = manifest.get("phonepe_sigbypass")
        if not cfg:
            raise RuntimeError("phonepe_sigbypass missing from manifest")
        source_cache = cfg.get("source_cache")
        if not source_cache or source_cache not in manifest:
            raise RuntimeError("phonepe_sigbypass missing valid source_cache in manifest")

        cache_path = resolve_cache_path(cfg["path"])
        source_root = resolve_cache_path(manifest[source_cache]["path"])
        source_subdir = cfg.get("source_subdir")
        if source_subdir:
            source_root = source_root / source_subdir

        work_dir = resolve_cache_path(SIGBYPASS_BUILD_DIR)
        unsigned = DEFAULT_UNSIGNED_APK
        aligned = DEFAULT_ALIGNED_APK
        signed = DEFAULT_SIGNED_APK

        package = DEFAULT_PACKAGE
        activity = DEFAULT_ACTIVITY
        log_tag = SIGBYPASS_LOG_TAG
        timeout = DEFAULT_TIMEOUT_SEC
        login_activity = SIGBYPASS_LOGIN_ACTIVITY
        clear_data = True

        inject_script_cfg = cfg.get("inject_script")
        if not inject_script_cfg:
            raise RuntimeError("phonepe_sigbypass missing inject_script in manifest")
        inject_script = (REPO_ROOT / inject_script_cfg).resolve()

        reset_paths = cfg.get("reset_paths", [])
        added_paths = cfg.get("added_paths", [])
        if not reset_paths:
            raise RuntimeError("phonepe_sigbypass missing reset_paths in manifest")

        def do_pre_cache():
            sigbypass_pre_cache(cache_path, source_root, reset_paths, added_paths, args.delete)

        def do_inject():
            do_pre_cache()
            sigbypass_inject(cache_path, inject_script, reset_paths, added_paths)

        def do_compile():
            do_inject()
            sigbypass_compile(cache_path, work_dir, unsigned, aligned, signed)

        action = args.action
        if action == "pre-cache":
            do_pre_cache()
        elif action == "inject":
            do_inject()
        elif action == "compile":
            do_compile()
        elif action == "test":
            do_compile()
            sigbypass_test(
                work_dir / signed,
                package,
                activity,
                log_tag,
                timeout,
                args.serial or "",
                login_activity,
                clear_data,
            )
        else:
            raise RuntimeError(f"Unknown sigbypass action: {action}")
    elif args.cmd == "https":
        cfg = manifest.get("phonepe_https_interceptor")
        if not cfg:
            raise RuntimeError("phonepe_https_interceptor missing from manifest")
        source_cache = cfg.get("source_cache")
        if not source_cache or source_cache not in manifest:
            raise RuntimeError("phonepe_https_interceptor missing valid source_cache in manifest")

        cache_path = resolve_cache_path(cfg["path"])
        source_root = resolve_cache_path(manifest[source_cache]["path"])

        reset_paths = cfg.get("reset_paths", [])
        added_paths = cfg.get("added_paths", [])
        if not reset_paths:
            raise RuntimeError("phonepe_https_interceptor missing reset_paths in manifest")

        inject_script_cfg = cfg.get("inject_script")
        if not inject_script_cfg:
            raise RuntimeError("phonepe_https_interceptor missing inject_script in manifest")
        inject_script = (REPO_ROOT / inject_script_cfg).resolve()

        work_dir = resolve_cache_path(HTTPS_BUILD_DIR)
        unsigned = DEFAULT_UNSIGNED_APK
        aligned = DEFAULT_ALIGNED_APK
        signed = DEFAULT_SIGNED_APK

        package = DEFAULT_PACKAGE
        activity = DEFAULT_ACTIVITY
        log_tag = HTTPS_LOG_TAG
        timeout = DEFAULT_TIMEOUT_SEC
        login_activity = None

        def do_pre_cache():
            https_pre_cache(cache_path, source_root, reset_paths, added_paths, args.delete)

        def do_inject():
            do_pre_cache()
            https_inject(cache_path, inject_script, reset_paths, added_paths)

        def do_compile():
            do_inject()
            sigbypass_compile(cache_path, work_dir, unsigned, aligned, signed)

        action = args.action
        if action == "pre-cache":
            do_pre_cache()
        elif action == "inject":
            do_inject()
        elif action == "compile":
            do_compile()
        elif action == "test":
            do_compile()
            sigbypass_test(
                work_dir / signed,
                package,
                activity,
                log_tag,
                timeout,
                args.serial or "",
                login_activity,
            )
        elif action == "rerun":
            rerun_app(work_dir / signed, package, activity, args.serial or "")
        else:
            raise RuntimeError(f"Unknown https action: {action}")
    else:
        raise RuntimeError("Unknown command")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[FAIL] {exc}")
        sys.exit(1)
