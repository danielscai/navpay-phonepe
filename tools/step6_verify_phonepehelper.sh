#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SIG_COMPILE_SCRIPT="$ROOT_DIR/src/signature_bypass/tools/compile.sh"
SIG_MERGE_SCRIPT="$ROOT_DIR/src/signature_bypass/tools/merge.sh"
PATCH_INTERCEPTOR="$ROOT_DIR/tools/patch_https_interceptor.sh"
PHONEPEHELPER_PATCH="$ROOT_DIR/tools/patch_phonepehelper.sh"
SOURCE_APK_DEFAULT="$ROOT_DIR/temp/phonepe_merged_test/com.phonepe.app_merged_signed.apk"
WORK_DIR="$ROOT_DIR/temp/phonepehelper_test"
DECOMPILED_DIR="$WORK_DIR/base_decompiled"
UNSIGNED_APK="$WORK_DIR/patched_unsigned.apk"
ALIGNED_APK="$WORK_DIR/patched_aligned.apk"
SIGNED_APK="$WORK_DIR/patched_signed.apk"
PACKAGE_NAME="com.phonepe.app"
ACTIVITY_NAME=".launch.core.main.ui.MainActivity"
DEVICE_SERIAL=""
SOURCE_APK="$SOURCE_APK_DEFAULT"
FULL_RUN=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

