#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
POC_DIR="${ROOT_DIR}/src/research/unidbg_checksum_poc"
RESULT_DIR="${ROOT_DIR}/cache/unidbg_probe/results"
mkdir -p "${RESULT_DIR}"

PATH_ARG="${1:-/apis/tstore/v2/units/changes}"
UUID_ARG="${2:-8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001}"
BODY_ARG="${3:-}"
APK_ARG="${4:-${TARGET_APK:-}}"

probe() {
  local lib_name="$1"
  local out_file="${RESULT_DIR}/${lib_name}.log"
  echo "[probe] ${lib_name}" | tee "${out_file}"
  if "${POC_DIR}/scripts/run_probe.sh" "${PATH_ARG}" "${UUID_ARG}" "${BODY_ARG}" "${lib_name}" "" "" "${APK_ARG}" >>"${out_file}" 2>&1; then
    echo "status=PASS" | tee -a "${out_file}"
    return 0
  fi
  echo "status=FAIL" | tee -a "${out_file}"
  return 1
}

probe libphonepe-cryptography-support-lib.so || true
probe liba41935.so || true

if rg -q "^result=PASS$" "${RESULT_DIR}"/*.log; then
  echo "IMPLEMENTABLE=YES"
  exit 0
fi

echo "IMPLEMENTABLE=NO"
exit 1
