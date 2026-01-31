#!/bin/bash

set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$TOOLS_DIR/.." && pwd)"
LIB_DIR="$TOOLS_DIR/lib"

source "$LIB_DIR/env.sh"
source "$LIB_DIR/manifest.sh"

usage() {
    cat <<USAGE
Usage:
  $0 --decompiled <dir> --module <name>
  $0 --decompiled <dir> --modules <name1,name2>

Examples:
  $0 --decompiled /path/to/decompiled/base --module signature_bypass
USAGE
}

TARGET_DIR=""
MODULES_CSV=""

while [ "$#" -gt 0 ]; do
    case "$1" in
        --decompiled)
            TARGET_DIR="$2"; shift 2 ;;
        --module)
            MODULES_CSV="$2"; shift 2 ;;
        --modules)
            MODULES_CSV="$2"; shift 2 ;;
        -h|--help)
            usage; exit 0 ;;
        *)
            log_error "Unknown argument: $1"; usage; exit 1 ;;
    esac
done

if [ -z "$TARGET_DIR" ] || [ -z "$MODULES_CSV" ]; then
    usage
    exit 1
fi

if [ ! -d "$TARGET_DIR" ]; then
    log_error "Target dir not found: $TARGET_DIR"
    exit 1
fi

IFS=',' read -r -a MODULES <<< "$MODULES_CSV"

# Determine target smali dir for this injection batch
LAST_SMALI=$(ls -d "$TARGET_DIR"/smali_classes* 2>/dev/null | sort -V | tail -1 || true)
if [ -z "$LAST_SMALI" ]; then
    INJECT_SMALI_DIR="$TARGET_DIR/smali_classes2"
else
    NUM=$(echo "$LAST_SMALI" | grep -o '[0-9]*$' || true)
    if [ -z "$NUM" ]; then
        NUM=1
    fi
    INJECT_SMALI_DIR="$TARGET_DIR/smali_classes$((NUM + 1))"
fi

mkdir -p "$INJECT_SMALI_DIR"
export INJECT_SMALI_DIR

log_step "Inject Dispatcher Entry"
# Locate Application smali (PhonePe)
APP_SMALI=$(find "$TARGET_DIR" -name "PhonePeApplication.smali" -path "*/com/phonepe/app/*" | head -1 || true)
if [ -z "$APP_SMALI" ]; then
    log_error "PhonePeApplication.smali not found in target"
    exit 1
fi

python3 "$ROOT_DIR/_framework/dispatcher/scripts/inject_entry.py" "$APP_SMALI"

log_step "Inject Modules"
MODULE_ENTRIES=()
for module in "${MODULES[@]}"; do
    module_dir="$ROOT_DIR/$module"
    module_yaml="$module_dir/module.yaml"
    if [ ! -f "$module_yaml" ]; then
        log_error "module.yaml not found: $module_yaml"
        exit 1
    fi

    module_id=$(awk -F': *' '/^id:/{print $2}' "$module_yaml" | head -1)
    module_version=$(awk -F': *' '/^version:/{print $2}' "$module_yaml" | head -1)
    module_entry=$(awk -F': *' '/^entry:/{print $2}' "$module_yaml" | head -1)
    module_inject=$(awk -F': *' '/^inject:/{print $2}' "$module_yaml" | head -1)

    if [ -z "$module_id" ] || [ -z "$module_version" ] || [ -z "$module_entry" ]; then
        log_error "Invalid module.yaml: $module_yaml"
        exit 1
    fi

    existing_version=$(manifest_has "$TARGET_DIR" "$module_id" || true)
    if [ -n "$existing_version" ] && [ "$existing_version" = "$module_version" ]; then
        log_warn "Module already injected ($module_id@$module_version), skipping reinject"
        MODULE_ENTRIES+=("$module_entry")
        continue
    fi

    if [ -z "$module_inject" ]; then
        module_inject="scripts/inject.sh"
    fi

    inject_path="$module_dir/$module_inject"
    if [ ! -x "$inject_path" ]; then
        log_error "Module inject script not found or not executable: $inject_path"
        exit 1
    fi

    log_info "Injecting module: $module_id@$module_version"
    "$inject_path" "$TARGET_DIR"

    manifest_add "$TARGET_DIR" "$module_id" "$module_version"
    MODULE_ENTRIES+=("$module_entry")

    log_info "Module injected: $module_id"

    if [ -n "$existing_version" ] && [ "$existing_version" != "$module_version" ]; then
        log_warn "Module version updated: $module_id $existing_version -> $module_version"
    fi

done

if [ "${#MODULE_ENTRIES[@]}" -eq 0 ]; then
    log_warn "No new modules injected; dispatcher will still be written for current batch"
fi

log_step "Write Dispatcher"
"$LIB_DIR/dispatcher.sh" "${MODULE_ENTRIES[@]}"

log_step "Done"
log_info "Injected smali dir: $INJECT_SMALI_DIR"
log_info "Updated manifest: $(manifest_path "$TARGET_DIR")"
