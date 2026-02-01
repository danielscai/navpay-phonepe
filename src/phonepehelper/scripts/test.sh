#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$PROJECT_DIR/../.." && pwd)"

SIGNED_APK="${1:-}"
PACKAGE_NAME="${2:-}"
ACTIVITY_NAME="${3:-}"
DEVICE_SERIAL="${4:-}"

if [ -z "$SIGNED_APK" ] || [ -z "$PACKAGE_NAME" ] || [ -z "$ACTIVITY_NAME" ]; then
    echo "Usage: $0 <signed_apk> <package> <activity> [serial]"
    exit 1
fi

CACHE_MANAGER="$ROOT_DIR/src/cache-manager/cache_manager.py"

python3 - "$CACHE_MANAGER" "$SIGNED_APK" "$PACKAGE_NAME" "$ACTIVITY_NAME" "$DEVICE_SERIAL" <<'PYCODE'
import importlib.util
import sys
from pathlib import Path

cm_path = Path(sys.argv[1])
signed_apk = Path(sys.argv[2])
package = sys.argv[3]
activity = sys.argv[4]
serial = sys.argv[5] if len(sys.argv) > 5 else ""

spec = importlib.util.spec_from_file_location("cache_manager", cm_path)
cm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cm)

cm.phonepehelper_test(
    signed_apk,
    package,
    activity,
    serial,
)
PYCODE
