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
    log_warn "INJECT_SMALI_DIR not set, scanning target for smali_classes"
    INJECT_SMALI_DIR=$(ls -d "$TARGET_DIR"/smali_classes* 2>/dev/null | sort -V | tail -1 || true)
fi

log_step "Verify Signature Bypass Injection"

check() {
    local path="$1"
    local name="$2"
    if [ -f "$path" ] || [ -d "$path" ]; then
        echo -e "  ${GREEN}✓${NC} $name"
    else
        echo -e "  ${RED}✗${NC} $name"
    fi
}

check "$INJECT_SMALI_DIR/com/sigbypass/HookEntry.smali" "HookEntry.smali"
check "$INJECT_SMALI_DIR/top/canyie/pine/Pine.smali" "Pine.smali"
check "$TARGET_DIR/lib/arm64-v8a/libpine.so" "libpine.so (arm64-v8a)"

log_step "Done"
