#!/bin/bash

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "\n${BLUE}==== $1 ====${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODULE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$MODULE_DIR/../../.." && pwd)"
DEFAULT_TARGET_DIR="$ROOT_DIR/temp/heartbeat_bridge_merged/decompiled/base"
ARTIFACT_DIR=""
TARGET_DIR=""

usage() {
    echo "Usage: $0 --artifact-dir <path> <decompiled_dir>"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --artifact-dir)
            shift
            if [ $# -eq 0 ]; then
                log_error "--artifact-dir requires a path"
                usage
                exit 1
            fi
            ARTIFACT_DIR="$1"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            if [ -z "$TARGET_DIR" ]; then
                TARGET_DIR="$1"
            else
                log_error "Unknown argument: $1"
                usage
                exit 1
            fi
            shift
            ;;
    esac
done

TARGET_DIR="${TARGET_DIR:-$DEFAULT_TARGET_DIR}"

if [ -z "$ARTIFACT_DIR" ]; then
    log_error "artifact-dir is required"
    exit 1
fi

if [ ! -d "$TARGET_DIR" ]; then
    log_error "Target directory does not exist: $TARGET_DIR"
    exit 1
fi

if [ ! -d "$ARTIFACT_DIR" ]; then
    log_error "Artifact directory does not exist: $ARTIFACT_DIR"
    exit 1
fi

log_step "Check environment"
log_info "Using artifact dir: $ARTIFACT_DIR"

copy_artifact_files() {
    local search_pattern="$1"
    local dest_dir="$2"
    local label="$3"
    local found=0

    while IFS= read -r file; do
        [ -n "$file" ] || continue
        cp "$file" "$dest_dir/"
        found=1
    done < <(find "$ARTIFACT_DIR" -type f -path "*/$search_pattern" | sort)

    if [ "$found" -ne 1 ]; then
        log_error "Missing $label smali files"
        exit 1
    fi
}

max_idx=0
for d in "$TARGET_DIR"/smali_classes*; do
    [ -d "$d" ] || continue
    base=$(basename "$d")
    if [[ "$base" =~ ^smali_classes([0-9]+)$ ]]; then
        idx="${BASH_REMATCH[1]}"
        if [ "$idx" -gt "$max_idx" ]; then
            max_idx="$idx"
        fi
    fi
done
new_idx=$((max_idx + 1))
INJECT_SMALI_DIR="$TARGET_DIR/smali_classes$new_idx"
mkdir -p "$INJECT_SMALI_DIR"

while IFS= read -r d; do
    rm -rf "$d"
done < <(find "$TARGET_DIR" -type d -path "*/com/heartbeatbridge")

BRIDGE_SMALI_DIR="$INJECT_SMALI_DIR/com/heartbeatbridge"
mkdir -p "$BRIDGE_SMALI_DIR"

log_step "Copy bridge smali"
copy_artifact_files "com/heartbeatbridge/*.smali" "$BRIDGE_SMALI_DIR" "heartbeat bridge"

log_step "Inject provider"
MANIFEST_FILE="$TARGET_DIR/AndroidManifest.xml"
if [ ! -f "$MANIFEST_FILE" ]; then
    log_error "AndroidManifest.xml not found"
    exit 1
fi

python3 - "$MANIFEST_FILE" <<'PYCODE'
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

manifest_path = Path(sys.argv[1])
ns_android = "http://schemas.android.com/apk/res/android"
ET.register_namespace("android", ns_android)

tree = ET.parse(manifest_path)
root = tree.getroot()
application = root.find("application")
if application is None:
    raise SystemExit("missing <application> in AndroidManifest.xml")

provider_name = "com.heartbeatbridge.HeartbeatBridgeProvider"
provider_authority = "com.phonepe.navpay.heartbeat.provider"

for node in application.findall("provider"):
    if node.get(f"{{{ns_android}}}name") == provider_name or node.get(f"{{{ns_android}}}authorities") == provider_authority:
        tree.write(manifest_path, encoding="utf-8", xml_declaration=True)
        print("provider already injected")
        raise SystemExit(0)

provider = ET.Element("provider")
provider.set(f"{{{ns_android}}}name", provider_name)
provider.set(f"{{{ns_android}}}exported", "true")
provider.set(f"{{{ns_android}}}grantUriPermissions", "true")
provider.set(f"{{{ns_android}}}authorities", provider_authority)
application.append(provider)

tree.write(manifest_path, encoding="utf-8", xml_declaration=True)
print("provider injected")
PYCODE

log_step "Done"
