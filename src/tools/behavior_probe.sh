#!/bin/bash

set -euo pipefail

usage() {
    cat <<'USAGE'
Run behavior probe against an APK or an installed package.

Usage:
  behavior_probe.sh --apk <path.apk> --package <name> [options]
  behavior_probe.sh --package <name> [options]

Modes:
  --apk <path>         APK mode (install optional, launch optional)
  --package <name>     Installed package mode (required if launching)

Options:
  --serial <id>        adb serial (optional)
  --output <dir>       Output directory (default: artifacts/runs/<timestamp>)
  --activity <cmp>     Explicit launch component, e.g. com.foo/.MainActivity
  --no-install         Skip install in APK mode
  --no-launch          Skip app launch
  --wait-seconds <n>   Seconds to wait before dumping logs (default: 8)
  -h, --help           Show this help and exit

Outputs:
  <output>/probe.log
  <output>/probe.json
  Note: --output can point to a directory created by archive_apk.sh.
USAGE
}

APK_PATH=""
PACKAGE_NAME=""
SERIAL=""
OUTPUT_DIR=""
ACTIVITY_COMPONENT=""
DO_INSTALL=1
DO_LAUNCH=1
WAIT_SECONDS=8

require_arg_value() {
    local flag="$1"
    if [ "$#" -lt 2 ]; then
        echo "Missing value for $flag" >&2
        exit 1
    fi
    if [ -z "${2:-}" ] || [ "${2#--}" != "$2" ]; then
        echo "Missing value for $flag" >&2
        exit 1
    fi
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --apk)
            require_arg_value "$1" "${2:-}"
            APK_PATH="$2"
            shift 2
            ;;
        --package)
            require_arg_value "$1" "${2:-}"
            PACKAGE_NAME="$2"
            shift 2
            ;;
        --serial)
            require_arg_value "$1" "${2:-}"
            SERIAL="$2"
            shift 2
            ;;
        --output)
            require_arg_value "$1" "${2:-}"
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --activity)
            require_arg_value "$1" "${2:-}"
            ACTIVITY_COMPONENT="$2"
            shift 2
            ;;
        --no-install)
            DO_INSTALL=0
            shift
            ;;
        --no-launch)
            DO_LAUNCH=0
            shift
            ;;
        --wait-seconds)
            require_arg_value "$1" "${2:-}"
            WAIT_SECONDS="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            usage
            exit 1
            ;;
    esac
done

if [ -z "$APK_PATH" ] && [ -z "$PACKAGE_NAME" ]; then
    echo "Either --apk or --package is required" >&2
    usage
    exit 1
fi

if [ -n "$APK_PATH" ] && [ ! -f "$APK_PATH" ]; then
    echo "APK not found: $APK_PATH" >&2
    exit 1
fi

