#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
POC_DIR="${ROOT_DIR}/src/research/unidbg_checksum_poc"
APK="${4:-${TARGET_APK:-${ROOT_DIR}/cache/profiles/full/build/patched_signed.apk}}"
PATH_ARG="${1:-/apis/tstore/v2/units/changes}"
UUID_ARG="${2:-8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001}"
BODY_ARG="${3:-}"
SERVICE_URL="${CHECKSUM_SERVICE_URL:-http://127.0.0.1:19090/checksum}"
DEBUG_URL="${CHECKSUM_DEBUG_URL:-http://127.0.0.1:19090/debug/checksum}"
LOAD_ORDER="${PROBE_LOAD_ORDER:-libcxx-first}"
LOAD_LIBCXX="${PROBE_LOAD_LIBCXX:-1}"
CH_MODE="${PROBE_CH_MODE:-passthrough}"

payload="{\"path\":\"${PATH_ARG}\",\"body\":\"${BODY_ARG}\",\"uuid\":\"${UUID_ARG}\"}"
debug_resp="$(curl -sS "${DEBUG_URL}" -H 'Content-Type: application/json' -d "${payload}" 2>/dev/null || true)"
live_resp="${debug_resp}"
if ! echo "${live_resp}" | grep -q '"checksum"'; then
  live_resp="$(curl -sS "${SERVICE_URL}" -H 'Content-Type: application/json' -d "${payload}")"
fi

probe_env="$(LIVE_RESP="${live_resp}" python3 - <<'PY'
import json
import os

resp = json.loads(os.environ["LIVE_RESP"])
runtime = resp.get("data", {}).get("runtime", {})
parts = []
device_id = runtime.get("deviceId") or runtime.get("androidId")
adjusted = runtime.get("adjustedTimeMs")
if device_id:
    parts.append(f"PROBE_DEVICE_ID='{device_id}'")
if adjusted is not None:
    parts.append(f"PROBE_FIXED_TIME_MS='{adjusted}'")
print(" ".join(parts))
PY
)"

if [[ -n "${probe_env}" ]]; then
  # Keep unidbg inputs aligned with values observed in the live app process.
  unidbg_resp="$(eval "${probe_env} \"${POC_DIR}/scripts/run_probe.sh\" \"${PATH_ARG}\" \"${UUID_ARG}\" \"${BODY_ARG}\" \
    \"libphonepe-cryptography-support-lib.so\" \"${LOAD_ORDER}\" \"${LOAD_LIBCXX}\" \"${APK}\"")"
else
  unidbg_resp="$("${POC_DIR}/scripts/run_probe.sh" "${PATH_ARG}" "${UUID_ARG}" "${BODY_ARG}" \
    "libphonepe-cryptography-support-lib.so" "${LOAD_ORDER}" "${LOAD_LIBCXX}" "${APK}")"
fi

echo "[live]"
echo "${live_resp}"
echo
echo "[unidbg]"
echo "${unidbg_resp}"
echo
echo "[summary]"
LIVE_RESP="${live_resp}" UNIDBG_RESP="${unidbg_resp}" python3 - <<'PY'
import base64
import json
import os

live = json.loads(os.environ["LIVE_RESP"])
unidbg_lines = os.environ["UNIDBG_RESP"].splitlines()
report = {}
for line in unidbg_lines:
    if "=" in line:
        k, v = line.split("=", 1)
        report[k] = v

live_checksum = live.get("data", {}).get("checksum", "")
runtime = live.get("data", {}).get("runtime", {})
decoded = ""
try:
    decoded = base64.b64decode(live_checksum).decode("utf-8")
except Exception:
    decoded = "<base64 decode failed>"

print(f"live_checksum_length={len(live_checksum)}")
print(f"live_decoded_prefix={decoded[:64]}")
if runtime:
    print(f"live_device_id={runtime.get('deviceId') or runtime.get('androidId') or ''}")
    print(f"live_adjusted_time_ms={runtime.get('adjustedTimeMs', '')}")
    print(f"live_server_time_offset_ms={runtime.get('serverTimeOffsetMs', '')}")
    print(f"live_signature_sha256={runtime.get('signatureSha256', '')}")
print(f"unidbg_checksum_length={len(report.get('checksum', ''))}")
print(f"unidbg_checksum={report.get('checksum', '')}")
print(f"ch_fallback_hits={report.get('ch_fallback_hits', '0')}")
print(f"stub_hits={report.get('stub_hits', '0')}")
for key in sorted(report):
    if key.startswith("ch.") or key.startswith("callObjectMethod.") or key.startswith("callStaticObjectMethod.") or key.startswith("getObjectField."):
        print(f"{key}={report[key]}")
PY
