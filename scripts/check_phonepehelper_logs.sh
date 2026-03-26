#!/bin/bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <log-file> [checklist-file]" >&2
  exit 2
fi

LOG_FILE="$1"
CHECKLIST_FILE="${2:-/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/cache/verification/phonepehelper/checklist.txt}"

if [ ! -f "$LOG_FILE" ]; then
  echo "log file not found: $LOG_FILE" >&2
  exit 2
fi

if [ ! -f "$CHECKLIST_FILE" ]; then
  echo "checklist file not found: $CHECKLIST_FILE" >&2
  exit 2
fi

missing=0
while IFS= read -r signature || [ -n "$signature" ]; do
  [ -z "$signature" ] && continue
  if grep -Fq "$signature" "$LOG_FILE"; then
    echo "[PASS] $signature"
  else
    echo "[MISS] $signature"
    missing=1
  fi
done < "$CHECKLIST_FILE"

if [ "$missing" -ne 0 ]; then
  echo "phonepehelper log gate: FAIL"
  exit 1
fi

echo "phonepehelper log gate: PASS"
