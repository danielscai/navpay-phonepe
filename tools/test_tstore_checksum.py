#!/usr/bin/env python3
import argparse
import json
import sqlite3
import sys
import subprocess
import time


DB_PATH = "src/log_server/data/logs.db"
CHECKSUM_PATH = "/apis/tstore/v2/units/changes"


def fetch_checksum(payload):
    body = json.dumps(payload)
    host = "http://127.0.0.1:8088/api/checksum"
    last_err = None
    for _ in range(5):
        try:
            proc = subprocess.run(
                [
                    "curl",
                    "-sS",
                    "-X",
                    "POST",
                    host,
                    "-H",
                    "Content-Type: application/json",
                    "-d",
                    body,
                ],
                text=True,
                capture_output=True,
            )
            if proc.returncode == 0 and proc.stdout.strip():
                data = json.loads(proc.stdout)
                return data["data"]["checksum"], data["data"].get("uuid")
            last_err = proc.stderr.strip() or f"curl exit {proc.returncode}"
        except Exception as exc:
            last_err = exc
        time.sleep(0.1)
    raise RuntimeError(f"checksum fetch failed: {last_err}")


def get_latest_tstore_log():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    cur.execute(
        """
        SELECT id, url, request_headers
        FROM http_logs
        WHERE url LIKE '%/apis/tstore/v2/units/changes%'
        ORDER BY id DESC
        LIMIT 1;
        """
    )
    row = cur.fetchone()
    if not row:
        raise RuntimeError("no tstore log found")
    return row["id"], row["url"], row["request_headers"] or ""


def parse_headers(raw):
    headers = {}
    for line in raw.splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        headers[k.strip()] = v.strip()
    return headers


def do_tstore_request(url, headers, checksum):
    want = [
        "Authorization",
        "X-ORG-ID",
        "X-FARM-REQUEST-ID",
        "x-farm-id",
        "Content-Type",
        "accept",
        "X-BOLT-ENC-PROTOCOL",
        "X-SOURCE-TYPE",
        "X-SOURCE-PLATFORM",
        "X-SOURCE-VERSION",
        "X-MERCHANT-ID",
        "X-APP-ID",
        "X-DG-CA",
        "X-SOURCE-LOCALE",
        "X-REQUEST-ALIAS",
        "X-REQUEST-START-TIME",
    ]
    req_headers = {k: headers[k] for k in want if k in headers}
    req_headers["X-REQUEST-CHECKSUM-V4"] = checksum
    args = ["curl", "-sS", "-D", "-", "-o", "/dev/null", "-X", "POST", url]
    for k, v in req_headers.items():
        args += ["-H", f"{k}: {v}"]
    try:
        out = subprocess.check_output(args, text=True)
    except subprocess.CalledProcessError as e:
        out = e.output or ""
    status = None
    resp_headers = {}
    for line in out.splitlines():
        if line.startswith("HTTP/"):
            try:
                status = int(line.split()[1])
            except Exception:
                pass
        if ":" in line:
            k, v = line.split(":", 1)
            resp_headers[k.strip().lower()] = v.strip()
    body = ""
    print(f"status: {status}")
    if "x-api-exception-code" in resp_headers:
        print(f"x-api-exception-code: {resp_headers['x-api-exception-code']}")
    if "x-expired-tokens" in resp_headers:
        print(f"x-expired-tokens: {resp_headers['x-expired-tokens']}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checksum-only", action="store_true")
    parser.add_argument("--path", default=CHECKSUM_PATH)
    parser.add_argument("--body", default="")
    args = parser.parse_args()

    checksum, uuid = fetch_checksum({"path": args.path, "body": args.body})
    print(f"checksum: {checksum}")
    if uuid:
        print(f"uuid: {uuid}")

    if args.checksum_only:
        return

    log_id, url, raw_headers = get_latest_tstore_log()
    headers = parse_headers(raw_headers)
    print(f"tstore_log_id: {log_id}")
    print(f"url: {url}")
    do_tstore_request(url, headers, checksum)


if __name__ == "__main__":
    main()
