#!/usr/bin/env python3
import argparse
from pathlib import Path


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
