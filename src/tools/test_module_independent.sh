#!/usr/bin/env bash
set -euo pipefail

SERIAL="${1:-emulator-5554}"

python3 src/cache-manager/orchestrator.py profile sigbypass-only pre-cache
python3 src/cache-manager/orchestrator.py profile sigbypass-only test --smoke --serial "$SERIAL"
python3 src/cache-manager/orchestrator.py profile https-only pre-cache
python3 src/cache-manager/orchestrator.py profile https-only test --smoke --serial "$SERIAL"
python3 src/cache-manager/orchestrator.py profile phonepehelper-only pre-cache
python3 src/cache-manager/orchestrator.py profile phonepehelper-only test --smoke --serial "$SERIAL"
