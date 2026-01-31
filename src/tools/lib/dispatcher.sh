#!/bin/bash

set -euo pipefail

LIB_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$LIB_DIR/env.sh"

if [ -z "${INJECT_SMALI_DIR:-}" ]; then
    log_error "INJECT_SMALI_DIR not set"
    exit 1
fi

if [ "$#" -lt 1 ]; then
    log_error "No module entries provided"
    exit 1
fi

ROOT_DIR="$(cd "$LIB_DIR/../.." && pwd)"
TEMPLATE="$ROOT_DIR/_framework/dispatcher/smali/com/indipay/inject/Dispatcher.template.smali"
OUT_DIR="$INJECT_SMALI_DIR/com/indipay/inject"
OUT_FILE="$OUT_DIR/Dispatcher.smali"

mkdir -p "$OUT_DIR"

python3 "$LIB_DIR/render_dispatcher.py" "$TEMPLATE" "$OUT_FILE" "$@"
log_info "Dispatcher written: $OUT_FILE"
