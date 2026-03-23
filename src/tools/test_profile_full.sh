#!/usr/bin/env bash
set -euo pipefail

SERIAL="${1:-emulator-5554}"

python3 src/build-orchestrator/orchestrator.py pre-cache
python3 src/build-orchestrator/orchestrator.py test --serial "$SERIAL"