if [[ ! "$WAIT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
    echo "Invalid --wait-seconds: $WAIT_SECONDS (must be a positive integer)" >&2
    exit 1
fi

if ! command -v adb >/dev/null 2>&1; then
    echo "Command not found: adb" >&2
    exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "Command not found: python3" >&2
    exit 1
fi

if [ -z "$OUTPUT_DIR" ]; then
    OUTPUT_DIR="artifacts/runs/$(date -u +%Y%m%dT%H%M%SZ)"
fi
mkdir -p "$OUTPUT_DIR"

ADB=(adb)
if [ -n "$SERIAL" ]; then
    ADB+=( -s "$SERIAL" )
fi

if [ -n "$APK_PATH" ] && [ "$DO_INSTALL" -eq 1 ]; then
    echo "Installing APK: $APK_PATH"
    "${ADB[@]}" install -r "$APK_PATH"
fi

"${ADB[@]}" logcat -c || true
"${ADB[@]}" logcat -b crash -c || true

LAUNCH_CMD=""
LAUNCH_OUTPUT=""
LAUNCH_EXIT_CODE=0
if [ "$DO_LAUNCH" -eq 1 ]; then
    if [ -n "$ACTIVITY_COMPONENT" ]; then
        LAUNCH_CMD="am start -n $ACTIVITY_COMPONENT"
        set +e
        LAUNCH_OUTPUT="$("${ADB[@]}" shell am start -n "$ACTIVITY_COMPONENT" 2>&1)"
        LAUNCH_EXIT_CODE=$?
        set -e
    else
        if [ -z "$PACKAGE_NAME" ]; then
            echo "--package is required when launch is enabled without --activity" >&2
            exit 1
        fi
        LAUNCH_CMD="monkey -p $PACKAGE_NAME -c android.intent.category.LAUNCHER 1"
        set +e
        LAUNCH_OUTPUT="$("${ADB[@]}" shell monkey -p "$PACKAGE_NAME" -c android.intent.category.LAUNCHER 1 2>&1)"
        LAUNCH_EXIT_CODE=$?
        set -e
    fi
fi

sleep "$WAIT_SECONDS"

PROBE_LOG="$OUTPUT_DIR/probe.log"
CRASH_LOG="$OUTPUT_DIR/crash.log"
PROBE_JSON="$OUTPUT_DIR/probe.json"

{
    echo "=== LAUNCH RESULT ==="
    echo "launch_cmd: $LAUNCH_CMD"
    echo "launch_exit_code: $LAUNCH_EXIT_CODE"
    if [ -n "$LAUNCH_OUTPUT" ]; then
        echo "$LAUNCH_OUTPUT"
    fi
    echo
    echo "=== TAGGED LOGS (SigBypass/HttpInterceptor/PPHelper) ==="
    "${ADB[@]}" logcat -d -v threadtime -s SigBypass HttpInterceptor PPHelper '*:S' || true
    echo
    echo "=== CRASH BUFFER ==="
    "${ADB[@]}" logcat -d -b crash -v threadtime || true
} > "$PROBE_LOG"

"${ADB[@]}" logcat -d -b crash -v threadtime > "$CRASH_LOG" || true

SIG_COUNT="$(grep -c 'SigBypass' "$PROBE_LOG" || true)"
HTTP_COUNT="$(grep -c 'HttpInterceptor' "$PROBE_LOG" || true)"
PPHELPER_COUNT="$(grep -c 'PPHelper' "$PROBE_LOG" || true)"
LOGIN_ACTIVITY_COUNT="$(grep -c -E 'LoginActivity|LoginAct|login_activity' "$PROBE_LOG" || true)"
CRASH_LINES="$(grep -c '.' "$CRASH_LOG" || true)"
FATAL_COUNT="$(grep -c -E 'FATAL EXCEPTION|AndroidRuntime|SIGABRT|SIGSEGV|CRASH' "$CRASH_LOG" || true)"
HAS_CRASH=false
if [ "$FATAL_COUNT" -gt 0 ]; then
    HAS_CRASH=true
fi

MODE="installed"
if [ -n "$APK_PATH" ]; then
    MODE="apk"
fi

INSTALL_ENABLED=false
if [ "$DO_INSTALL" -eq 1 ]; then
    INSTALL_ENABLED=true
fi

LAUNCH_ENABLED=false
if [ "$DO_LAUNCH" -eq 1 ]; then
    LAUNCH_ENABLED=true
fi

LAUNCH_OK=false
if [ "$DO_LAUNCH" -eq 1 ] && [ "$LAUNCH_EXIT_CODE" -eq 0 ]; then
    LAUNCH_OK=true
    if echo "$LAUNCH_OUTPUT" | grep -Eiq 'Error:|Exception|No activities found|monkey aborted|SecurityException|Permission Denial|does not exist|inaccessible|FAILED'; then
        LAUNCH_OK=false
    fi
fi

LOGIN_ACTIVITY_SEEN=false
if [ "$LOGIN_ACTIVITY_COUNT" -gt 0 ]; then
    LOGIN_ACTIVITY_SEEN=true
fi

SIGBYPASS_TAG=false
if [ "$SIG_COUNT" -gt 0 ]; then
    SIGBYPASS_TAG=true
fi

HTTPS_TAG=false
if [ "$HTTP_COUNT" -gt 0 ]; then
    HTTPS_TAG=true
fi

PPHELPER_TAG=false
if [ "$PPHELPER_COUNT" -gt 0 ]; then
    PPHELPER_TAG=true
fi

python3 - \
    "$PROBE_JSON" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$MODE" \
    "$APK_PATH" \
    "$PACKAGE_NAME" \
    "$SERIAL" \
    "$INSTALL_ENABLED" \
    "$LAUNCH_ENABLED" \
    "$LAUNCH_CMD" \
    "$WAIT_SECONDS" \
    "$SIG_COUNT" \
    "$HTTP_COUNT" \
    "$PPHELPER_COUNT" \
    "$LAUNCH_OK" \
    "$LOGIN_ACTIVITY_SEEN" \
    "$SIGBYPASS_TAG" \
    "$HTTPS_TAG" \
    "$PPHELPER_TAG" \
    "$HAS_CRASH" \
    "$FATAL_COUNT" \
    "$CRASH_LINES" <<'PY'
import json
import sys
from pathlib import Path

probe_path = Path(sys.argv[1])
data = {
    "timestamp_utc": sys.argv[2],
    "mode": sys.argv[3],
    "apk_path": sys.argv[4],
    "package": sys.argv[5],
    "serial": sys.argv[6],
    "install_enabled": sys.argv[7] == "true",
    "launch_enabled": sys.argv[8] == "true",
    "launch_command": sys.argv[9],
    "wait_seconds": int(sys.argv[10]),
    "launch_ok": sys.argv[14] == "true",
    "login_activity_seen": sys.argv[15] == "true",
    "sigbypass_tag": sys.argv[16] == "true",
    "https_tag": sys.argv[17] == "true",
    "pphelper_tag": sys.argv[18] == "true",
    "crash_detected": sys.argv[19] == "true",
    "tag_counts": {
        "SigBypass": int(sys.argv[11]),
        "HttpInterceptor": int(sys.argv[12]),
        "PPHelper": int(sys.argv[13]),
    },
    "crash": {
        "has_crash": sys.argv[19] == "true",
        "fatal_count": int(sys.argv[20]),
        "crash_log_lines": int(sys.argv[21]),
    },
    "probe_log": "probe.log",
}
probe_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

echo "Probe outputs: $PROBE_LOG, $PROBE_JSON"
