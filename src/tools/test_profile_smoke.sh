#!/usr/bin/env bash
set -euo pipefail

PROFILE_NAME="${1:-full}"
SERIAL="${2:-}"

CMD=(python3 src/cache-manager/cache_manager.py profile "$PROFILE_NAME" test --smoke)
if [ -n "$SERIAL" ]; then
  CMD+=(--serial "$SERIAL")
fi

"${CMD[@]}"
