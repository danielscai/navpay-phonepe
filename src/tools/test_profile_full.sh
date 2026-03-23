#!/usr/bin/env bash
set -euo pipefail

SERIAL="${1:-emulator-5554}"

exec python3 src/build-orchestrator/orchestrator.py test --serial "$SERIAL"
