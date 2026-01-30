#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT_DIR/temp/phonepe_from_device"
PACKAGE_NAME="com.phonepe.app"
DEVICE_SERIAL=""

usage() {
  cat <<'USAGE'
Usage: tools/step1_verify_extract_apk.sh [-s <serial>] [-p <package>]

Pulls APK splits from a real device via adb and verifies they are valid zips.
Defaults:
  package: com.phonepe.app
  output:  temp/phonepe_from_device

Examples:
  ./tools/step1_verify_extract_apk.sh -s SM02G4061933188
  ./tools/step1_verify_extract_apk.sh -s emulator-5554 -p com.example.app
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    -s)
      DEVICE_SERIAL="$2"
      shift 2
      ;;
    -p)
      PACKAGE_NAME="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[FAIL] Unknown arg: $1"
      usage
      exit 1
      ;;
  esac
done

if ! command -v adb >/dev/null 2>&1; then
  echo "[FAIL] adb not found"
  exit 1
fi

# Select device if not provided
if [ -z "$DEVICE_SERIAL" ]; then
  devices=$(adb devices | grep -v "List" | awk '$2=="device" {print $1}')
  count=$(echo "$devices" | grep -c . || true)
  if [ "$count" -eq 0 ]; then
    echo "[FAIL] No adb devices found"
    exit 1
  elif [ "$count" -eq 1 ]; then
    DEVICE_SERIAL="$devices"
  else
    echo "[FAIL] Multiple devices found. Please specify -s <serial>."
    echo "$devices"
    exit 1
  fi
fi

echo "[INFO] Using device: $DEVICE_SERIAL"

# Ensure app exists on device
if ! adb -s "$DEVICE_SERIAL" shell pm list packages | grep -q "$PACKAGE_NAME"; then
  echo "[FAIL] Package not installed on device: $PACKAGE_NAME"
  exit 1
fi

# Clean output dir to ensure fresh pull
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Pull split APKs
apk_paths=$(adb -s "$DEVICE_SERIAL" shell pm path "$PACKAGE_NAME" | sed 's/package://')
if [ -z "$apk_paths" ]; then
  echo "[FAIL] Unable to resolve APK paths for: $PACKAGE_NAME"
  exit 1
fi

echo "[INFO] Pulling APKs to: $OUT_DIR"
while read -r path; do
  [ -z "$path" ] && continue
  adb -s "$DEVICE_SERIAL" pull "$path" "$OUT_DIR/"
done <<< "$apk_paths"

# Verify expected files
files=(
  "$OUT_DIR/base.apk"
  "$OUT_DIR/split_config.arm64_v8a.apk"
  "$OUT_DIR/split_config.xxhdpi.apk"
)

for f in "${files[@]}"; do
  if [ ! -f "$f" ]; then
    echo "[FAIL] Missing file: $f"
    exit 1
  fi
  size=$(stat -f%z "$f")
  if [ "$size" -le 0 ]; then
    echo "[FAIL] File is empty: $f"
    exit 1
  fi
  echo "[OK] Found: $f (${size} bytes)"
  if command -v unzip >/dev/null 2>&1; then
    unzip -t "$f" >/dev/null
    echo "[OK] Zip integrity: $f"
  fi

done

echo "[PASS] Step 1 extraction completed and verified."
