#!/usr/bin/env python3
import argparse
import json
import sys
import urllib.request


def post_json(url, payload):
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", default="/apis/tstore/v2/units/changes")
    parser.add_argument("--body", default="")
    parser.add_argument("--uuid", default="")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=19090, type=int)
    args = parser.parse_args()

    url = f"http://{args.host}:{args.port}/checksum"
    payload = {"path": args.path, "body": args.body, "uuid": args.uuid}
    data = post_json(url, payload)
    print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
