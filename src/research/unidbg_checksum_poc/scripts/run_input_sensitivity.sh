#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
POC_DIR="${ROOT_DIR}/src/research/unidbg_checksum_poc"
RESULT_DIR="${ROOT_DIR}/cache/unidbg_probe/sensitivity"
mkdir -p "${RESULT_DIR}"
rm -f "${RESULT_DIR}"/*.log

BASE_PATH="${1:-/apis/tstore/v2/units/changes}"
BASE_UUID="${2:-8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001}"
BASE_BODY="${3:-}"
ALT_PATH="${4:-/apis/tstore/v2/units/changes_alt}"
ALT_BODY="${5:-{\"probe\":\"body-alt\"}}"
ALT_UUID="${6:-11111111-1111-1111-1111-111111111111}"
LIB_BASENAME="${7:-libe755b7.so}"

run_case() {
  local name="$1"
  local path="$2"
  local uuid="$3"
  local body="$4"
  local out_file="${RESULT_DIR}/${name}.log"

  echo "[sensitivity] ${name} path=${path} uuid=${uuid} body=${body}" | tee "${out_file}"
  if "${POC_DIR}/scripts/run_probe.sh" "${path}" "${uuid}" "${body}" "${LIB_BASENAME}" >>"${out_file}" 2>&1; then
    echo "status=PASS" | tee -a "${out_file}"
  else
    echo "status=FAIL" | tee -a "${out_file}"
  fi
}

run_case baseline "${BASE_PATH}" "${BASE_UUID}" "${BASE_BODY}"
run_case path_alt "${ALT_PATH}" "${BASE_UUID}" "${BASE_BODY}"
run_case body_alt "${BASE_PATH}" "${BASE_UUID}" "${ALT_BODY}"
run_case uuid_alt "${BASE_PATH}" "${ALT_UUID}" "${BASE_BODY}"

echo
echo "[summary]"
for file in "${RESULT_DIR}"/*.log; do
  echo "--- $(basename "${file}")"
  rg -n "^(result|checksum|checksum_source|load_order|load_libcxx|loaded_modules|e755b7_jni_onload|.*\\.call_nmcs|.*\\.registered|error_type|error|status)=" "${file}" || true
done
