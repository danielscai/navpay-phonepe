#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PATCH_SCRIPT="$ROOT_DIR/tools/patch_https_interceptor.sh"
SIG_COMPILE_SCRIPT="$ROOT_DIR/src/signature_bypass/scripts/compile.sh"
SIG_MERGE_SCRIPT="$ROOT_DIR/src/signature_bypass/scripts/merge.sh"
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
FULL_RUN=0

usage() {
  cat <<'USAGE'
Usage: tools/step4_verify_injection.sh [options]

Options:
  --apk <path>   Source merged APK to patch (default: temp/phonepe_merged_test/com.phonepe.app_merged_signed.apk)
  -s <serial>    adb device/emulator serial (required if multiple devices)
  --full         Full rerun (ignore cached outputs)

Notes:
- Full real run: signature-bypass merge -> patch -> rebuild -> sign -> install -> run -> logcat check.
- No log server involved; verification is via adb logcat.
 - Default fast mode reuses cached outputs when possible; use --full to force rebuild.
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
    --full)
      FULL_RUN=1
      shift
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
if [ ! -x "$SIG_MERGE_SCRIPT" ]; then
  echo "[FAIL] Missing signature bypass merge script: $SIG_MERGE_SCRIPT"
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

# Prepare work dir
if [ "$FULL_RUN" -eq 1 ]; then
  rm -rf "$WORK_DIR"
fi
mkdir -p "$WORK_DIR"

STAMP_FILE="$WORK_DIR/source_apk.stamp"
SOURCE_MTIME=""
if [ -f "$SOURCE_APK" ]; then
  SOURCE_MTIME=$(stat -f "%m" "$SOURCE_APK" 2>/dev/null || true)
fi
STAMP_MATCH=0
if [ -n "$SOURCE_MTIME" ] && [ -f "$STAMP_FILE" ]; then
  if grep -Fq "$SOURCE_APK:$SOURCE_MTIME" "$STAMP_FILE"; then
    STAMP_MATCH=1
  fi
fi

# If cached signed APK is valid, reuse it directly
DEMO_APK="$ROOT_DIR/src/https_interceptor/app/build/outputs/apk/debug/app-debug.apk"
DEMO_MTIME=""
if [ -f "$DEMO_APK" ]; then
  DEMO_MTIME=$(stat -f "%m" "$DEMO_APK" 2>/dev/null || true)
fi
SIG_BUILD_MTIME=""
if [ -f "$ROOT_DIR/src/signature_bypass/build/classes.dex" ]; then
  SIG_BUILD_MTIME=$(stat -f "%m" "$ROOT_DIR/src/signature_bypass/build/classes.dex" 2>/dev/null || true)
fi
CACHE_STAMP_FILE="$WORK_DIR/cache.stamp"
CACHE_MATCH=0
if [ -n "$SOURCE_MTIME" ] && [ -n "$DEMO_MTIME" ] && [ -n "$SIG_BUILD_MTIME" ] && [ -f "$CACHE_STAMP_FILE" ]; then
  if grep -Fq "$SOURCE_APK:$SOURCE_MTIME|$DEMO_APK:$DEMO_MTIME|sig:$SIG_BUILD_MTIME" "$CACHE_STAMP_FILE"; then
    CACHE_MATCH=1
  fi
fi

if [ "$FULL_RUN" -eq 0 ] && [ "$CACHE_MATCH" -eq 1 ] && [ -f "$SIGNED_APK" ]; then
  echo "[INFO] Reusing cached signed APK: $SIGNED_APK"
else

# Decompile source APK (reuse if possible)
if [ "$FULL_RUN" -eq 0 ] && [ "$STAMP_MATCH" -eq 1 ] && [ -d "$DECOMPILED_DIR" ] && [ -f "$DECOMPILED_DIR/apktool.yml" ]; then
  echo "[INFO] Reusing decompiled APK: $DECOMPILED_DIR"
