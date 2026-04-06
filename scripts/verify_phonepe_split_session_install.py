#!/usr/bin/env python3
import argparse
import re
import subprocess
from pathlib import Path
from typing import Iterable, Optional, Sequence


def _normalize_abi_token(abi: str) -> str:
    return abi.replace("-", "_")


def select_abi_split(files: Iterable[Path], supported_abis: Iterable[str]) -> Optional[Path]:
    split_files = [Path(path) for path in files]
    for abi in supported_abis:
        token = f"split_config.{_normalize_abi_token(abi)}.apk"
        for file_path in split_files:
            if file_path.name == token:
                return file_path
    return None


def select_density_split(files: Iterable[Path], density_bucket: str) -> Optional[Path]:
    target = f"split_config.{density_bucket}.apk"
    for file_path in files:
        path = Path(file_path)
        if path.name == target:
            return path
    return None


def install_multiple(adb: str, serial: str, apks: Sequence[Path]) -> str:
    cmd = [adb, "-s", serial, "install-multiple", "--no-incremental", *[str(path) for path in apks]]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    output = (proc.stdout + proc.stderr).strip()
    if proc.returncode != 0 or "Failure" in output:
        detail = output or "unknown adb install error"
        raise RuntimeError(f"INSTALL_MULTIPLE_FAILED: {detail}")
    return output


def verify_launch(adb: str, serial: str, package: str, activity: str, timeout_sec: int) -> str:
    cmd = [
        adb,
        "-s",
        serial,
        "shell",
        "am",
        "start",
        "-W",
        "-n",
        activity,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    output = (proc.stdout + proc.stderr).strip()
    if ("Error type 3" in output or "does not exist" in output) and package:
        monkey_cmd = [
            adb,
            "-s",
            serial,
            "shell",
            "monkey",
            "-p",
            package,
            "-c",
            "android.intent.category.LAUNCHER",
            "1",
        ]
        monkey_proc = subprocess.run(monkey_cmd, capture_output=True, text=True)
        monkey_output = (monkey_proc.stdout + monkey_proc.stderr).strip()
        if monkey_proc.returncode == 0:
            return monkey_output
        output = (output + "\n" + monkey_output).strip()
    if proc.returncode != 0 or "Error:" in output:
        detail = output or "unknown launch error"
        raise RuntimeError(f"LAUNCH_FAILED: {detail}")
    if package not in output and "Status: ok" not in output:
        raise RuntimeError(f"LAUNCH_FAILED: unexpected launch output: {output}")
    return output


def _run_adb_capture(adb: str, serial: str, args: Sequence[str]) -> str:
    cmd = [adb, "-s", serial, *args]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    output = (proc.stdout + proc.stderr).strip()
    if proc.returncode != 0:
        detail = output or "adb command failed"
        raise RuntimeError(f"ADB_FAILED: {detail}")
    return output


def get_supported_abis(adb: str, serial: str) -> list[str]:
    abilist = _run_adb_capture(adb, serial, ["shell", "getprop", "ro.product.cpu.abilist"]).strip()
    if abilist:
        return [abi.strip() for abi in abilist.split(",") if abi.strip()]
    abi = _run_adb_capture(adb, serial, ["shell", "getprop", "ro.product.cpu.abi"]).strip()
    return [abi] if abi else []


def _density_to_bucket(density: int) -> str:
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


def normalize_activity_component(package: str, activity: str) -> str:
    if "/" not in activity:
        return activity
    pkg, cls = activity.split("/", 1)
    if pkg != package:
        return activity
    full_prefix = f"{package}."
    if cls.startswith(full_prefix):
        return f"{package}/.{cls[len(full_prefix):]}"
    return activity


def get_density_bucket(adb: str, serial: str) -> str:
    output = _run_adb_capture(adb, serial, ["shell", "wm", "density"])
    match = re.search(r"(\d+)", output)
    if not match:
        prop = _run_adb_capture(adb, serial, ["shell", "getprop", "ro.sf.lcd_density"])
        match = re.search(r"(\d+)", prop)
    if not match:
        raise RuntimeError(f"SELECT_SPLIT_FAILED: unable to resolve device density from: {output}")
    return _density_to_bucket(int(match.group(1)))


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adb", default="adb")
    parser.add_argument("--serial")
    parser.add_argument("--base-apk", required=True)
    parser.add_argument("--splits-dir")
    parser.add_argument("--target-apk")
    parser.add_argument("--package")
    parser.add_argument("--activity")
    parser.add_argument("--timeout-sec", type=int, default=30)
    args = parser.parse_args(argv)

    base_apk = Path(args.base_apk)
    if not base_apk.exists():
        raise SystemExit("base apk not found")

    if not all([args.serial, args.splits_dir, args.package, args.activity]):
        print("TODO")
        return 0

    if args.target_apk and not Path(args.target_apk).exists():
        raise SystemExit("target apk not found")

    split_files = sorted(Path(args.splits_dir).glob("split_config.*.apk"))
    supported_abis = get_supported_abis(args.adb, args.serial)
    density_bucket = get_density_bucket(args.adb, args.serial)
    abi_split = select_abi_split(split_files, supported_abis)
    density_split = select_density_split(split_files, density_bucket)
    if abi_split is None:
        raise SystemExit(f"SELECT_SPLIT_FAILED: missing ABI split for {supported_abis}")
    if density_split is None:
        raise SystemExit(f"SELECT_SPLIT_FAILED: missing density split for {density_bucket}")

    selected_apks = [base_apk, abi_split, density_split]
    install_out = install_multiple(args.adb, args.serial, selected_apks)
    launch_component = normalize_activity_component(args.package, args.activity)
    launch_out = verify_launch(args.adb, args.serial, args.package, launch_component, args.timeout_sec)
    print(f"selected_apks={','.join(str(apk) for apk in selected_apks)}")
    print(f"install={install_out}")
    print(f"launch={launch_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
