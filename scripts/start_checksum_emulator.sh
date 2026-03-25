#!/usr/bin/env bash
set -euo pipefail

EMULATOR_BIN="${EMULATOR_BIN:-/Users/danielscai/Library/Android/sdk/emulator/emulator}"
ADB_BIN="${ADB_BIN:-adb}"
AVD_NAME="${AVD_NAME:-phonepe_nologin}"
EMULATOR_PORT="${EMULATOR_PORT:-5560}"
SERIAL="${SERIAL:-emulator-${EMULATOR_PORT}}"
APK_PATH="${APK_PATH:-/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/cache/profiles/full/build/patched_signed.apk}"
MAIN_ACTIVITY="${MAIN_ACTIVITY:-com.phonepe.app/.launch.core.main.ui.MainActivity}"
LOG_FILE="${LOG_FILE:-/tmp/navpay_checksum_emulator_${EMULATOR_PORT}.log}"

start_app() {
  ${ADB_BIN} -s "${SERIAL}" shell monkey -p com.phonepe.app -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
  ${ADB_BIN} -s "${SERIAL}" shell am start -W -n "${MAIN_ACTIVITY}" >/dev/null 2>&1 || true
}

wait_app_pid() {
  for _ in $(seq 1 15); do
    pid="$(${ADB_BIN} -s "${SERIAL}" shell pidof com.phonepe.app 2>/dev/null | tr -d '\r' || true)"
    if [[ -n "${pid}" ]]; then
      echo "${pid}"
      return 0
    fi
    sleep 1
  done
  return 1
}

echo "[1/7] checking prerequisites..."
if [[ ! -x "${EMULATOR_BIN}" ]]; then
  echo "emulator binary not found: ${EMULATOR_BIN}" >&2
  exit 1
fi
if [[ ! -f "${APK_PATH}" ]]; then
  echo "apk not found: ${APK_PATH}" >&2
  exit 1
fi

echo "[2/7] ensuring emulator ${SERIAL} is running..."
if ! ${ADB_BIN} -s "${SERIAL}" get-state >/dev/null 2>&1; then
  nohup "${EMULATOR_BIN}" \
    -avd "${AVD_NAME}" \
    -no-window \
    -no-audio \
    -gpu swiftshader_indirect \
    -port "${EMULATOR_PORT}" \
    >"${LOG_FILE}" 2>&1 &
  disown || true
fi

echo "[3/7] waiting for ${SERIAL} online..."
for _ in $(seq 1 180); do
  if ${ADB_BIN} devices -l | grep -q "^${SERIAL}[[:space:]]\+device"; then
    break
  fi
  sleep 2
done
if ! ${ADB_BIN} devices -l | grep -q "^${SERIAL}[[:space:]]\+device"; then
  echo "emulator not online: ${SERIAL}" >&2
  echo "tip: check ${LOG_FILE}" >&2
  exit 1
fi

echo "[4/7] waiting for boot completed + package service..."
for _ in $(seq 1 240); do
  boot="$(${ADB_BIN} -s "${SERIAL}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
  anim="$(${ADB_BIN} -s "${SERIAL}" shell getprop init.svc.bootanim 2>/dev/null | tr -d '\r' || true)"
  pkg="$(${ADB_BIN} -s "${SERIAL}" shell service check package 2>/dev/null | tr -d '\r' || true)"
  if [[ "${boot}" == "1" && "${anim}" == "stopped" && "${pkg}" == *"found"* ]]; then
    break
  fi
  sleep 2
done

echo "[5/7] installing apk..."
${ADB_BIN} -s "${SERIAL}" install -r -g "${APK_PATH}"

echo "[6/7] starting app..."
app_ready=0
for attempt in $(seq 1 3); do
  start_app
  if pid="$(wait_app_pid)"; then
    app_ready=1
    echo "app pid: ${pid}"
  fi
  [[ "${app_ready}" -eq 1 ]] && break
  echo "app not ready, retrying start (${attempt}/3)..."
done
if [[ "${app_ready}" -ne 1 ]]; then
  echo "warning: com.phonepe.app pid not stable; continue to checksum probe..." >&2
fi

echo "[7/7] forwarding and probing checksum service..."
${ADB_BIN} -s "${SERIAL}" forward --remove tcp:19090 >/dev/null 2>&1 || true
${ADB_BIN} -s "${SERIAL}" forward tcp:19090 tcp:19090 >/dev/null

ok=0
sleep 3
for round in $(seq 1 5); do
  if ! ${ADB_BIN} -s "${SERIAL}" shell pidof com.phonepe.app >/dev/null 2>&1; then
    start_app
    sleep 2
  fi
  for _ in $(seq 1 12); do
    health="$(curl -s -m 2 http://127.0.0.1:19090/health 2>/dev/null || true)"
    if echo "${health}" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
      ok=1
      echo "checksum health: ${health}"
      break
    fi
    sleep 1
  done
  [[ "${ok}" -eq 1 ]] && break
  echo "checksum not ready, restarting app (${round}/5)..."
  ${ADB_BIN} -s "${SERIAL}" shell am force-stop com.phonepe.app >/dev/null 2>&1 || true
  start_app
  sleep 2
done
if [[ "${ok}" -ne 1 ]]; then
  echo "checksum service not healthy on 127.0.0.1:19090 yet" >&2
  echo "tip: check emulator state and rerun yarn checksum:start" >&2
  exit 1
fi

echo "ready: run checksum with"
echo "curl -sS http://127.0.0.1:19090/checksum -H 'Content-Type: application/json' -d '{\"path\":\"/apis/tstore/v2/units/changes\",\"body\":\"\",\"uuid\":\"8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001\"}'"
