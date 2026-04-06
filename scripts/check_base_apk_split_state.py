#!/usr/bin/env python3
import argparse
import zipfile
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Check whether target APK embeds split APK files")
    parser.add_argument("--apk", required=True)
    args = parser.parse_args()

    target_apk = Path(args.apk)
    if not target_apk.exists():
        print(f"[APK-SPLIT-CHECK] FAIL: apk not found: {target_apk}")
        return 2

    try:
        with zipfile.ZipFile(target_apk, "r") as zf:
            names = zf.namelist()
    except zipfile.BadZipFile:
        print(f"[APK-SPLIT-CHECK] FAIL: invalid apk/zip: {target_apk}")
        return 2

    embedded_split_apks = [
        name for name in names
        if name.startswith("split_config.") and name.endswith(".apk")
    ]

    if embedded_split_apks:
        print("[APK-SPLIT-CHECK] FAIL: target APK contains embedded split APK entries")
        for item in embedded_split_apks:
            print(f"  - {item}")
        return 1

    print(f"[APK-SPLIT-CHECK] PASS: {target_apk}")
    print("[APK-SPLIT-CHECK] split APK entries inside target APK: NONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
