#!/usr/bin/env python3
import argparse
from pathlib import Path
from typing import Iterable, Optional


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
