#!/usr/bin/env bash
set -euo pipefail

SERIAL="${1:-emulator-5554}"

python3 src/build-orchestrator/orchestrator.py pre-cache --profile sigbypass-only
python3 src/build-orchestrator/orchestrator.py test --profile sigbypass-only --smoke --serial "$SERIAL"
python3 src/build-orchestrator/orchestrator.py pre-cache --profile https-only
python3 src/build-orchestrator/orchestrator.py test --profile https-only --smoke --serial "$SERIAL"
python3 src/build-orchestrator/orchestrator.py pre-cache --profile phonepehelper-only
python3 src/build-orchestrator/orchestrator.py test --profile phonepehelper-only --smoke --serial "$SERIAL"
