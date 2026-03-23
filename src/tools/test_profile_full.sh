#!/usr/bin/env bash
set -euo pipefail

SERIAL="${1:-emulator-5554}"

python3 src/cache-manager/orchestrator.py profile full pre-cache
python3 src/cache-manager/orchestrator.py profile full test --serial "$SERIAL"
