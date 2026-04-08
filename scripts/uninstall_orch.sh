#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="$HOME/.local/bin"
if [[ "${1:-}" == "--global" ]]; then
  TARGET_DIR="/usr/local/bin"
fi

TARGET_PATH="$TARGET_DIR/orch"

if [[ -L "$TARGET_PATH" || -f "$TARGET_PATH" ]]; then
  rm -f "$TARGET_PATH"
  echo "[INFO] removed $TARGET_PATH"
else
  echo "[INFO] no orch binary at $TARGET_PATH"
fi
