#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TASK0_DIR="$ROOT_DIR/src/signature_bypass"
TASK1_DIR="$ROOT_DIR/src/https_interceptor"
LOG_SERVER_DIR="$ROOT_DIR/src/log_server"

usage() {
  cat <<'USAGE'
Usage: tools/verify_task_0_1.sh [options]

Options:
  --run-task0            Run signature bypass compile (rebuilds build/)
  --merge <path>         Run merge.sh against a decompiled APK base dir
  --run-task1-build      Build HTTPS interceptor APK (Gradle)
  --run-task1-install    Install HTTPS interceptor APK (adb, requires device)
  --run-log-server       Start log server (blocks until Ctrl+C)
  -h, --help             Show this help

Notes:
- Task0 compile requires Android SDK build-tools and android.jar.
- Task1 build/install requires Android SDK, adb, and Gradle deps download.
- Merge requires a valid decompiled APK base dir (apktool output).
USAGE
}

check_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[WARN] Missing command: $cmd"
    return 1
  fi
  echo "[OK] $cmd: $(command -v "$cmd")"
}

check_android_sdk() {
  local sdk="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  if [ ! -d "$sdk" ]; then
    echo "[WARN] Android SDK not found at $sdk"
    return 1
  fi
  echo "[OK] Android SDK: $sdk"

  if [ -f "$sdk/build-tools/35.0.0/d8" ]; then
    echo "[OK] d8: $sdk/build-tools/35.0.0/d8"
  else
    echo "[WARN] d8 not found at $sdk/build-tools/35.0.0/d8"
  fi

  local jar
  jar=$(ls -d "$sdk/platforms/android-"* 2>/dev/null | sort -V | tail -1 || true)
  if [ -n "$jar" ] && [ -f "$jar/android.jar" ]; then
    echo "[OK] android.jar: $jar/android.jar"
  else
    echo "[WARN] android.jar not found under $sdk/platforms"
  fi
}

preflight() {
  echo "=== Preflight ==="
  check_cmd javac || true
  check_cmd adb || true
  check_cmd node || true
  check_cmd npm || true
  check_cmd apktool || true
  check_cmd jadx || true
  check_cmd gradle || true
  check_android_sdk || true
  echo ""
}

run_task0() {
  echo "=== Task0: signature_bypass compile ==="
  if [ ! -x "$TASK0_DIR/scripts/compile.sh" ]; then
    echo "[ERROR] Missing script: $TASK0_DIR/scripts/compile.sh"
    exit 1
  fi
  (cd "$TASK0_DIR" && ./scripts/compile.sh)
}

run_merge() {
  local target="$1"
  echo "=== Task0: merge into decompiled APK ==="
  if [ ! -x "$TASK0_DIR/scripts/merge.sh" ]; then
    echo "[ERROR] Missing script: $TASK0_DIR/scripts/merge.sh"
    exit 1
  fi
  if [ ! -d "$target" ]; then
    echo "[ERROR] Target dir not found: $target"
    exit 1
  fi
  (cd "$TASK0_DIR" && ./scripts/merge.sh "$target")
}

run_task1_build() {
  echo "=== Task1: https_interceptor build ==="
  if [ ! -x "$TASK1_DIR/build_and_install.sh" ]; then
    echo "[ERROR] Missing script: $TASK1_DIR/build_and_install.sh"
    exit 1
  fi
  (cd "$TASK1_DIR" && ./build_and_install.sh build)
}

run_task1_install() {
  echo "=== Task1: https_interceptor install ==="
  if [ ! -x "$TASK1_DIR/build_and_install.sh" ]; then
    echo "[ERROR] Missing script: $TASK1_DIR/build_and_install.sh"
    exit 1
  fi
  (cd "$TASK1_DIR" && ./build_and_install.sh install)
}

run_log_server() {
  echo "=== Log server ==="
  if [ ! -x "$LOG_SERVER_DIR/start.sh" ]; then
    echo "[ERROR] Missing script: $LOG_SERVER_DIR/start.sh"
    exit 1
  fi
  (cd "$LOG_SERVER_DIR" && ./start.sh)
}

if [ $# -eq 0 ]; then
  usage
  exit 0
fi

preflight

while [ $# -gt 0 ]; do
  case "$1" in
    --run-task0)
      run_task0
      shift
      ;;
    --merge)
      if [ $# -lt 2 ]; then
        echo "[ERROR] --merge requires a path"
        exit 1
      fi
      run_merge "$2"
      shift 2
      ;;
    --run-task1-build)
      run_task1_build
      shift
      ;;
    --run-task1-install)
      run_task1_install
      shift
      ;;
    --run-log-server)
      run_log_server
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[ERROR] Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done
