#!/usr/bin/env python3
import json
import re
import sqlite3
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse, parse_qs

DB_PATH = Path("src/log_server/data/logs.db")
OUTPUT_JSON = Path("/tmp/tstore_changes_all.json")
HTML_PATH = Path("src/log_server/public/transactions.html")
PAGE_DELAY_SEC = 0.5


def get_latest_tstore_log(conn):
    cur = conn.cursor()
    cur.execute(
        "select id, url, request_headers from http_logs "
        "where url like '%/apis/tstore/v2/units/changes%' order by id desc limit 1"
    )
    row = cur.fetchone()
    if not row:
        raise RuntimeError("No tstore/v2/units/changes logs found in database.")
    return row


def parse_headers(headers_str):
    return [h for h in headers_str.split("\n") if h.strip()]


def parse_params(url):
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    params = {k: v[0] for k, v in qs.items() if v}
    return params


def build_url(base_url, params):
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    return f"{base_url}?{qs}"


def fetch_page(url, headers):
    out = "/tmp/tstore_changes_page.json"
    cmd = ["curl", "-sS", "-X", "POST", url]
    for h in headers:
        cmd += ["-H", h]
    cmd += ["--data", "", "-o", out, "-w", "HTTP:%{http_code}"]
    status = subprocess.check_output(cmd).decode().strip().replace("HTTP:", "")
    if status != "200":
        raise RuntimeError(f"HTTP {status} for {url}")
    return json.loads(Path(out).read_text())


def update_transactions_html(payload):
    text = HTML_PATH.read_text()
    pattern = re.compile(r"const rawResponse = [\s\S]*?;\n")
    replacement = "const rawResponse = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n"
    new_text, n = pattern.subn(lambda _: replacement, text, count=1)
    if n != 1:
        raise RuntimeError("Failed to replace rawResponse in transactions.html")
    HTML_PATH.write_text(new_text)


def main():
    if not DB_PATH.exists():
        raise RuntimeError(f"DB not found: {DB_PATH}")

    conn = sqlite3.connect(DB_PATH)
    log_id, url, headers_str = get_latest_tstore_log(conn)
    conn.close()

    headers = parse_headers(headers_str)
    params = parse_params(url)
    base_url = url.split("?")[0]

    params["fromTimestamp"] = "0"
    params.setdefault("size", "15")
    params.setdefault("sortOrder", "ASC")

    all_changes = []
    seen_units = set()
    from_ts = 0
    page = 0

    while True:
        page += 1
        params["fromTimestamp"] = str(from_ts)
        page_url = build_url(base_url, params)
        data = fetch_page(page_url, headers)
        changes = (data.get("response") or {}).get("changes") or []
        if not changes:
            break

        max_created = None
        for ch in changes:
            unit_id = ch.get("unitId")
            if unit_id and unit_id not in seen_units:
                all_changes.append(ch)
                seen_units.add(unit_id)
            created = ch.get("createdAt")
            if isinstance(created, int):
                max_created = created if max_created is None else max(max_created, created)

        if max_created is None:
            break

        from_ts = max_created + 1

        if len(changes) < int(params["size"]):
            break

        time.sleep(PAGE_DELAY_SEC)

    full = {
        "code": 200,
        "time": 0,
        "success": True,
        "response": {
            "size": len(all_changes),
            "changes": all_changes
        }
    }

    OUTPUT_JSON.write_text(json.dumps(full, ensure_ascii=False, indent=2))
    update_transactions_html(full)
    print(f"pages={page} records={len(all_changes)} from log_id={log_id}")


if __name__ == "__main__":
    main()
