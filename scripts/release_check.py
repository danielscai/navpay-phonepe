#!/usr/bin/env python3
import argparse
import subprocess
import time
from pathlib import Path
from typing import Optional, Sequence

PACKAGE_NAME = "com.phonepe.app"
DUMP_REMOTE_PATH = "/sdcard/navpay_release_check.xml"
DUMP_LOCAL_PATH = "/tmp/navpay_release_check.xml"


def run_capture(cmd: Sequence[str], allow_fail: bool = False) -> str:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    output = (proc.stdout + proc.stderr).strip()
    if proc.returncode != 0 and not allow_fail:
        detail = output or "command failed"
        raise RuntimeError(f"CMD_FAILED: {' '.join(cmd)} :: {detail}")
    return output


def resolve_serial(adb: str, serial: Optional[str]) -> str:
    if serial:
        return serial
    out = run_capture([adb, "devices"])
    lines = [line.strip() for line in out.splitlines()[1:] if line.strip()]
    devices = [line.split()[0] for line in lines if "\tdevice" in line]
    if not devices:
        raise RuntimeError("no running adb device found")
    emulators = [dev for dev in devices if dev.startswith("emulator-")]
    return emulators[0] if emulators else devices[0]


def ensure_release_files(release_dir: Path) -> list[Path]:
    apks = [
        release_dir / "patched_signed.apk",
        release_dir / "split_config.arm64_v8a.apk",
        release_dir / "split_config.xxhdpi.apk",
    ]
    missing = [str(path) for path in apks if not path.exists()]
    if missing:
        raise RuntimeError("missing release artifacts: " + ", ".join(missing))
    return apks


def install_multiple(adb: str, serial: str, apks: list[Path]) -> str:
    cmd = [adb, "-s", serial, "install-multiple", "-r", "--no-incremental", *[str(apk) for apk in apks]]
    out = run_capture(cmd)
    if "Failure" in out:
        raise RuntimeError(f"install-multiple failed: {out}")
    return out


def launch_phonepe(adb: str, serial: str) -> None:
    run_capture([adb, "-s", serial, "shell", "am", "force-stop", PACKAGE_NAME], allow_fail=True)
    run_capture(
        [adb, "-s", serial, "shell", "monkey", "-p", PACKAGE_NAME, "-c", "android.intent.category.LAUNCHER", "1"]
    )


def dump_ui_text(adb: str, serial: str) -> str:
    run_capture([adb, "-s", serial, "shell", "uiautomator", "dump", DUMP_REMOTE_PATH], allow_fail=True)
    xml = run_capture([adb, "-s", serial, "shell", "cat", DUMP_REMOTE_PATH], allow_fail=True)
    if not xml or "hierarchy" not in xml:
        run_capture([adb, "-s", serial, "pull", DUMP_REMOTE_PATH, DUMP_LOCAL_PATH], allow_fail=True)
        local = Path(DUMP_LOCAL_PATH)
        if local.exists():
            xml = local.read_text(encoding="utf-8", errors="ignore")
    return xml.lower()


def wait_for_result(adb: str, serial: str, interval_sec: int, timeout_sec: int) -> str:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        ui = dump_ui_text(adb, serial)
        if "technical issue" in ui:
            return "technical_issue"
        if "login" in ui or "log in" in ui or "sign in" in ui or "signin" in ui:
            return "login"
        time.sleep(interval_sec)
    return "timeout"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adb", default="adb")
    parser.add_argument("--serial", default="")
    parser.add_argument("--release-dir", default="cache/release")
    parser.add_argument("--interval-sec", type=int, default=3)
    parser.add_argument("--timeout-sec", type=int, default=15)
    args = parser.parse_args()

    release_dir = Path(args.release_dir).resolve()
    serial = resolve_serial(args.adb, args.serial or None)
    apks = ensure_release_files(release_dir)

    run_capture([args.adb, "-s", serial, "wait-for-device"])
    install_out = install_multiple(args.adb, serial, apks)
    launch_phonepe(args.adb, serial)
    result = wait_for_result(args.adb, serial, args.interval_sec, args.timeout_sec)

    print(f"serial={serial}")
    print(f"install={install_out}")
    print(f"result={result}")

    if result == "login":
        return 0
    if result == "technical_issue":
        print("release check failed: PhonePe reached technical issue page", flush=True)
        return 2
    print("release check failed: timeout waiting for login/technical issue page", flush=True)
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
