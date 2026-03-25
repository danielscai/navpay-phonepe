#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SERVICE_DIR="${ROOT_DIR}/src/services/checksum"
RUNTIME_DIR="${SERVICE_DIR}/runtime"
LIB_DIR="${RUNTIME_DIR}/lib/arm64-v8a"
DEFAULT_APK="${ROOT_DIR}/cache/profiles/full/build/patched_signed.apk"
APK_PATH="${1:-${PROBE_TARGET_APK:-${DEFAULT_APK}}}"

if [[ -z "${APK_PATH}" || ! -f "${APK_PATH}" ]]; then
  echo "missing apk: ${APK_PATH:-<empty>}" >&2
  exit 2
fi

mkdir -p "${LIB_DIR}"

unzip -o "${APK_PATH}" \
  "lib/arm64-v8a/libphonepe-cryptography-support-lib.so" \
  "lib/arm64-v8a/liba41935.so" \
  "lib/arm64-v8a/libc++_shared.so" \
  -d "${RUNTIME_DIR}" >/dev/null

mvn -f "${SERVICE_DIR}/pom.xml" -q -DskipTests compile
mvn -f "${SERVICE_DIR}/pom.xml" -q -DskipTests exec:java \
  -Dexec.mainClass=com.navpay.phonepe.unidbg.ChecksumRuntimeInitializer \
  -Dexec.args="init ${APK_PATH} ${RUNTIME_DIR}"

echo "checksum runtime initialized at ${RUNTIME_DIR}"
