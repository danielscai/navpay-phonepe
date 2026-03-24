#!/bin/bash

set -euo pipefail

usage() {
    cat <<'USAGE'
Compare behavior probe results between baseline and candidate.

Usage:
  compare_behavior.sh --baseline <probe.json|dir> --candidate <probe.json|dir>

Options:
  --baseline <path>    Baseline probe.json file or directory containing probe.json
  --candidate <path>   Candidate probe.json file or directory containing probe.json
  -h, --help           Show this help and exit

Exit code:
  0 if key behavior fields match
  non-zero if mismatched or invalid input
USAGE
}

BASELINE_INPUT=""
CANDIDATE_INPUT=""

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
        --baseline)
            require_arg_value "$1" "${2:-}"
            BASELINE_INPUT="$2"
            shift 2
            ;;
        --candidate)
            require_arg_value "$1" "${2:-}"
            CANDIDATE_INPUT="$2"
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

if [ -z "$BASELINE_INPUT" ] || [ -z "$CANDIDATE_INPUT" ]; then
    usage
    exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "Command not found: python3" >&2
    exit 1
fi

python3 - "$BASELINE_INPUT" "$CANDIDATE_INPUT" <<'PY'
import json
import sys
from pathlib import Path


def resolve_probe(path_text: str) -> Path:
    p = Path(path_text)
    if p.is_dir():
        p = p / "probe.json"
    if not p.is_file():
        raise FileNotFoundError(f"probe.json not found: {p}")
    return p


def get_value(obj, dotted_key: str):
    cur = obj
    for part in dotted_key.split('.'):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


MANDATORY_KEYS = [
    "launch_ok",
    "login_activity_seen",
    "sigbypass_tag",
    "https_tag",
    "pphelper_tag",
    "crash_detected",
]


def validate_probe_schema(label: str, payload: dict) -> None:
    missing = [key for key in MANDATORY_KEYS if key not in payload]
    if missing:
        raise ValueError(
            f"{label} probe missing mandatory keys: {', '.join(missing)}"
        )

    invalid_types = [
        key for key in MANDATORY_KEYS if not isinstance(payload.get(key), bool)
    ]
    if invalid_types:
        raise TypeError(
            f"{label} probe mandatory keys must be boolean: {', '.join(invalid_types)}"
        )


try:
    baseline_path = resolve_probe(sys.argv[1])
    candidate_path = resolve_probe(sys.argv[2])
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    candidate = json.loads(candidate_path.read_text(encoding="utf-8"))
    validate_probe_schema("baseline", baseline)
    validate_probe_schema("candidate", candidate)
except (FileNotFoundError, json.JSONDecodeError, ValueError, TypeError) as exc:
    print(f"Invalid probe input: {exc}")
    sys.exit(2)

key_fields = [
    "package",
    *MANDATORY_KEYS,
]

mismatches = []
for field in key_fields:
    left = get_value(baseline, field)
    right = get_value(candidate, field)
    if left != right:
        mismatches.append((field, left, right))

if mismatches:
    print("Behavior mismatch detected:")
    for field, left, right in mismatches:
        print(f"- {field}: baseline={left!r}, candidate={right!r}")
    sys.exit(2)

print("Behavior key fields match.")
PY
