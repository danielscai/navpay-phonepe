#!/usr/bin/env bash
set -euo pipefail

OUTPUT_ROOT="artifacts/runs"
SERIAL="${SERIAL:-emulator-5554}"
RUN_ADB_GATES="${RUN_ADB_GATES:-0}"

usage() {
    cat <<'USAGE'
Collect validation evidence into a timestamped run directory.

Usage:
  collect_validation_evidence.sh [--output-root <dir>] [--serial <device-serial>] [--run-adb-gates]

Options:
  --output-root <dir>   Evidence root directory (default: artifacts/runs)
  --serial <serial>     adb serial for device/emulator (default: emulator-5554)
  --run-adb-gates       Also run adb-dependent commands (Gate B/C/D/E skeleton)
  -h, --help            Show this help and exit

Outputs:
  <output-root>/<timestamp>/
    - commands.log
    - logs/*.log
USAGE
}

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
        --output-root)
            require_arg_value "$1" "${2:-}"
            OUTPUT_ROOT="$2"
            shift 2
            ;;
        --serial)
            require_arg_value "$1" "${2:-}"
            SERIAL="$2"
            shift 2
            ;;
        --run-adb-gates)
            RUN_ADB_GATES="1"
            shift
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

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="$OUTPUT_ROOT/$TIMESTAMP"
LOG_DIR="$RUN_DIR/logs"
COMMAND_LOG="$RUN_DIR/commands.log"

mkdir -p "$LOG_DIR"
touch "$COMMAND_LOG"

run_logged() {
    local name="$1"
    shift
    local log_path="$LOG_DIR/$name.log"
    local cmd=( "$@" )

    {
        printf '[%s] STEP: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name"
        printf '[%s] CMD: ' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        printf '%q ' "${cmd[@]}"
        printf '\n'
    } | tee -a "$COMMAND_LOG"

    "${cmd[@]}" >"$log_path" 2>&1

    {
        printf '[%s] LOG: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$log_path"
        printf '\n'
    } | tee -a "$COMMAND_LOG"
}

record_only() {
    local name="$1"
    shift
    local cmd=( "$@" )
    local log_path="$LOG_DIR/$name.log"
    {
        printf '[%s] STEP: %s (manual)\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name"
        printf '[%s] CMD: ' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        printf '%q ' "${cmd[@]}"
        printf '\n'
        printf '[%s] NOTE: fill required args/env and run manually.\n\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } | tee -a "$COMMAND_LOG" >"$log_path"
}

run_logged "gate_a_cli_contract" python3 -m unittest src/orch/tests/test_cli_contract.py -v
run_logged "gate_a_all_tests" python3 -m unittest discover -s src/orch/tests -p 'test_*.py' -v
run_logged "gate_a_plan" python3 src/orch/orchestrator.py plan

if [ "$RUN_ADB_GATES" = "1" ]; then
    run_logged "gate_b_test_independent" yarn test:independent "$SERIAL"
    run_logged "gate_c_test_full" yarn test:full "$SERIAL"
    record_only "gate_d_probe_baseline" yarn probe:baseline -- --package com.phonepe.app
    record_only "gate_d_probe_candidate" yarn probe:candidate -- --package com.phonepe.app
    record_only "gate_d_probe_compare" yarn probe:compare -- --baseline '<baseline_run_dir>' --candidate '<candidate_run_dir>'
    record_only "gate_e_baseline_archive" yarn baseline:archive --apk '<baseline.apk>'
    record_only "gate_e_candidate_archive" yarn artifact:archive -- --apk '<candidate.apk>' --label candidate
fi

echo "Validation evidence directory: $RUN_DIR"
echo "Command log: $COMMAND_LOG"
