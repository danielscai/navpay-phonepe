#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
PORT="${CHECKSUM_HTTP_PORT:-19190}"
BASE_URL="http://127.0.0.1:${PORT}"
PAYLOAD='{"path":"/apis/tstore/v2/units/changes","body":"","uuid":"8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001"}'
STARTED_HERE=0
SERVICE_PID=""
LOG_FILE="/tmp/navpay_checksum_http_${PORT}.log"

cleanup() {
  if [[ "${STARTED_HERE}" == "1" && -n "${SERVICE_PID}" ]]; then
    kill "${SERVICE_PID}" >/dev/null 2>&1 || true
    wait "${SERVICE_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if ! curl -sS -m 2 "${BASE_URL}/health" >/dev/null 2>&1; then
  : > "${LOG_FILE}"
  CHECKSUM_HTTP_PORT="${PORT}" "${ROOT_DIR}/src/services/checksum/scripts/start_http_service.sh" >"${LOG_FILE}" 2>&1 &
  SERVICE_PID=$!
  STARTED_HERE=1
  for _ in $(seq 1 30); do
    if curl -sS -m 2 "${BASE_URL}/health" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

health="$(curl -sS -m 5 "${BASE_URL}/health")"
checksum="$(curl -sS -m 20 "${BASE_URL}/checksum" -H 'Content-Type: application/json' -d "${PAYLOAD}")"
validate="$(curl -sS -m 20 "${BASE_URL}/validate" -H 'Content-Type: application/json' -d "${PAYLOAD}")"

echo "[health]"
echo "${health}"
echo
echo "[checksum]"
echo "${checksum}"
echo
echo "[validate]"
echo "${validate}"

HEALTH_RESP="${health}" CHECKSUM_RESP="${checksum}" VALIDATE_RESP="${validate}" python3 - <<'PY'
import json
import os
import sys

health = json.loads(os.environ["HEALTH_RESP"])
checksum = json.loads(os.environ["CHECKSUM_RESP"])
validate = json.loads(os.environ["VALIDATE_RESP"])

assert health["ok"] is True
assert health["data"]["status"] == "ok"
assert checksum["ok"] is True
assert checksum["data"]["structureOk"] is True
assert checksum["data"]["length"] >= 160
assert checksum["data"]["decodedLength"] >= 120
assert validate["ok"] is True
assert validate["data"]["structureOk"] is True
print("PASS")
PY
