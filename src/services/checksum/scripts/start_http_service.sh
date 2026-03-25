#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SERVICE_DIR="${ROOT_DIR}/src/services/checksum"
PORT="${CHECKSUM_HTTP_PORT:-19190}"
APK="${PROBE_TARGET_APK:-${ROOT_DIR}/cache/profiles/full/build/patched_signed.apk}"

if [[ ! -f "${APK}" ]]; then
  echo "missing apk: ${APK}" >&2
  exit 2
fi

mvn -f "${SERVICE_DIR}/pom.xml" -q -DskipTests compile

CHECKSUM_HTTP_PORT="${PORT}" PROBE_TARGET_APK="${APK}" \
  mvn -f "${SERVICE_DIR}/pom.xml" -q -DskipTests exec:java \
  -Dexec.mainClass=com.navpay.phonepe.unidbg.ChecksumHttpService
