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
LOGIN_ACTIVITY="com.phonepe.login.internal.ui.views.LoginActivity"
DEVICE_SERIAL=""
DO_INSTALL=true
DO_RUN=true
SOURCE_APK="$MERGED_APK_DEFAULT"
FULL_RUN=0

usage() {
  cat <<'USAGE'
Usage: tools/step3_verify_signature_bypass.sh [options]

Options:
  --apk <path>   Source merged APK to patch (default: temp/phonepe_merged_test/com.phonepe.app_merged_signed.apk)
  --install      Install patched APK to device/emulator
  --run          Launch app after install
  --no-run       Do not install/run (build only)
  -s <serial>    adb device/emulator serial
  --full         Full rerun (ignore cached outputs)

Notes:
- Default is fast: reuse decompiled APK and signature_bypass build outputs when possible.
- Default behavior installs + runs on the device. Use --no-run for build-only.
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
    --no-run)
      DO_INSTALL=false
      DO_RUN=false
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

if [ ! -x "$TASK_DIR/tools/compile.sh" ]; then
  echo "[FAIL] Missing script: $TASK_DIR/tools/compile.sh"
  exit 1
fi
if [ ! -x "$TASK_DIR/tools/merge.sh" ]; then
  echo "[FAIL] Missing script: $TASK_DIR/tools/merge.sh"
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

# Rebuild signature bypass outputs (reuse if possible)
if [ "$FULL_RUN" -eq 1 ]; then
  rm -rf "$TASK_DIR/build"
  (cd "$TASK_DIR" && ./tools/compile.sh)
else
  if [ ! -d "$TASK_DIR/build/smali" ] || [ ! -d "$TASK_DIR/build/pine_smali" ]; then
    (cd "$TASK_DIR" && ./tools/compile.sh)
  else
    echo "[INFO] Reusing signature_bypass build outputs"
  fi
fi

# Decompile source APK (reuse if possible)
if [ "$FULL_RUN" -eq 0 ] && [ "$STAMP_MATCH" -eq 1 ] && [ -d "$DECOMPILED_DIR" ] && [ -f "$DECOMPILED_DIR/apktool.yml" ]; then
  echo "[INFO] Reusing decompiled APK: $DECOMPILED_DIR"
else
  rm -rf "$DECOMPILED_DIR"
  apktool d -f "$SOURCE_APK" -o "$DECOMPILED_DIR"
  echo "$SOURCE_APK:$SOURCE_MTIME" > "$STAMP_FILE"
fi

# Merge smali + native libs + inject hook
(cd "$TASK_DIR" && ./tools/merge.sh "$DECOMPILED_DIR")

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
  if $DO_RUN; then
    adb -s "$DEVICE_SERIAL" shell am start -n "$PACKAGE_NAME/$ACTIVITY_NAME"
    found=0
    for i in $(seq 1 8); do
      adb -s "$DEVICE_SERIAL" shell dumpsys activity activities > "$WORK_DIR/dumpsys_activities.txt" || true
      if grep -Fq "$LOGIN_ACTIVITY" "$WORK_DIR/dumpsys_activities.txt"; then
        echo "[PASS] Login activity detected: $LOGIN_ACTIVITY"
        found=1
        break
      fi
      sleep 1
    done
    if [ "$found" -ne 1 ]; then
      echo "[FAIL] Login activity not detected in task stack: $LOGIN_ACTIVITY"
      echo "       See: $WORK_DIR/dumpsys_activities.txt"
      exit 1
    fi
  fi
fi

echo "[PASS] Step 3 full signature bypass pipeline completed."
