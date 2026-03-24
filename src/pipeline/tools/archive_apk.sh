#!/bin/bash

set -euo pipefail

usage() {
    cat <<'USAGE'
Archive an APK with metadata for baseline/candidate comparisons.

Usage:
  archive_apk.sh --apk <path.apk> --label <label> [--output-root <dir>]

Options:
  --apk <path>          APK file to archive (required)
  --label <label>       Logical label such as baseline/candidate/v1/v2 (required)
  --output-root <dir>   Root artifacts directory (default: artifacts)
  -h, --help            Show this help and exit

Outputs:
  <output-root>/<label>/<timestamp>/
    - <original-apk-name>
    - apk.sha256
    - meta.json
USAGE
}

APK_PATH=""
LABEL=""
OUTPUT_ROOT="artifacts"

require_arg_value() {
    local flag="$1"
    if [ "$#" -lt 2 ]; then
        echo "Missing value for $flag" >&2
        exit 1
    fi
    if [ -z "${2:-}" ] || [ "${2#--}" != "$2" ]; then
        echo "Missing value for $flag" >&2
        exit 1
    fi
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --apk)
            require_arg_value "$1" "${2:-}"
            APK_PATH="$2"
            shift 2
            ;;
        --label)
            require_arg_value "$1" "${2:-}"
            LABEL="$2"
            shift 2
            ;;
        --output-root)
            require_arg_value "$1" "${2:-}"
            OUTPUT_ROOT="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            usage
            exit 1
            ;;
    esac
done

if [ -z "$APK_PATH" ] || [ -z "$LABEL" ]; then
    usage
    exit 1
fi

if [ ! -f "$APK_PATH" ]; then
    echo "APK not found: $APK_PATH" >&2
    exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
    HASH_CMD="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
    HASH_CMD="shasum -a 256"
else
    echo "Command not found: sha256sum or shasum" >&2
    exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "Command not found: python3" >&2
    exit 1
fi

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST_DIR="$OUTPUT_ROOT/$LABEL/$TIMESTAMP"
mkdir -p "$DEST_DIR"

APK_BASENAME="$(basename "$APK_PATH")"
DEST_APK="$DEST_DIR/$APK_BASENAME"
cp "$APK_PATH" "$DEST_APK"

APK_SHA256="$($HASH_CMD "$DEST_APK" | awk '{print $1}')"
printf "%s  %s\n" "$APK_SHA256" "$APK_BASENAME" > "$DEST_DIR/apk.sha256"

python3 - "$DEST_DIR/meta.json" "$LABEL" "$TIMESTAMP" "$APK_PATH" "$APK_BASENAME" "$APK_SHA256" <<'PY'
import json
import sys
from pathlib import Path

meta_path = Path(sys.argv[1])
data = {
    "label": sys.argv[2],
    "timestamp_utc": sys.argv[3],
    "source_apk": sys.argv[4],
    "archived_apk": sys.argv[5],
    "sha256": sys.argv[6],
}
meta_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

echo "Archived to: $DEST_DIR"
echo "SHA256: $APK_SHA256"
