#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SERVICE_DIR="${ROOT_DIR}/src/services/checksum"
PORT="${CHECKSUM_HTTP_PORT:-19190}"
RUN_DIR="${SERVICE_DIR}/run"
PID_FILE="${RUN_DIR}/checksum-http-${PORT}.pid"
BASE_URL="http://127.0.0.1:${PORT}"

if [[ -f "${PID_FILE}" ]]; then
  PID="$(cat "${PID_FILE}")"
  if [[ -n "${PID}" ]] && kill -0 "${PID}" >/dev/null 2>&1; then
    kill "${PID}" >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do
      if ! kill -0 "${PID}" >/dev/null 2>&1; then
        rm -f "${PID_FILE}"
        echo "checksum service stopped: pid ${PID}"
        exit 0
      fi
      sleep 1
    done
    kill -9 "${PID}" >/dev/null 2>&1 || true
    rm -f "${PID_FILE}"
    echo "checksum service force stopped: pid ${PID}"
    exit 0
  fi
  rm -f "${PID_FILE}"
fi

if curl -sS -m 2 "${BASE_URL}/health" >/dev/null 2>&1; then
  echo "service responds on ${BASE_URL}, but no managed pid file found" >&2
  exit 2
fi

echo "checksum service not running on ${BASE_URL}"
