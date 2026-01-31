#!/bin/bash

set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$TOOLS_DIR/../.." && pwd)"

exec "$REPO_ROOT/tools/decompile.sh" "$@"
