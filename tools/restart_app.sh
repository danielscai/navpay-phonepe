#!/bin/bash

set -euo pipefail

PACKAGE_NAME="com.phonepe.app"
ACTIVITY_NAME=".launch.core.main.ui.MainActivity"
DEVICE_SERIAL=""

usage() {
  cat <<'USAGE'
Usage: tools/restart_app.sh [-s <serial>]

默认重启 com.phonepe.app
如需指定设备，传 -s <serial>
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    -s)
      DEVICE_SERIAL="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[FAIL] Unknown arg: $1"
      usage
      exit 1
      ;;
  esac
done

if ! command -v adb >/dev/null 2>&1; then
  echo "[FAIL] adb not found"
  exit 1
fi

if [ -z "$DEVICE_SERIAL" ]; then
  devices=$(adb devices | grep -v "List" | awk '$2=="device" {print $1}')
  count=$(echo "$devices" | grep -c . || true)
  if [ "$count" -eq 0 ]; then
    echo "[FAIL] No adb devices found"
    exit 1
  elif [ "$count" -eq 1 ]; then
    DEVICE_SERIAL="$devices"
  else
    echo "[FAIL] Multiple devices found. Please specify -s <serial>."
    echo "$devices"
    exit 1
  fi
fi

echo "[INFO] Using device: $DEVICE_SERIAL"
echo "[INFO] Force-stop $PACKAGE_NAME"
adb -s "$DEVICE_SERIAL" shell am force-stop "$PACKAGE_NAME" >/dev/null
echo "[INFO] Start $PACKAGE_NAME/$ACTIVITY_NAME"
adb -s "$DEVICE_SERIAL" shell am start -n "$PACKAGE_NAME/$ACTIVITY_NAME" >/dev/null
echo "[PASS] App restarted"
