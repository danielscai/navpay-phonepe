#!/usr/bin/env bash
set -euo pipefail

target="${1:-5554}"

if [[ "$target" =~ ^[0-9]+$ ]]; then
  serial="emulator-$target"
else
  serial="$target"
fi

echo "[ins] target serial: $serial"
yarn orch test --smoke --install-mode clean --serial "$serial"
