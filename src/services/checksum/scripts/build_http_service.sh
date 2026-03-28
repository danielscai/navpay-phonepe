#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SERVICE_DIR="${ROOT_DIR}/src/services/checksum"
ARTIFACT_PATH="${CHECKSUM_ARTIFACT_PATH:-${SERVICE_DIR}/target/checksum-service.jar}"

mvn -f "${SERVICE_DIR}/pom.xml" -q -DskipTests package

if [[ ! -f "${ARTIFACT_PATH}" ]]; then
  echo "build failed, missing artifact: ${ARTIFACT_PATH}" >&2
  exit 2
fi

echo "build ok: ${ARTIFACT_PATH}"