else
  rm -rf "$DECOMPILED_DIR"
  apktool d -f "$SOURCE_APK" -o "$DECOMPILED_DIR" >/dev/null
  echo "$SOURCE_APK:$SOURCE_MTIME" > "$STAMP_FILE"
fi

# Step 3: always merge signature bypass into decompiled APK
echo "[INFO] Merging signature bypass (step3) into decompiled APK..."
if [ -x "$SIG_COMPILE_SCRIPT" ]; then
  if [ "$FULL_RUN" -eq 1 ]; then
    "$SIG_COMPILE_SCRIPT" >/dev/null
  else
    if [ ! -d "$ROOT_DIR/src/signature_bypass/build/smali" ] || \
       [ ! -d "$ROOT_DIR/src/signature_bypass/build/pine_smali" ]; then
      "$SIG_COMPILE_SCRIPT" >/dev/null
    else
      echo "[INFO] Reusing signature_bypass build outputs"
    fi
  fi
fi
"$SIG_MERGE_SCRIPT" "$DECOMPILED_DIR" >/dev/null

# Patch interceptor into decompiled APK (step4)
"$PATCH_SCRIPT" "$DECOMPILED_DIR"

# If OkHttpClient$Builder.build() calls HookUtil.build(), ensure HookUtil exists
BUILDER_SMALI=$(find "$DECOMPILED_DIR" -path '*/okhttp3/OkHttpClient$Builder.smali' | head -1)
HOOKUTIL_SMALI=$(find "$DECOMPILED_DIR" -path '*/com/httpinterceptor/hook/HookUtil.smali' | head -1)
if [ -n "$BUILDER_SMALI" ] && rg -q "com/httpinterceptor/hook/HookUtil;->build\\(" "$BUILDER_SMALI"; then
  if [ -z "$HOOKUTIL_SMALI" ] || [ ! -f "$HOOKUTIL_SMALI" ]; then
    echo '[FAIL] OkHttpClient$Builder.build() calls HookUtil.build() but HookUtil.smali is missing.'
    exit 1
  fi
fi

# Rebuild + sign
apktool b "$DECOMPILED_DIR" -o "$UNSIGNED_APK" >/dev/null
"$ZIPALIGN" -f 4 "$UNSIGNED_APK" "$ALIGNED_APK"
"$APKSIGNER" sign --ks "$HOME/.android/debug.keystore" --ks-pass pass:android --out "$SIGNED_APK" "$ALIGNED_APK"
"$APKSIGNER" verify -v "$SIGNED_APK"

echo "$SOURCE_APK:$SOURCE_MTIME|$DEMO_APK:$DEMO_MTIME|sig:$SIG_BUILD_MTIME" > "$CACHE_STAMP_FILE"
fi

# Install and run
adb -s "$DEVICE_SERIAL" install -r "$SIGNED_APK" >/dev/null
adb -s "$DEVICE_SERIAL" shell am start -n "$PACKAGE_NAME/$ACTIVITY_NAME" >/dev/null

# Wait for app startup (8s is enough)
sleep 8

# Capture logcat for interceptor tag
adb -s "$DEVICE_SERIAL" logcat -d -s HttpInterceptor > "$WORK_DIR/logcat_httpinterceptor.txt" || true

if [ -s "$WORK_DIR/logcat_httpinterceptor.txt" ]; then
  echo "[PASS] Found HttpInterceptor logs: $WORK_DIR/logcat_httpinterceptor.txt"
else
  echo "[WARN] No HttpInterceptor logs captured yet: $WORK_DIR/logcat_httpinterceptor.txt"
  exit 1
fi

# Capture logcat for signature bypass tag
adb -s "$DEVICE_SERIAL" logcat -d -s SigBypass > "$WORK_DIR/logcat_sigbypass.txt" || true

if [ -s "$WORK_DIR/logcat_sigbypass.txt" ]; then
  echo "[PASS] Found SigBypass logs: $WORK_DIR/logcat_sigbypass.txt"
else
  echo "[FAIL] No SigBypass logs captured: $WORK_DIR/logcat_sigbypass.txt"
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
