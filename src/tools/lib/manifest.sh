#!/bin/bash

set -euo pipefail

manifest_path() {
    local target_dir="$1"
    echo "$target_dir/assets/inject_manifest.json"
}

manifest_has() {
    local target_dir="$1"
    local module_id="$2"
    local manifest
    manifest=$(manifest_path "$target_dir")

    if [ ! -f "$manifest" ]; then
        return 1
    fi

    python3 - <<PY "$manifest" "$module_id"
import json, sys
path, key = sys.argv[1], sys.argv[2]
try:
    data = json.load(open(path, 'r', encoding='utf-8'))
    print(data.get('modules', {}).get(key, ''))
except Exception:
    sys.exit(2)
PY
}

manifest_add() {
    local target_dir="$1"
    local module_id="$2"
    local module_version="$3"
    local manifest
    manifest=$(manifest_path "$target_dir")

    mkdir -p "$(dirname "$manifest")"

    python3 - <<PY "$manifest" "$module_id" "$module_version"
import json, sys
path, key, version = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
except Exception:
    data = {}
modules = data.get('modules')
if not isinstance(modules, dict):
    modules = {}
modules[key] = version
if 'modules' not in data:
    data['modules'] = modules
else:
    data['modules'] = modules
with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=True, indent=2, sort_keys=True)
PY
}
