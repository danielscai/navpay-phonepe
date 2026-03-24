#!/usr/bin/env bash
set -euo pipefail

SERIAL="${1:-emulator-5554}"

python3 src/orch/orchestrator.py test --profile sigbypass-only --smoke --serial "$SERIAL"
python3 src/orch/orchestrator.py test --profile https-only --smoke --serial "$SERIAL"
exec python3 src/orch/orchestrator.py test --profile phonepehelper-only --smoke --serial "$SERIAL"
