#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEVICE_SERIAL=""
PHONE_NUMBER="${LOGIN_PHONE:-6338933055}"
NO_PROCEED="${LOGIN_NO_PROCEED:-0}"
TMP_DIR="/tmp/phonepe_ui"
UIDUMP="$TMP_DIR/uidump.xml"
UIDUMP_AFTER="$TMP_DIR/uidump_after.xml"
UIAUTO_ERR="$TMP_DIR/uiautomator.err"
PACKAGE_NAME="com.phonepe.app"
MAIN_ACTIVITY=".launch.core.main.ui.MainActivity"

usage() {
  cat <<'USAGE'
Usage: tools/step5_auto_login.sh [--phone <number>] [--no-proceed] [-s <serial>]

Options:
  --phone <number>  Phone number to input (digits only)
  --no-proceed      Do not tap Proceed (avoid triggering SMS)
  -s <serial>       adb device/emulator serial (required if multiple devices)

Behavior:
- Dumps current UI, finds phone input and "Proceed" button,
  inputs the phone number, then taps Proceed.
- Verifies navigation by checking for OTP screen texts.

Defaults:
- Phone number: $LOGIN_PHONE or 6338933055
- No-proceed: $LOGIN_NO_PROCEED (0 or 1)
USAGE
}

log_step() {
  echo "[$(date +%H:%M:%S)] $*"
}

fast_clear_field() {
  # Remove current text quickly: move to end, then longpress DEL twice
  adb -s "$DEVICE_SERIAL" shell input keyevent KEYCODE_MOVE_END >/dev/null 2>&1 || true
  adb -s "$DEVICE_SERIAL" shell input keyevent --longpress KEYCODE_DEL >/dev/null 2>&1 || true
  adb -s "$DEVICE_SERIAL" shell input keyevent --longpress KEYCODE_DEL >/dev/null 2>&1 || true
}

fast_input_phone() {
  local num="$1"
  local first=${num:0:5}
  local second=${num:5}
  adb -s "$DEVICE_SERIAL" shell input text "$first" >/dev/null
  sleep 0.1
  adb -s "$DEVICE_SERIAL" shell input text "$second" >/dev/null
}

while [ $# -gt 0 ]; do
  case "$1" in
    --phone)
      PHONE_NUMBER="$2"
      shift 2
      ;;
    --no-proceed)
      NO_PROCEED="1"
      shift 1
      ;;
    -s)
      DEVICE_SERIAL="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[FAIL] Unknown arg: $1"
      usage
      exit 1
      ;;
  esac
done

if ! command -v adb >/dev/null 2>&1; then
  echo "[FAIL] adb not found"
  exit 1
fi

# Select device
if [ -z "$DEVICE_SERIAL" ]; then
  devices=$(adb devices | grep -v "List" | awk '$2=="device" {print $1}')
  count=$(echo "$devices" | grep -c . || true)
  if [ "$count" -eq 0 ]; then
    echo "[FAIL] No adb devices found"
    exit 1
  elif [ "$count" -eq 1 ]; then
    DEVICE_SERIAL="$devices"
  else
    echo "[FAIL] Multiple devices found. Please specify -s <serial>."
    echo "$devices"
    exit 1
  fi
fi

mkdir -p "$TMP_DIR"

