#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

exec python3 "${ROOT_DIR}/src/services/checksum/scripts/stress_test_checksum.py" "$@"
