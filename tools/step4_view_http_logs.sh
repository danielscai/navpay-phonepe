#!/bin/bash

set -euo pipefail

PACKAGE_NAME="com.phonepe.app"
MODE="app"
TAG=""
DEVICE_SERIAL=""

usage() {
  cat <<'USAGE'
Usage: tools/step4_view_http_logs.sh [app|sigbypass|https|pehelp] [-s <serial>]

默认显示 app 的所有日志（按 PID 过滤）
指定模式：
  app        显示 app 全部日志（默认）
  sigbypass  仅显示 SigBypass 日志
  https      仅显示 HttpInterceptor 日志
  pehelp     仅显示 PPHelper 日志
如需指定设备，传 -s <serial>
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    app|sigbypass|https|pehelp)
      MODE="$1"
      shift
      ;;
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

case "$MODE" in
  app)
    pid=$(adb -s "$DEVICE_SERIAL" shell pidof -s "$PACKAGE_NAME" 2>/dev/null | tr -d '\r')
    if [ -n "$pid" ]; then
      echo "[INFO] Showing logs by PID: $pid ($PACKAGE_NAME)"
      exec adb -s "$DEVICE_SERIAL" logcat --pid="$pid"
    else
      echo "[WARN] No PID found for $PACKAGE_NAME. Showing full logcat."
      exec adb -s "$DEVICE_SERIAL" logcat
    fi
    ;;
  sigbypass)
    TAG="SigBypass"
    echo "[INFO] Showing logs by tag: $TAG"
    exec adb -s "$DEVICE_SERIAL" logcat -s "$TAG"
    ;;
  https)
    TAG="HttpInterceptor"
    echo "[INFO] Showing logs by tag: $TAG"
    exec adb -s "$DEVICE_SERIAL" logcat -s "$TAG"
    ;;
  pehelp)
    TAG="PPHelper"
    echo "[INFO] Showing logs by tag: $TAG"
    exec adb -s "$DEVICE_SERIAL" logcat -s "$TAG"
    ;;
  *)
    echo "[FAIL] Unknown mode: $MODE"
    usage
    exit 1
    ;;
esac
