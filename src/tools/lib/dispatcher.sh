#!/bin/bash

set -euo pipefail

LIB_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$LIB_DIR/env.sh"

TARGET_DIR="${INJECT_SMALI_DIR:-}"
APPEND_ENTRIES=()
POSITIONAL_ENTRIES=()

while [ "$#" -gt 0 ]; do
    case "$1" in
        --target-dir)
            if [ "$#" -lt 2 ] || [ -z "${2-}" ]; then
                log_error "--target-dir requires a non-empty value"
                exit 1
            fi
            TARGET_DIR="$2"
            shift 2
            ;;
        --append)
            if [ "$#" -lt 2 ] || [ -z "${2-}" ]; then
                log_error "--append requires a non-empty entry, e.g. Lcom/foo/Bar;->init(Landroid/content/Context;)V"
                exit 1
            fi
            APPEND_ENTRIES+=("$2")
            shift 2
            ;;
        -h|--help)
            cat <<USAGE
Usage:
  dispatcher.sh <entry1> [entry2 ...]
  dispatcher.sh --target-dir <smali_dir> --append <entry> [--append <entry> ...]
USAGE
            exit 0
            ;;
        *)
            POSITIONAL_ENTRIES+=("$1")
            shift
            ;;
    esac
done

if [ -z "${TARGET_DIR:-}" ]; then
    log_error "INJECT_SMALI_DIR not set and --target-dir missing"
    exit 1
fi

ROOT_DIR="$(cd "$LIB_DIR/../.." && pwd)"
TEMPLATE="$ROOT_DIR/_framework/dispatcher/smali/com/indipay/inject/Dispatcher.template.smali"
OUT_DIR="$TARGET_DIR/com/indipay/inject"
OUT_FILE="$OUT_DIR/Dispatcher.smali"

mkdir -p "$OUT_DIR"

EXISTING_ENTRIES=()
if [ -f "$OUT_FILE" ]; then
    while IFS= read -r entry; do
        if [ -n "$entry" ]; then
            EXISTING_ENTRIES+=("$entry")
        fi
    done < <(python3 - "$OUT_FILE" <<'PYCODE'
import re
import sys

content = open(sys.argv[1], "r", encoding="utf-8").read()
entries = re.findall(r"invoke-static \{p0\}, (L[^ ]+;->[^\n]+)", content)
for item in entries:
    print(item.strip())
PYCODE
)
fi

ALL_ENTRIES=()
for entry in "${EXISTING_ENTRIES[@]-}" "${POSITIONAL_ENTRIES[@]-}" "${APPEND_ENTRIES[@]-}"; do
    if [ -n "$entry" ]; then
        ALL_ENTRIES+=("$entry")
    fi
done

if [ "${#ALL_ENTRIES[@]}" -eq 0 ]; then
    log_error "No module entries provided"
    exit 1
fi

UNIQUE_ENTRIES=()
for entry in "${ALL_ENTRIES[@]-}"; do
    seen=0
    for existing in "${UNIQUE_ENTRIES[@]-}"; do
        if [ "$existing" = "$entry" ]; then
            seen=1
            break
        fi
    done
    if [ "$seen" -eq 0 ]; then
        UNIQUE_ENTRIES+=("$entry")
    fi
done

python3 "$LIB_DIR/render_dispatcher.py" "$TEMPLATE" "$OUT_FILE" "${UNIQUE_ENTRIES[@]}"
log_info "Dispatcher written: $OUT_FILE"
