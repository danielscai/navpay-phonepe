#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SERVICE_DIR="${ROOT_DIR}/src/services/checksum"
WORK_DIR="${ROOT_DIR}/cache/unidbg_probe"
APK="${7:-${TARGET_APK:-${ROOT_DIR}/cache/profiles/full/build/patched_signed.apk}}"

PATH_ARG="${1:-/apis/tstore/v2/units/changes}"
UUID_ARG="${2:-8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001}"
BODY_ARG="${3:-}"
LIB_BASENAME="${4:-libphonepe-cryptography-support-lib.so}"
LOAD_ORDER="${5:-${PROBE_LOAD_ORDER:-e755b7-first}}"
LOAD_LIBCXX="${6:-${PROBE_LOAD_LIBCXX:-0}}"

mkdir -p "${WORK_DIR}/libs"
mkdir -p "${WORK_DIR}/lib/arm64-v8a"

if [[ ! -f "${APK}" ]]; then
  echo "missing apk: ${APK}" >&2
  exit 2
fi

if [[ -z "${PROBE_DEVICE_ID:-}" ]] && command -v adb >/dev/null 2>&1; then
  ADB_SERIAL_CANDIDATE="${PROBE_ADB_SERIAL:-}"
  if [[ -z "${ADB_SERIAL_CANDIDATE}" ]]; then
    ADB_SERIAL_CANDIDATE="$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
  fi
  if [[ -n "${ADB_SERIAL_CANDIDATE}" ]]; then
    PROBE_DEVICE_ID="$(adb -s "${ADB_SERIAL_CANDIDATE}" shell settings get secure android_id 2>/dev/null | tr -d '\r' || true)"
    export PROBE_DEVICE_ID
  fi
fi

rm -f "${WORK_DIR}/lib/arm64-v8a/${LIB_BASENAME}" \
      "${WORK_DIR}/lib/arm64-v8a/liba41935.so" \
      "${WORK_DIR}/lib/arm64-v8a/libc++_shared.so"

unzip -o "${APK}" \
  "lib/arm64-v8a/${LIB_BASENAME}" \
  "lib/arm64-v8a/liba41935.so" \
  "lib/arm64-v8a/libc++_shared.so" \
  -d "${WORK_DIR}" >/dev/null

mvn -f "${SERVICE_DIR}/pom.xml" -q -DskipTests compile

PROBE_LOAD_ORDER="${LOAD_ORDER}" PROBE_LOAD_LIBCXX="${LOAD_LIBCXX}" PROBE_TARGET_APK="${APK}" \
  mvn -f "${SERVICE_DIR}/pom.xml" -q -DskipTests exec:java \
  -Dexec.args="${WORK_DIR}/lib/arm64-v8a/${LIB_BASENAME} ${PATH_ARG} ${UUID_ARG} ${BODY_ARG}"
