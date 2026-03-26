#!/usr/bin/env bash
set -euo pipefail

SERIAL="${1:-}"

CMD=(python3 src/pipeline/orch/orchestrator.py test --smoke)
if [ -n "$SERIAL" ]; then
  CMD+=(--serial "$SERIAL")
fi

exec "${CMD[@]}"
