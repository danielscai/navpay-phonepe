#!/usr/bin/env python3
import argparse
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
    if proc.returncode != 0 or "Error:" in output:
        detail = output or "unknown launch error"
        raise RuntimeError(f"LAUNCH_FAILED: {detail}")
    if package not in output and "Status: ok" not in output:
        raise RuntimeError(f"LAUNCH_FAILED: unexpected launch output: {output}")
    return output


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-apk", required=True)
    args = parser.parse_args()

    if not Path(args.base_apk).exists():
        raise SystemExit("base apk not found")

    print("TODO")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
