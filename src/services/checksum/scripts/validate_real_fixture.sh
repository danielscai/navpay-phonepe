#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SERVICE_DIR="${ROOT_DIR}/src/services/checksum"
FIXTURE_PATH="${SERVICE_DIR}/src/test/resources/fixtures/phonepe_intercept_replay.json"
EXPECTED_PATH="${SERVICE_DIR}/src/test/resources/fixtures/phonepe_intercept_replay.expected.json"
PORT="${CHECKSUM_HTTP_PORT:-19190}"
BASE_URL="http://127.0.0.1:${PORT}"
STARTED_HERE=0
SERVICE_PID=""
LOG_FILE="/tmp/navpay_checksum_http_real_${PORT}.log"
UPDATE_MODE="${UPDATE_REAL_FIXTURE:-0}"

cleanup() {
  if [[ "${STARTED_HERE}" == "1" && -n "${SERVICE_PID}" ]]; then
    kill "${SERVICE_PID}" >/dev/null 2>&1 || true
    wait "${SERVICE_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if ! curl -sS -m 2 "${BASE_URL}/health" >/dev/null 2>&1; then
  : > "${LOG_FILE}"
  CHECKSUM_HTTP_PORT="${PORT}" "${SERVICE_DIR}/scripts/start_http_service.sh" >"${LOG_FILE}" 2>&1 &
  SERVICE_PID=$!
  STARTED_HERE=1
  for _ in $(seq 1 30); do
    if curl -sS -m 2 "${BASE_URL}/health" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

node --input-type=module - "${FIXTURE_PATH}" "${EXPECTED_PATH}" "${BASE_URL}" "${UPDATE_MODE}" <<'JS'
import { readFileSync, writeFileSync } from "node:fs";

const [fixturePath, expectedPath, baseUrl, updateMode] = process.argv.slice(2);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

const response = await fetch(`${baseUrl}/checksum`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    path: fixture.request.path,
    body: fixture.request.body,
    uuid: "8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001",
  }),
});

const text = await response.text();
if (!response.ok) {
  throw new Error(`checksum request failed: HTTP ${response.status} ${text}`);
}

const payload = JSON.parse(text);
if (!payload || payload.ok !== true || !payload.data) {
  throw new Error(`checksum response failed: ${text}`);
}

const normalized = {
  ok: true,
  data: {
    length: payload.data.length,
    decodedLength: payload.data.decodedLength,
    mode: payload.data.mode,
    structureOk: payload.data.structureOk,
    asciiLike: payload.data.asciiLike,
    hyphenCount: payload.data.hyphenCount,
  },
};

if (updateMode === "1") {
  writeFileSync(expectedPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(normalized, null, 2));
  process.exit(0);
}

const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
const expectedText = JSON.stringify(expected, null, 2);
const actualText = JSON.stringify(normalized, null, 2);
if (expectedText !== actualText) {
  throw new Error(`normalized checksum response does not match expected artifact\nexpected:\n${expectedText}\nactual:\n${actualText}`);
}

console.log(actualText);
JS