dump_ui() {
  adb -s "$DEVICE_SERIAL" shell input keyevent 82 >/dev/null 2>&1 || true
  : > "$UIAUTO_ERR"
  if python3 - "$DEVICE_SERIAL" "$UIAUTO_ERR" <<'PY'
import subprocess, sys
try:
    r = subprocess.run(
        ["adb","-s",sys.argv[1],"shell","uiautomator","dump","/sdcard/uidump.xml"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=2, check=True, text=True
    )
    sys.exit(0)
except Exception as e:
    try:
        msg = getattr(e, "stdout", None)
        if msg:
            text = str(msg).strip()
            if "ERROR" in text or "null root node" in text:
                open(sys.argv[2], "a").write(text + "\\n")
        else:
            open(sys.argv[2], "a").write("uiautomator dump failed\\n")
    except Exception:
        pass
    sys.exit(1)
PY
  then
    for _ in 1 2 3; do
      python3 - "$DEVICE_SERIAL" "$UIDUMP" <<'PY'
import subprocess, sys
try:
    subprocess.run(
        ["adb","-s",sys.argv[1],"pull","/sdcard/uidump.xml",sys.argv[2]],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2, check=False
    )
except Exception:
    pass
PY
      if [ -s "$UIDUMP" ]; then
        return 0
      fi
      sleep 0.2
    done
    echo "pull failed" > "$UIAUTO_ERR"
  fi
  return 1
}

parse_bounds() {
  python3 - <<'PY'
import xml.etree.ElementTree as ET
root=ET.parse('/tmp/phonepe_ui/uidump.xml').getroot()

input_bounds = None
proceed_bounds = None

for node in root.iter('node'):
    cls = node.attrib.get('class','')
    rid = node.attrib.get('resource-id','')
    text = node.attrib.get('text','')
    if not input_bounds and ('EditText' in cls or 'TextField' in cls):
        if rid == 'phone_number_field' or text.strip().isdigit() or 'phone' in rid:
            input_bounds = node.attrib.get('bounds')

for node in root.iter('node'):
    text = node.attrib.get('text','')
    desc = node.attrib.get('content-desc','')
    if 'Proceed' in text or 'Proceed' in desc:
        proceed_bounds = node.attrib.get('bounds')
        break

print((input_bounds or '') + ' ' + (proceed_bounds or ''))
PY
}

is_login_screen() {
  python3 - <<'PY'
import xml.etree.ElementTree as ET
root=ET.parse('/tmp/phonepe_ui/uidump.xml').getroot()
input_ok = False
proceed_ok = False
for node in root.iter('node'):
    cls = node.attrib.get('class','')
    rid = node.attrib.get('resource-id','')
    text = node.attrib.get('text','')
    if (('EditText' in cls) or ('TextField' in cls)) and (rid == 'phone_number_field' or text.strip().isdigit() or 'phone' in rid):
        input_ok = True
    if 'Proceed' in text or 'Proceed' in node.attrib.get('content-desc',''):
        proceed_ok = True
print('yes' if (input_ok and proceed_ok) else 'no')
PY
}

has_proceed_only() {
  python3 - <<'PY'
import xml.etree.ElementTree as ET
root=ET.parse('/tmp/phonepe_ui/uidump.xml').getroot()
proceed_ok = False
for node in root.iter('node'):
    text = node.attrib.get('text','')
    desc = node.attrib.get('content-desc','')
    if 'Proceed' in text or 'Proceed' in desc:
        proceed_ok = True
        break
print('yes' if proceed_ok else 'no')
PY
}

get_focus_activity() {
  adb -s "$DEVICE_SERIAL" shell dumpsys window 2>/dev/null | rg -m1 "mCurrentFocus" | sed -E 's/.*mCurrentFocus=Window\\{[^ ]+ [^ ]+ ([^} ]+).*/\\1/'
}

is_google_phone_hint() {
  python3 - <<'PY'
import xml.etree.ElementTree as ET
root=ET.parse('/tmp/phonepe_ui/uidump.xml').getroot()
texts=[n.attrib.get('text','') for n in root.iter('node') if n.attrib.get('text','')]
packages=[n.attrib.get('package','') for n in root.iter('node') if n.attrib.get('package','')]
keywords=['Choose an account','Continue','Phone number hint','Use another account','Select phone number','Choose a phone number']
if any(any(k in t for k in keywords) for t in texts) and (any('com.google.android.gms' in p for p in packages) or any('google' in t.lower() for t in texts)):
    print('yes')
else:
    print('no')
PY
}

dismiss_google_hint() {
  # Try back, then tap outside the bottom sheet
  log_step "Detected Google phone hint; dismissing"
  adb -s "$DEVICE_SERIAL" shell input keyevent 4 >/dev/null 2>&1 || true
  sleep 0.1
  if ! dump_ui; then
    return 0
  fi
  if [ "$(is_google_phone_hint)" = "yes" ]; then
    adb -s "$DEVICE_SERIAL" shell input tap 100 200 >/dev/null 2>&1 || true
    sleep 0.1
  fi
}

has_otp_screen() {
  python3 - <<'PY'
import xml.etree.ElementTree as ET
root=ET.parse('/tmp/phonepe_ui/uidump.xml').getroot()
texts=[n.attrib.get('text','') for n in root.iter('node') if n.attrib.get('text','')]
keywords=['Enter OTP','Verify your mobile number','Auto-reading OTP']
if any(any(k in t for k in keywords) for t in texts):
    print('yes')
else:
    print('no')
PY
}

ensure_app_running() {
  for _ in 1 2 3; do
    adb -s "$DEVICE_SERIAL" shell am force-stop "$PACKAGE_NAME" >/dev/null 2>&1 || true
    adb -s "$DEVICE_SERIAL" shell am start -n "$PACKAGE_NAME/$MAIN_ACTIVITY" >/dev/null 2>&1 || true
    sleep 2
    for _ in 1 2 3 4 5; do
      if adb -s "$DEVICE_SERIAL" shell pidof "$PACKAGE_NAME" >/dev/null 2>&1; then
        return 0
      fi
      sleep 1
    done
  done
  return 1
}

# Restart app to ensure we land on login flow
log_step "Restarting app and waiting for process"
if ! ensure_app_running; then
  echo "[FAIL] App did not start after retries"
  exit 1
fi

# Poll every second and act as soon as state is ready
login_ready="no"
prev_focus=""
stable_count=0
not_phonepe_count=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
  focus=$(get_focus_activity || true)
  if [ -n "$focus" ]; then
    log_step "Focus: $focus"
  else
    log_step "Focus: (unknown)"
  fi

  if echo "$focus" | rg -q "com.google.android.gms"; then
    dismiss_google_hint
    adb -s "$DEVICE_SERIAL" shell am start -n "$PACKAGE_NAME/$MAIN_ACTIVITY" >/dev/null 2>&1 || true
    sleep 0.5
    continue
  fi

  if ! echo "$focus" | rg -q "com.phonepe.app"; then
    log_step "Waiting for PhonePe UI"
    not_phonepe_count=$((not_phonepe_count + 1))
    if [ "$not_phonepe_count" -ge 4 ]; then
      log_step "Re-launching app to foreground"
      adb -s "$DEVICE_SERIAL" shell am start -n "$PACKAGE_NAME/$MAIN_ACTIVITY" >/dev/null 2>&1 || true
      not_phonepe_count=0
    fi
    sleep 0.5
    prev_focus=""
    stable_count=0
    continue
  fi
  not_phonepe_count=0

  if [ "$focus" = "$prev_focus" ]; then
    stable_count=$((stable_count + 1))
  else
    stable_count=0
  fi
  prev_focus="$focus"
  if [ "$stable_count" -lt 1 ]; then
    log_step "Waiting for UI to stabilize"
    sleep 0.5
    continue
  fi

  # Only dump UI when PhonePe is focused (retry up to 3 times)
  if ! dump_ui; then
    log_step "UI dump failed; retrying"
    sleep 0.3
    if ! dump_ui; then
      log_step "UI dump failed; retrying"
      sleep 0.3
      if ! dump_ui; then
        if [ -s "$UIAUTO_ERR" ]; then
          log_step "UI dump error: $(head -n 1 "$UIAUTO_ERR")"
        fi
        log_step "UI dump failed; retry"
        sleep 0.5
        continue
      fi
    fi
  fi
  if [ "$(is_google_phone_hint)" = "yes" ]; then
    dismiss_google_hint
    sleep 0.5
    continue
  fi
  if [ "$(is_login_screen)" = "yes" ]; then
    login_ready="yes"
    log_step "Login screen detected"
    break
  fi
  log_step "Login screen not ready yet"
  sleep 0.5
done

if [ "$login_ready" != "yes" ]; then
  echo "[FAIL] Login screen not detected within timeout"
  exit 1
fi

read -r INPUT_BOUNDS PROCEED_BOUNDS < <(parse_bounds)

if [ -z "$INPUT_BOUNDS" ] || [ -z "$PROCEED_BOUNDS" ]; then
  echo "[FAIL] Could not locate input or Proceed button after restart"
  echo "[INFO] If app is not on login screen, please navigate to login and re-run."
  exit 1
fi

if [ -z "$INPUT_BOUNDS" ] || [ -z "$PROCEED_BOUNDS" ]; then
  echo "[FAIL] Could not locate input or Proceed button in UI"
  echo "[INFO] input_bounds='$INPUT_BOUNDS' proceed_bounds='$PROCEED_BOUNDS'"
  exit 1
fi

# Convert bounds to center point
center_from_bounds() {
  local b="$1"
  local x1 y1 x2 y2
  x1=$(echo "$b" | sed -E 's/\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]/\1/')
  y1=$(echo "$b" | sed -E 's/\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]/\2/')
  x2=$(echo "$b" | sed -E 's/\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]/\3/')
  y2=$(echo "$b" | sed -E 's/\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]/\4/')
  echo $(( (x1 + x2) / 2 )) $(( (y1 + y2) / 2 ))
}

read -r INPUT_X INPUT_Y < <(center_from_bounds "$INPUT_BOUNDS")
read -r PROCEED_X PROCEED_Y < <(center_from_bounds "$PROCEED_BOUNDS")

# Tap input, clear, type, then tap Proceed
log_step "Filling phone number"
adb -s "$DEVICE_SERIAL" shell input tap "$INPUT_X" "$INPUT_Y" >/dev/null
fast_clear_field
fast_input_phone "$PHONE_NUMBER"
if [ "$NO_PROCEED" = "1" ]; then
  log_step "--no-proceed set; skipping Proceed tap"
  exit 0
fi

log_step "Tapping Proceed"
adb -s "$DEVICE_SERIAL" shell input tap "$PROCEED_X" "$PROCEED_Y" >/dev/null

# Verify OTP screen (poll up to ~6s)
otp_ok="no"
for _ in 1 2 3 4 5 6; do
  if ! dump_ui; then
    sleep 1
    continue
  fi
  if [ "$(is_google_phone_hint)" = "yes" ]; then
    dismiss_google_hint
    sleep 1
    continue
  fi
  if [ "$(has_otp_screen)" = "yes" ]; then
    otp_ok="yes"
    break
  fi
  sleep 1
done

if [ "$otp_ok" = "yes" ]; then
  echo "[PASS] OTP screen detected after Proceed"
else
  echo "[WARN] OTP screen not detected; UI may not have advanced"
fi

echo "[PASS] Step 5 auto login input completed."