usage() {
  cat <<'USAGE'
Usage: tools/step6_verify_phonepehelper.sh [options]

Options:
  --apk <path>   Source merged APK to patch (default: temp/phonepe_merged_test/com.phonepe.app_merged_signed.apk)
  -s <serial>    adb device/emulator serial (required if multiple devices)
  --full         Full rerun (ignore cached outputs)

Notes:
- 默认使用 FAST 模式（尽量复用缓存以加速验证）。
- Full run: signature-bypass merge -> phonepehelper patch -> rebuild -> sign -> install -> run -> logcat check.
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

if [ ! -x "$SIG_MERGE_SCRIPT" ]; then
  echo "[FAIL] Missing signature bypass merge script: $SIG_MERGE_SCRIPT"
  exit 1
fi
if [ ! -x "$PATCH_INTERCEPTOR" ]; then
  echo "[FAIL] Missing https interceptor patch script: $PATCH_INTERCEPTOR"
  exit 1
fi
if [ ! -x "$PHONEPEHELPER_PATCH" ]; then
  echo "[FAIL] Missing phonepehelper patch script: $PHONEPEHELPER_PATCH"
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
    emulator=$(echo "$devices" | rg -m1 '^emulator-' || true)
    if [ -n "$emulator" ]; then
      DEVICE_SERIAL="$emulator"
      echo "[INFO] Multiple devices found, auto-select emulator: $DEVICE_SERIAL"
    else
      echo "[FAIL] Multiple devices found. Please specify -s <serial>."
      echo "$devices"
      exit 1
    fi
  fi
fi

echo "[INFO] Using device: $DEVICE_SERIAL"
echo "[INFO] Mode: $([ "$FULL_RUN" -eq 1 ] && echo "FULL" || echo "FAST")"

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

SIG_BUILD_MTIME=""
if [ -f "$ROOT_DIR/src/signature_bypass/build/classes.dex" ]; then
  SIG_BUILD_MTIME=$(stat -f "%m" "$ROOT_DIR/src/signature_bypass/build/classes.dex" 2>/dev/null || true)
fi
PHONEPEHELPER_BUILD_MTIME=""
if [ -f "$ROOT_DIR/src/phonepehelper/build/classes.dex" ]; then
  PHONEPEHELPER_BUILD_MTIME=$(stat -f "%m" "$ROOT_DIR/src/phonepehelper/build/classes.dex" 2>/dev/null || true)
fi
PATCH_MTIME=""
if [ -f "$PHONEPEHELPER_PATCH" ]; then
  PATCH_MTIME=$(stat -f "%m" "$PHONEPEHELPER_PATCH" 2>/dev/null || true)
fi
CACHE_STAMP_FILE="$WORK_DIR/cache.stamp"
CACHE_MATCH=0
if [ -n "$SOURCE_MTIME" ] && [ -n "$SIG_BUILD_MTIME" ] && [ -n "$PATCH_MTIME" ] && [ -f "$CACHE_STAMP_FILE" ]; then
  if grep -Fq "$SOURCE_APK:$SOURCE_MTIME|sig:$SIG_BUILD_MTIME|pph:$PHONEPEHELPER_BUILD_MTIME|patch:$PATCH_MTIME" "$CACHE_STAMP_FILE"; then
    CACHE_MATCH=1
  fi
fi

if [ "$FULL_RUN" -eq 0 ] && [ "$CACHE_MATCH" -eq 1 ] && [ -f "$SIGNED_APK" ]; then
  echo "[INFO] Cache hit -> reuse signed APK"
else

echo "[INFO] Decompile source APK (reuse if possible)"
if [ "$FULL_RUN" -eq 0 ] && [ "$STAMP_MATCH" -eq 1 ] && [ -d "$DECOMPILED_DIR" ] && [ -f "$DECOMPILED_DIR/apktool.yml" ]; then
  echo "[INFO] Reusing decompiled APK: $DECOMPILED_DIR"
else
  rm -rf "$DECOMPILED_DIR"
  apktool d -f "$SOURCE_APK" -o "$DECOMPILED_DIR" >/dev/null
  echo "$SOURCE_APK:$SOURCE_MTIME" > "$STAMP_FILE"
fi

echo "[INFO] Step1: merge signature bypass"
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

echo "[INFO] Step2: patch https interceptor"
"$PATCH_INTERCEPTOR" "$DECOMPILED_DIR" >/dev/null

echo "[INFO] Step3: patch phonepehelper"
"$PHONEPEHELPER_PATCH" "$DECOMPILED_DIR" >/dev/null

echo "[INFO] Rebuild + sign APK"
apktool b "$DECOMPILED_DIR" -o "$UNSIGNED_APK" >/dev/null
"$ZIPALIGN" -f 4 "$UNSIGNED_APK" "$ALIGNED_APK"
"$APKSIGNER" sign --ks "$HOME/.android/debug.keystore" --ks-pass pass:android --out "$SIGNED_APK" "$ALIGNED_APK"
"$APKSIGNER" verify -v "$SIGNED_APK" >/dev/null

echo "$SOURCE_APK:$SOURCE_MTIME|sig:$SIG_BUILD_MTIME|pph:$PHONEPEHELPER_BUILD_MTIME|patch:$PATCH_MTIME" > "$CACHE_STAMP_FILE"

fi

echo "[INFO] Install APK"
adb -s "$DEVICE_SERIAL" install -r "$SIGNED_APK" >/dev/null

echo "[INFO] Launch app + check logs"
adb -s "$DEVICE_SERIAL" logcat -c

APP_OK=0
for attempt in 1 2 3; do
  echo "[INFO] Launch attempt $attempt/3"
  adb -s "$DEVICE_SERIAL" shell am force-stop "$PACKAGE_NAME" >/dev/null || true
  adb -s "$DEVICE_SERIAL" shell am start -n "$PACKAGE_NAME/$ACTIVITY_NAME" >/dev/null || true
  sleep 8

  if adb -s "$DEVICE_SERIAL" shell pidof "$PACKAGE_NAME" >/dev/null 2>&1; then
    LOGS=$(adb -s "$DEVICE_SERIAL" logcat -d -s PPHelper | tail -n 120)
    if echo "$LOGS" | grep -q "PhonePeHelper initialized"; then
      APP_OK=1
      break
    fi
  fi
done

if [ "$APP_OK" -eq 1 ]; then
  echo -e "${GREEN}[PASS]${NC} PPHelper logs found"
else
  echo -e "${RED}[FAIL]${NC} PPHelper logs not found"
  echo "[INFO] Collecting diagnostics..."
  adb -s "$DEVICE_SERIAL" shell pidof "$PACKAGE_NAME" > "$WORK_DIR/pidof.txt" 2>/dev/null || true
  adb -s "$DEVICE_SERIAL" shell dumpsys activity activities > "$WORK_DIR/dumpsys_activities.txt" 2>/dev/null || true
  adb -s "$DEVICE_SERIAL" logcat -d | rg -n "SigBypass|PPHelper" > "$WORK_DIR/logcat_injection.txt" || true
  adb -s "$DEVICE_SERIAL" logcat -d | rg -n "com.phonepe.app" > "$WORK_DIR/logcat_phonepe.txt" || true
  echo "[INFO] Diagnostics saved to: $WORK_DIR"
  exit 1
fi
