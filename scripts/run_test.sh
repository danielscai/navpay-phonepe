#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == scripts/__tests__/*.test.ts ]]; then
  node --import tsx --test "$@"
else
  yarn orch test "$@"
fi
