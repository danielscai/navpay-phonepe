#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT_DIR/cache/profiles/full/build"
DST_DIR="$ROOT_DIR/cache/release"

FILES=(
  "patched_signed.apk"
  "split_config.xxhdpi.apk"
  "split_config.arm64_v8a.apk"
)

for file in "${FILES[@]}"; do
  if [[ ! -f "$SRC_DIR/$file" ]]; then
    echo "missing artifact: $SRC_DIR/$file" >&2
    exit 1
  fi
done

rm -rf "$DST_DIR"
mkdir -p "$DST_DIR"

for file in "${FILES[@]}"; do
  cp "$SRC_DIR/$file" "$DST_DIR/$file"
done

echo "release artifacts cached in: $DST_DIR"
