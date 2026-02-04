#!/bin/zsh
set -euo pipefail

DB_PATH="src/log_server/data/logs.db"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found" >&2
  exit 1
fi

ROW_JSON=$(python3 - <<'PY'
import sqlite3, json
con=sqlite3.connect("src/log_server/data/logs.db")
con.row_factory=sqlite3.Row
cur=con.cursor()
cur.execute("""
SELECT id, url, request_headers
FROM http_logs
WHERE url LIKE '%/apis/tstore/v2/units/changes%'
ORDER BY id DESC
LIMIT 1;
""")
row=cur.fetchone()
if not row:
    raise SystemExit(1)
print(json.dumps({"id": row["id"], "url": row["url"], "headers": row["request_headers"] or ""}))
PY
) || { echo "no tstore log found" >&2; exit 1; }

URL=$(python3 - <<'PY' <<<"$ROW_JSON"
import json, sys
print(json.loads(sys.stdin.read())["url"])
PY
)

HEADERS_RAW=$(python3 - <<'PY' <<<"$ROW_JSON"
import json, sys
print(json.loads(sys.stdin.read())["headers"])
PY
)

get_cs() {
  local payload='{"path":"/apis/tstore/v2/units/changes","body":""}'
  local resp cs
  for host in \
    "http://localhost:8088/api/checksum" \
    "http://127.0.0.1:8088/api/checksum" \
    "http://[::1]:8088/api/checksum"
  do
    resp=$(curl -sS -X POST "$host" -H 'Content-Type: application/json' -d "$payload" || true)
    if [ -n "$resp" ]; then
      cs=$(python3 - <<'PY' <<<"$resp"
import sys, json
try:
    data=json.loads(sys.stdin.read())
    print(data["data"]["checksum"])
except Exception:
    pass
PY
)
      if [ -n "$cs" ]; then
        echo "$cs"
        return 0
      fi
    fi
  done
  return 1
}

CS=$(get_cs) || { echo "checksum fetch failed" >&2; exit 1; }

HDR_KEYS=(
  "Authorization"
  "X-ORG-ID"
  "X-FARM-REQUEST-ID"
  "x-farm-id"
  "Content-Type"
  "accept"
  "X-BOLT-ENC-PROTOCOL"
  "X-SOURCE-TYPE"
  "X-SOURCE-PLATFORM"
  "X-SOURCE-VERSION"
  "X-MERCHANT-ID"
  "X-APP-ID"
  "X-DG-CA"
  "X-SOURCE-LOCALE"
  "X-REQUEST-ALIAS"
  "X-REQUEST-START-TIME"
)

ARGS=(-sS -D - -o /dev/null -X POST "$URL")
for k in "${HDR_KEYS[@]}"; do
  line=$(printf '%s\n' "$HEADERS_RAW" | awk -F': ' -v key="$k" '$1==key{print $0; exit}')
  if [ -n "$line" ]; then
    ARGS+=(-H "$line")
  fi
done
ARGS+=(-H "X-REQUEST-CHECKSUM-V4: $CS")

curl "${ARGS[@]}"
