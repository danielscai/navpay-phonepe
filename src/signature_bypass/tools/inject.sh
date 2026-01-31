#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$PROJECT_DIR/.." && pwd)"

source "$ROOT_DIR/tools/lib/env.sh"

TARGET_DIR="${1:-}"
if [ -z "$TARGET_DIR" ]; then
    log_error "Usage: $0 <decompiled_apk_dir>"
    exit 1
fi

if [ -z "${INJECT_SMALI_DIR:-}" ]; then
    log_error "INJECT_SMALI_DIR not set"
    exit 1
fi

BUILD_DIR="$PROJECT_DIR/build"
SMALI_DIR="$BUILD_DIR/smali"
PINE_SMALI_DIR="$BUILD_DIR/pine_smali"
PINE_LIB_DIR="$PROJECT_DIR/libs/jni"

log_step "Signature Bypass: Compile if needed"
if [ ! -d "$SMALI_DIR/com/sigbypass" ] || [ ! -d "$PINE_SMALI_DIR/top/canyie/pine" ]; then
    log_warn "Compiled smali not found, running compile.sh"
    "$SCRIPT_DIR/compile.sh"
fi

if [ ! -d "$SMALI_DIR/com/sigbypass" ]; then
    log_error "Signature bypass smali not found: $SMALI_DIR/com/sigbypass"
    exit 1
fi

log_step "Signature Bypass: Copy smali"
mkdir -p "$INJECT_SMALI_DIR"
cp -r "$SMALI_DIR/com" "$INJECT_SMALI_DIR/"
log_info "Copied com/sigbypass to $INJECT_SMALI_DIR"

log_step "Signature Bypass: Copy Pine smali"
if [ ! -d "$PINE_SMALI_DIR/top/canyie/pine" ]; then
    log_error "Pine smali not found: $PINE_SMALI_DIR/top/canyie/pine"
    exit 1
fi
mkdir -p "$INJECT_SMALI_DIR/top/canyie"
cp -r "$PINE_SMALI_DIR/top/canyie/pine" "$INJECT_SMALI_DIR/top/canyie/"
log_info "Copied Pine smali"

log_step "Signature Bypass: Copy native libs"
if [ -f "$PINE_LIB_DIR/arm64-v8a/libpine.so" ]; then
    mkdir -p "$TARGET_DIR/lib/arm64-v8a"
    cp "$PINE_LIB_DIR/arm64-v8a/libpine.so" "$TARGET_DIR/lib/arm64-v8a/"
    log_info "Copied libpine.so (arm64-v8a)"
else
    log_warn "libpine.so not found for arm64-v8a"
fi

if [ -f "$PINE_LIB_DIR/armeabi-v7a/libpine.so" ]; then
    mkdir -p "$TARGET_DIR/lib/armeabi-v7a"
    cp "$PINE_LIB_DIR/armeabi-v7a/libpine.so" "$TARGET_DIR/lib/armeabi-v7a/"
    log_info "Copied libpine.so (armeabi-v7a)"
fi

log_step "Signature Bypass: Done"
