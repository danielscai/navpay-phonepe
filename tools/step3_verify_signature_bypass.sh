#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TASK_DIR="$ROOT_DIR/src/signature_bypass"
MERGED_APK_DEFAULT="$ROOT_DIR/temp/phonepe_merged_test/com.phonepe.app_merged_signed.apk"
WORK_DIR="$ROOT_DIR/temp/signature_bypass_test"
DECOMPILED_DIR="$WORK_DIR/base_decompiled"
UNSIGNED_APK="$WORK_DIR/patched_unsigned.apk"
ALIGNED_APK="$WORK_DIR/patched_aligned.apk"
SIGNED_APK="$WORK_DIR/patched_signed.apk"
PACKAGE_NAME="com.phonepe.app"
ACTIVITY_NAME=".launch.core.main.ui.MainActivity"
DEVICE_SERIAL=""
DO_INSTALL=false
DO_RUN=false
SOURCE_APK="$MERGED_APK_DEFAULT"

usage() {
  cat <<'USAGE'
Usage: tools/step3_verify_signature_bypass.sh [options]

Options:
  --apk <path>   Source merged APK to patch (default: temp/phonepe_merged_test/com.phonepe.app_merged_signed.apk)
  --install      Install patched APK to device/emulator
  --run          Launch app after install
  -s <serial>    adb device/emulator serial

Notes:
- Always rebuilds signature_bypass outputs and re-patches the APK.
- Uses apktool/zipalign/apksigner; outputs go to temp/signature_bypass_test/.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --apk)
      SOURCE_APK="$2"
      shift 2
      ;;
    --install)
      DO_INSTALL=true
      shift
      ;;
    --run)
      DO_RUN=true
      shift
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

if [ ! -x "$TASK_DIR/scripts/compile.sh" ]; then
  echo "[FAIL] Missing script: $TASK_DIR/scripts/compile.sh"
  exit 1
fi
if [ ! -x "$TASK_DIR/scripts/merge.sh" ]; then
  echo "[FAIL] Missing script: $TASK_DIR/scripts/merge.sh"
  exit 1
fi
if [ ! -f "$SOURCE_APK" ]; then
  echo "[FAIL] Source APK not found: $SOURCE_APK"
  exit 1
fi

ZIPALIGN="$HOME/Library/Android/sdk/build-tools/35.0.0/zipalign"
APKSIGNER="$HOME/Library/Android/sdk/build-tools/35.0.0/apksigner"

if [ ! -f "$ZIPALIGN" ] || [ ! -f "$APKSIGNER" ]; then
  echo "[FAIL] zipalign or apksigner not found under build-tools/35.0.0"
  exit 1
fi

# Ensure Java runtime for apksigner
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk}"
export PATH="$JAVA_HOME/bin:$PATH"

# Clean outputs to ensure real run
rm -rf "$TASK_DIR/build" "$WORK_DIR"
mkdir -p "$WORK_DIR"

# Rebuild signature bypass outputs
(cd "$TASK_DIR" && ./scripts/compile.sh)

# Decompile source APK
apktool d -f "$SOURCE_APK" -o "$DECOMPILED_DIR"

# Merge smali + native libs + inject hook
(cd "$TASK_DIR" && ./scripts/merge.sh "$DECOMPILED_DIR")

# Rebuild patched APK
apktool b "$DECOMPILED_DIR" -o "$UNSIGNED_APK"

# Align + sign
"$ZIPALIGN" -f 4 "$UNSIGNED_APK" "$ALIGNED_APK"
"$APKSIGNER" sign --ks "$HOME/.android/debug.keystore" --ks-pass pass:android --out "$SIGNED_APK" "$ALIGNED_APK"

"$APKSIGNER" verify -v "$SIGNED_APK"

# Optional install/run
if $DO_INSTALL || $DO_RUN; then
  if ! command -v adb >/dev/null 2>&1; then
    echo "[FAIL] adb not found"
    exit 1
  fi

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

  $DO_INSTALL && adb -s "$DEVICE_SERIAL" install -r "$SIGNED_APK"
  $DO_RUN && adb -s "$DEVICE_SERIAL" shell am start -n "$PACKAGE_NAME/$ACTIVITY_NAME"
fi

echo "[PASS] Step 3 full signature bypass pipeline completed."
