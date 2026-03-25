#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SERVICE_DIR="${ROOT_DIR}/src/services/checksum"
PORT="${CHECKSUM_HTTP_PORT:-19190}"
RUNTIME_DIR="${PROBE_RUNTIME_ROOT:-${SERVICE_DIR}/runtime}"

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

mvn -f "${SERVICE_DIR}/pom.xml" -q -DskipTests compile

CHECKSUM_HTTP_PORT="${PORT}" PROBE_RUNTIME_ROOT="${RUNTIME_DIR}" \
  mvn -f "${SERVICE_DIR}/pom.xml" -q -DskipTests exec:java \
  -Dexec.mainClass=com.navpay.phonepe.unidbg.ChecksumHttpService
