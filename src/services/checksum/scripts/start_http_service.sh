#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SERVICE_DIR="${ROOT_DIR}/src/services/checksum"
PORT="${CHECKSUM_HTTP_PORT:-19190}"
RUNTIME_DIR="${PROBE_RUNTIME_ROOT:-${SERVICE_DIR}/runtime}"
ARTIFACT_PATH="${CHECKSUM_ARTIFACT_PATH:-${SERVICE_DIR}/target/checksum-service.jar}"
RUN_DIR="${SERVICE_DIR}/run"
PID_FILE="${RUN_DIR}/checksum-http-${PORT}.pid"
LOG_FILE="${RUN_DIR}/checksum-http-${PORT}.log"

if [[ ! -f "${RUNTIME_DIR}/manifest.json" ]]; then
  echo "missing runtime manifest: ${RUNTIME_DIR}/manifest.json" >&2
  exit 2
fi

BASE_URL="http://127.0.0.1:${PORT}"
if curl -sS -m 2 "${BASE_URL}/health" >/dev/null 2>&1; then
  echo "checksum service already running on ${BASE_URL}" >&2
  exit 0
fi

if python3 - "${PORT}" <<'PY'
import socket
import sys

port = int(sys.argv[1])
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.settimeout(0.5)
    result = sock.connect_ex(("127.0.0.1", port))
    sys.exit(0 if result == 0 else 1)
PY
then
  echo "port already in use: ${PORT}" >&2
  exit 2
fi

if [[ ! -f "${ARTIFACT_PATH}" ]]; then
  echo "missing compiled artifact: ${ARTIFACT_PATH}" >&2
  echo "run: yarn checksum:build" >&2
  exit 2
fi

mkdir -p "${RUN_DIR}"
: > "${LOG_FILE}"

nohup env CHECKSUM_HTTP_PORT="${PORT}" PROBE_RUNTIME_ROOT="${RUNTIME_DIR}" \
  bash -lc "cd '${ROOT_DIR}' && exec java -jar '${ARTIFACT_PATH}'" >>"${LOG_FILE}" 2>&1 &
SERVICE_PID=$!
echo "${SERVICE_PID}" > "${PID_FILE}"

for _ in $(seq 1 30); do
  if curl -sS -m 2 "${BASE_URL}/health" >/dev/null 2>&1; then
    echo "checksum service started on ${BASE_URL}"
    echo "pid: ${SERVICE_PID}"
    echo "log: ${LOG_FILE}"
    exit 0
  fi
  if ! kill -0 "${SERVICE_PID}" >/dev/null 2>&1; then
    echo "checksum service exited unexpectedly; see log: ${LOG_FILE}" >&2
    rm -f "${PID_FILE}"
    exit 2
  fi
  sleep 1
done

echo "checksum service startup timeout; see log: ${LOG_FILE}" >&2
kill "${SERVICE_PID}" >/dev/null 2>&1 || true
wait "${SERVICE_PID}" >/dev/null 2>&1 || true
rm -f "${PID_FILE}"
exit 2
