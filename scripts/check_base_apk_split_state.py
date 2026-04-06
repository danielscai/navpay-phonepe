#!/usr/bin/env python3
import argparse
import zipfile
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Check whether base.apk embeds split APK files")
    parser.add_argument("--base-apk", required=True)
    args = parser.parse_args()

    base_apk = Path(args.base_apk)
    if not base_apk.exists():
        print(f"[BASE-APK-CHECK] FAIL: base apk not found: {base_apk}")
        return 2

    try:
        with zipfile.ZipFile(base_apk, "r") as zf:
            names = zf.namelist()
    except zipfile.BadZipFile:
        print(f"[BASE-APK-CHECK] FAIL: invalid apk/zip: {base_apk}")
        return 2

    embedded_split_apks = [
        name for name in names
        if name.startswith("split_config.") and name.endswith(".apk")
    ]

    if embedded_split_apks:
        print("[BASE-APK-CHECK] FAIL: base.apk contains embedded split APK entries")
        for item in embedded_split_apks:
            print(f"  - {item}")
        return 1

    print(f"[BASE-APK-CHECK] PASS: {base_apk}")
    print("[BASE-APK-CHECK] split APK entries inside base.apk: NONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
