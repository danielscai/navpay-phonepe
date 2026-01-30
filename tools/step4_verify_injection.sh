#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PATCH_SCRIPT="$ROOT_DIR/tools/patch_https_interceptor.sh"
SOURCE_APK_DEFAULT="$ROOT_DIR/temp/phonepe_merged_test/com.phonepe.app_merged_signed.apk"
WORK_DIR="$ROOT_DIR/temp/https_interceptor_test"
DECOMPILED_DIR="$WORK_DIR/base_decompiled"
UNSIGNED_APK="$WORK_DIR/patched_unsigned.apk"
ALIGNED_APK="$WORK_DIR/patched_aligned.apk"
SIGNED_APK="$WORK_DIR/patched_signed.apk"
PACKAGE_NAME="com.phonepe.app"
ACTIVITY_NAME=".launch.core.main.ui.MainActivity"
LOGIN_ACTIVITY="com.phonepe.login.internal.ui.views.LoginActivity"
DEVICE_SERIAL=""
SOURCE_APK="$SOURCE_APK_DEFAULT"

usage() {
  cat <<'USAGE'
Usage: tools/step4_verify_injection.sh [options]

Options:
  --apk <path>   Source merged APK to patch (default: temp/phonepe_merged_test/com.phonepe.app_merged_signed.apk)
  -s <serial>    adb device/emulator serial (required if multiple devices)

Notes:
- Full real run: patch -> rebuild -> sign -> install -> run -> logcat check.
- No log server involved; verification is via adb logcat.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --apk)
      SOURCE_APK="$2"
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

if [ ! -x "$PATCH_SCRIPT" ]; then
  echo "[FAIL] Missing patch script: $PATCH_SCRIPT"
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

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk}"
export PATH="$JAVA_HOME/bin:$PATH"

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

echo "[INFO] Using device: $DEVICE_SERIAL"

# Clean outputs
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

# Decompile source APK
apktool d -f "$SOURCE_APK" -o "$DECOMPILED_DIR" >/dev/null

# Patch interceptor into decompiled APK
"$PATCH_SCRIPT" "$DECOMPILED_DIR"

# Rebuild + sign
apktool b "$DECOMPILED_DIR" -o "$UNSIGNED_APK" >/dev/null
"$ZIPALIGN" -f 4 "$UNSIGNED_APK" "$ALIGNED_APK"
"$APKSIGNER" sign --ks "$HOME/.android/debug.keystore" --ks-pass pass:android --out "$SIGNED_APK" "$ALIGNED_APK"
"$APKSIGNER" verify -v "$SIGNED_APK"

# Install and run
adb -s "$DEVICE_SERIAL" install -r "$SIGNED_APK" >/dev/null
adb -s "$DEVICE_SERIAL" shell am start -n "$PACKAGE_NAME/$ACTIVITY_NAME" >/dev/null

# Wait for app startup
sleep 20

# Capture logcat for interceptor tag
adb -s "$DEVICE_SERIAL" logcat -d -s HttpInterceptor > "$WORK_DIR/logcat_httpinterceptor.txt" || true

if [ -s "$WORK_DIR/logcat_httpinterceptor.txt" ]; then
  echo "[PASS] Found HttpInterceptor logs: $WORK_DIR/logcat_httpinterceptor.txt"
else
  echo "[WARN] No HttpInterceptor logs captured yet: $WORK_DIR/logcat_httpinterceptor.txt"
  exit 1
fi

# Check if login activity is present in the task stack (usable state)
adb -s "$DEVICE_SERIAL" shell dumpsys activity activities > "$WORK_DIR/dumpsys_activities.txt" || true

if grep -Fq "$LOGIN_ACTIVITY" "$WORK_DIR/dumpsys_activities.txt"; then
  echo "[PASS] Login activity detected: $LOGIN_ACTIVITY"
else
  echo "[FAIL] Login activity not detected in task stack: $LOGIN_ACTIVITY"
  echo "       See: $WORK_DIR/dumpsys_activities.txt"
  exit 1
fi

echo "[PASS] Step 4 injection verification completed."
