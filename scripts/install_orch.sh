#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="$HOME/.local/bin"
if [[ "${1:-}" == "--global" ]]; then
  TARGET_DIR="/usr/local/bin"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER_SRC="$SCRIPT_DIR/orch"
TARGET_PATH="$TARGET_DIR/orch"

if [[ ! -f "$LAUNCHER_SRC" ]]; then
  echo "[FAIL] missing launcher: $LAUNCHER_SRC" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
ln -sfn "$LAUNCHER_SRC" "$TARGET_PATH"

echo "[INFO] installed orch -> $TARGET_PATH"
if [[ "$TARGET_DIR" == "$HOME/.local/bin" ]]; then
  echo "[INFO] ensure ~/.local/bin is in PATH"
fi
