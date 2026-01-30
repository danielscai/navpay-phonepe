#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MERGE_SCRIPT="$ROOT_DIR/tools/merge_split_apks.sh"
INPUT_DIR="$ROOT_DIR/temp/phonepe_from_device"
OUTPUT_DIR="$ROOT_DIR/temp/phonepe_merged_test"
PACKAGE_NAME="com.phonepe.app"
DEVICE_SERIAL=""

usage() {
  cat <<'USAGE'
Usage: tools/step2_verify_merge_apk.sh [-d <input_dir>] [-o <output_dir>] [-p <package>] [-s <serial>]

Runs real merge using merge_split_apks.sh, then verifies the signed APK.
Defaults:
  input_dir:  temp/phonepe_from_device
  output_dir: temp/phonepe_merged_test
  package:    com.phonepe.app

Examples:
  ./tools/step2_verify_merge_apk.sh
  ./tools/step2_verify_merge_apk.sh -d /path/to/apks -o /path/to/out
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    -d)
      INPUT_DIR="$2"
      shift 2
      ;;
    -o)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    -p)
      PACKAGE_NAME="$2"
      shift 2
      ;;
    -s)
      DEVICE_SERIAL="$2"
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

if [ ! -x "$MERGE_SCRIPT" ]; then
  echo "[FAIL] Missing merge script: $MERGE_SCRIPT"
  exit 1
fi

if [ ! -d "$INPUT_DIR" ]; then
  echo "[FAIL] Input dir not found: $INPUT_DIR"
  exit 1
fi

# Clean output dir to force a real merge
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

args=("-d" "$INPUT_DIR" "-p" "$PACKAGE_NAME" "-o" "$OUTPUT_DIR")
if [ -n "$DEVICE_SERIAL" ]; then
  args+=("-s" "$DEVICE_SERIAL")
fi

"$MERGE_SCRIPT" "${args[@]}"

# Detect signed APK
signed_candidates=("$OUTPUT_DIR"/*_merged_signed.apk)
SIGNED_APK=""
if [ ${#signed_candidates[@]} -eq 1 ] && [ -f "${signed_candidates[0]}" ]; then
  SIGNED_APK="${signed_candidates[0]}"
fi

if [ -z "$SIGNED_APK" ]; then
  echo "[FAIL] Expected signed APK not found in: $OUTPUT_DIR"
  ls -la "$OUTPUT_DIR"
  exit 1
fi

echo "[OK] Signed APK: $SIGNED_APK"

if command -v unzip >/dev/null 2>&1; then
  unzip -t "$SIGNED_APK" >/dev/null
  echo "[OK] Zip integrity: $SIGNED_APK"
fi

APKSIGNER="$HOME/Library/Android/sdk/build-tools/35.0.0/apksigner"
if [ -f "$APKSIGNER" ]; then
  if [ -d "/opt/homebrew/opt/openjdk" ]; then
    export JAVA_HOME="/opt/homebrew/opt/openjdk"
    export PATH="$JAVA_HOME/bin:$PATH"
  fi
  "$APKSIGNER" verify -v "$SIGNED_APK"
  echo "[OK] apksigner verification completed"
else
  echo "[WARN] apksigner not found; skipping signature verification"
fi

echo "[PASS] Step 2 merge completed and verified."
