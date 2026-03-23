#!/bin/bash

set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$TOOLS_DIR/.." && pwd)"
REPO_ROOT="$(cd "$ROOT_DIR/.." && pwd)"
LIB_DIR="$TOOLS_DIR/lib"

source "$LIB_DIR/env.sh"

usage() {
    cat <<USAGE
Usage:
  $0 --full
  $0 --serial <adb_serial>

Examples:
  $0
  $0 --full
USAGE
}

WORK_DIR="$REPO_ROOT/temp/signature_bypass_test"
BASELINE_DIR="$REPO_ROOT/cache/phonepe_decompiled/base_decompiled_clean"
DECOMPILED_DIR="$WORK_DIR/base_decompiled"
UNSIGNED_APK="$WORK_DIR/patched_signature_bypass_unsigned.apk"
ALIGNED_APK="$WORK_DIR/patched_signature_bypass_aligned.apk"
SIGNED_APK="$WORK_DIR/patched_signature_bypass_signed.apk"
FULL_RUN=0
DEVICE_SERIAL="emulator-5554"
PACKAGE_NAME="com.phonepe.app"
ACTIVITY_NAME=".launch.core.main.ui.MainActivity"
LOGIN_ACTIVITY="com.phonepe.login.internal.ui.views.LoginActivity"

while [ "$#" -gt 0 ]; do
    case "$1" in
        --full)
            FULL_RUN=1; shift ;;
        --serial)
            DEVICE_SERIAL="$2"; shift 2 ;;
        -h|--help)
            usage; exit 0 ;;
        *)
            log_error "Unknown argument: $1"; usage; exit 1 ;;
    esac
done

require_cmd apktool

ANDROID_SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ZIPALIGN="$ANDROID_SDK/build-tools/35.0.0/zipalign"
APKSIGNER="$ANDROID_SDK/build-tools/35.0.0/apksigner"
ADB="$ANDROID_SDK/platform-tools/adb"

if [ ! -f "$ZIPALIGN" ]; then
    ZIPALIGN=$(find "$ANDROID_SDK/build-tools" -name "zipalign" | head -1 || true)
fi
if [ ! -f "$APKSIGNER" ]; then
    APKSIGNER=$(find "$ANDROID_SDK/build-tools" -name "apksigner" | head -1 || true)
fi

if [ ! -f "$ZIPALIGN" ] || [ ! -f "$APKSIGNER" ]; then
    log_error "zipalign/apksigner not found under Android SDK build-tools"
    log_error "Set ANDROID_HOME or install build-tools 35.0.0"
    exit 1
fi

if [ ! -f "$ADB" ]; then
    log_error "adb not found: $ADB"
    log_error "Install Android Platform Tools or set ANDROID_HOME"
    exit 1
fi

# Ensure Java runtime for apksigner
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk}"
export PATH="$JAVA_HOME/bin:$PATH"

if [ ! -d "$BASELINE_DIR" ]; then
    log_error "Cache baseline not found: $BASELINE_DIR"
    log_error "Run: python3 src/build-orchestrator/orchestrator.py rebuild"
    exit 1
fi

mkdir -p "$WORK_DIR"

if [ "$FULL_RUN" -eq 1 ]; then
    rm -rf "$WORK_DIR"
    mkdir -p "$WORK_DIR"
fi

log_step "Prepare working decompiled dir"
rm -rf "$DECOMPILED_DIR"
mkdir -p "$WORK_DIR"
rsync -a --delete "$BASELINE_DIR/" "$DECOMPILED_DIR/"

log_step "Inject Signature Bypass"
"$TOOLS_DIR/inject.sh" --decompiled "$DECOMPILED_DIR" --module signature_bypass

log_step "Rebuild APK"
apktool b "$DECOMPILED_DIR" -o "$UNSIGNED_APK"

log_step "Zipalign"
"$ZIPALIGN" -f 4 "$UNSIGNED_APK" "$ALIGNED_APK"

log_step "Sign APK"
"$APKSIGNER" sign --ks ~/.android/debug.keystore --ks-pass pass:android --out "$SIGNED_APK" "$ALIGNED_APK"
"$APKSIGNER" verify -v "$SIGNED_APK"

log_step "Install on Emulator"
if ! "$ADB" start-server >/dev/null 2>&1; then
    log_error "adb start-server failed (check permissions for smartsocket listener)"
    log_error "Try: $ADB kill-server && $ADB start-server"
    exit 1
fi
"$ADB" -s "$DEVICE_SERIAL" install -r "$SIGNED_APK"

log_step "Launch App"
"$ADB" -s "$DEVICE_SERIAL" shell am start -n "$PACKAGE_NAME/$ACTIVITY_NAME"

log_step "Verify Login Activity"
found=0
for i in $(seq 1 8); do
    "$ADB" -s "$DEVICE_SERIAL" shell dumpsys activity activities > "$WORK_DIR/dumpsys_activities.txt" || true
    if grep -Fq "$LOGIN_ACTIVITY" "$WORK_DIR/dumpsys_activities.txt"; then
        log_info "Login activity detected: $LOGIN_ACTIVITY"
        found=1
        break
    fi
    sleep 1
done

if [ "$found" -ne 1 ]; then
    log_error "Login activity not detected: $LOGIN_ACTIVITY"
    log_error "See: $WORK_DIR/dumpsys_activities.txt"
    exit 1
fi

log_step "Done"
log_info "Signed APK: $SIGNED_APK"
