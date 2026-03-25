#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
POC_DIR="${ROOT_DIR}/src/research/unidbg_checksum_poc"
RESULT_DIR="${ROOT_DIR}/cache/unidbg_probe/matrix"
mkdir -p "${RESULT_DIR}"
rm -f "${RESULT_DIR}"/*.log

PATH_ARG="${1:-/apis/tstore/v2/units/changes}"
UUID_ARG="${2:-8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001}"
BODY_ARG="${3:-}"
LIB_BASENAME="${4:-libe755b7.so}"

run_case() {
  local name="$1"
  local load_order="$2"
  local load_libcxx="$3"
  local out_file="${RESULT_DIR}/${name}.log"

  echo "[matrix] ${name} order=${load_order} libcxx=${load_libcxx}" | tee "${out_file}"
  if "${POC_DIR}/scripts/run_probe.sh" "${PATH_ARG}" "${UUID_ARG}" "${BODY_ARG}" "${LIB_BASENAME}" "${load_order}" "${load_libcxx}" >>"${out_file}" 2>&1; then
    echo "status=PASS" | tee -a "${out_file}"
  else
    echo "status=FAIL" | tee -a "${out_file}"
  fi
}

run_case baseline e755b7-first 0
run_case libcxx-first libcxx-first 1
run_case e755b7-first e755b7-first 1

echo
echo "[summary]"
for file in "${RESULT_DIR}"/*.log; do
  echo "--- $(basename "${file}")"
  rg -n "^(result|checksum|checksum_source|load_order|load_libcxx|loaded_modules|e755b7_jni_onload|libcxx_shared_jni_onload|.*\\.call_nmcs|.*\\.registered|error_type|error|status)=" "${file}" || true
done
