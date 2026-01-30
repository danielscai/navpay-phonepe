#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TASK_DIR="$ROOT_DIR/src/https_interceptor"
APK_PATH="$TASK_DIR/app/build/outputs/apk/debug/app-debug.apk"
PACKAGE_NAME="com.httpinterceptor"
ACTIVITY_NAME=".MainActivity"
DEVICE_SERIAL=""
DO_BUILD=false
DO_INSTALL=false
DO_RUN=false
DO_LOGS=false

usage() {
  cat <<'USAGE'
Usage: tools/step4_test_https_interceptor.sh [options]

Options:
  --build     Build the debug APK (Gradle)
  --install   Install APK to connected device/emulator
  --run       Launch the app after install
  --logs      Tail logcat for interceptors
  -s <serial> Select adb device/emulator serial

Examples:
  ./tools/step4_test_https_interceptor.sh --build
  ./tools/step4_test_https_interceptor.sh --build --install --run -s emulator-5554
USAGE
}

if [ $# -eq 0 ]; then
  usage
  exit 0
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --build)
      DO_BUILD=true
      shift
      ;;
    --install)
      DO_INSTALL=true
      shift
      ;;
    --run)
      DO_RUN=true
      shift
      ;;
    --logs)
      DO_LOGS=true
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
      echo "[FAIL] Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

if ! command -v adb >/dev/null 2>&1; then
  echo "[FAIL] adb not found"
  exit 1
fi

select_device() {
  if [ -n "$DEVICE_SERIAL" ]; then
    return
  fi
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
}

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk}"
export PATH="$JAVA_HOME/bin:$PATH"

build() {
  if [ ! -x "$TASK_DIR/build_and_install.sh" ]; then
    echo "[FAIL] Missing script: $TASK_DIR/build_and_install.sh"
    exit 1
  fi
  (cd "$TASK_DIR" && ./build_and_install.sh build)
  if [ ! -f "$APK_PATH" ]; then
    echo "[FAIL] APK not found after build: $APK_PATH"
    exit 1
  fi
  echo "[OK] Build output: $APK_PATH"
}

install() {
  select_device
  if [ ! -f "$APK_PATH" ]; then
    echo "[FAIL] APK not found: $APK_PATH (build first)"
    exit 1
  fi
  adb -s "$DEVICE_SERIAL" install -r "$APK_PATH"
  echo "[OK] Installed on $DEVICE_SERIAL"
}

run_app() {
  select_device
  adb -s "$DEVICE_SERIAL" shell am start -n "$PACKAGE_NAME/$ACTIVITY_NAME"
  echo "[OK] Launched $PACKAGE_NAME on $DEVICE_SERIAL"
}

logs() {
  select_device
  adb -s "$DEVICE_SERIAL" logcat -s HttpInterceptor TokenInterceptor CertBypass
}

$DO_BUILD && build
$DO_INSTALL && install
$DO_RUN && run_app
$DO_LOGS && logs
