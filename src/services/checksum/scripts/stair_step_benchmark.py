#!/usr/bin/env python3
"""Checksum staircase benchmark with resource usage metrics."""

from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import subprocess
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

DEFAULT_PAYLOAD = {
    "path": "/apis/tstore/v2/units/changes",
    "body": "",
    "uuid": "8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001",
}


@dataclass
class RequestResult:
    latency_ms: float
    status: Optional[int]
    ok: bool
    error: str = ""


def percentile(sorted_values: List[float], q: float) -> float:
    if not sorted_values:
        return 0.0
    if q <= 0:
        return sorted_values[0]
    if q >= 100:
        return sorted_values[-1]
    pos = (len(sorted_values) - 1) * (q / 100.0)
    lo = math.floor(pos)
    hi = math.ceil(pos)
    if lo == hi:
        return sorted_values[lo]
    return sorted_values[lo] * (hi - pos) + sorted_values[hi] * (pos - lo)


def post_once(url: str, body: bytes, timeout_s: float) -> RequestResult:
    start = time.perf_counter()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            raw = resp.read()
            ok = False
            if resp.status == 200:
                try:
                    ok = bool(json.loads(raw.decode("utf-8")).get("ok"))
                except Exception:
                    ok = False
            return RequestResult((time.perf_counter() - start) * 1000, resp.status, ok)
    except urllib.error.HTTPError as e:
        return RequestResult((time.perf_counter() - start) * 1000, e.code, False, f"HTTP_{e.code}")
    except Exception as e:
        return RequestResult((time.perf_counter() - start) * 1000, None, False, type(e).__name__)


def run_round(urls: List[str], requests: int, concurrency: int, timeout_s: float) -> List[RequestResult]:
    body = json.dumps(DEFAULT_PAYLOAD, separators=(",", ":")).encode("utf-8")
    results: List[RequestResult] = []
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        futures = [ex.submit(post_once, urls[i % len(urls)], body, timeout_s) for i in range(requests)]
        for f in as_completed(futures):
            results.append(f.result())
    return results


class ResourceSampler:
    def __init__(self, pids: List[int], interval: float = 1.0):
        self.pids = [p for p in pids if p > 0]
        self.interval = interval
        self._stop = threading.Event()
        self.samples_cpu: List[float] = []
        self.samples_rss_mb: List[float] = []
        self.thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> Dict[str, float]:
        self._stop.set()
        self.thread.join(timeout=5)
        if not self.samples_cpu:
            return {"avgCpuPercent": 0.0, "peakCpuPercent": 0.0, "avgMemMb": 0.0, "peakMemMb": 0.0}
        return {
            "avgCpuPercent": round(statistics.fmean(self.samples_cpu), 2),
            "peakCpuPercent": round(max(self.samples_cpu), 2),
            "avgMemMb": round(statistics.fmean(self.samples_rss_mb), 2),
            "peakMemMb": round(max(self.samples_rss_mb), 2),
        }

    def _run(self) -> None:
        if not self.pids:
            return
        pid_arg = ",".join(str(p) for p in self.pids)
        while not self._stop.is_set():
            try:
                out = subprocess.check_output(["ps", "-o", "%cpu=,rss=", "-p", pid_arg], text=True)
                total_cpu = 0.0
                total_rss_kb = 0.0
                for line in out.splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    parts = line.split()
                    if len(parts) >= 2:
                        total_cpu += float(parts[0])
                        total_rss_kb += float(parts[1])
                self.samples_cpu.append(total_cpu)
                self.samples_rss_mb.append(total_rss_kb / 1024.0)
            except Exception:
                pass
            self._stop.wait(self.interval)


def summarize(results: List[RequestResult], duration_s: float, requests: int, resources: Dict[str, float]) -> Dict[str, object]:
    lat = sorted(r.latency_ms for r in results)
    success = sum(1 for r in results if r.ok)
    failed = len(results) - success
    errors: Dict[str, int] = {}
    for r in results:
        if r.error:
            errors[r.error] = errors.get(r.error, 0) + 1
    return {
        "requests": requests,
        "durationSeconds": round(duration_s, 3),
        "throughputRps": round((requests / duration_s) if duration_s > 0 else 0, 2),
        "success": success,
        "failed": failed,
        "successRate": round((success / requests) * 100.0, 2) if requests else 0.0,
        "latencyMs": {
            "p50": round(percentile(lat, 50), 2),
            "p95": round(percentile(lat, 95), 2),
            "p99": round(percentile(lat, 99), 2),
            "max": round(lat[-1], 2) if lat else 0.0,
        },
        "resources": resources,
        "errors": errors,
    }


def ensure_services(root: Path, ports: List[int]) -> List[int]:
    started: List[int] = []
    start_script = root / "src/services/checksum/scripts/start_http_service.sh"
    for p in ports:
        env = os.environ.copy()
        env["CHECKSUM_HTTP_PORT"] = str(p)
        env["CHECKSUM_HTTP_WORKERS"] = "1"
        subprocess.run([str(start_script)], cwd=str(root), env=env, check=True)
        started.append(p)
    return started


def service_pids(root: Path, ports: List[int]) -> List[int]:
    out: List[int] = []
    for p in ports:
        pid_file = root / f"src/services/checksum/run/checksum-http-{p}.pid"
        if pid_file.exists():
            try:
                out.append(int(pid_file.read_text(encoding="utf-8").strip()))
            except Exception:
                pass
    return out


def stop_services(root: Path, ports: List[int]) -> None:
    stop_script = root / "src/services/checksum/scripts/stop_http_service.sh"
    for p in ports:
        env = os.environ.copy()
        env["CHECKSUM_HTTP_PORT"] = str(p)
        subprocess.run([str(stop_script)], cwd=str(root), env=env, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ports", default="19210,19211")
    parser.add_argument("--start", type=int, default=100)
    parser.add_argument("--multiplier", type=float, default=2.0)
    parser.add_argument("--max-rounds", type=int, default=8)
    parser.add_argument("--target-seconds", type=float, default=180.0)
    parser.add_argument("--concurrency", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--output-dir", default="src/services/checksum/run/stress")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[4]
    ports = [int(x.strip()) for x in args.ports.split(",") if x.strip()]
    urls = [f"http://127.0.0.1:{p}/checksum" for p in ports]

    out_dir = (root / args.output_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    json_path = out_dir / f"stair-{ts}.json"
    md_path = out_dir / f"stair-{ts}.md"

    started = ensure_services(root, ports)
    rounds: List[Dict[str, object]] = []
    req_count = args.start

    try:
        for i in range(1, args.max_rounds + 1):
            pids = service_pids(root, ports)
            sampler = ResourceSampler(pids)
            sampler.start()
            t0 = time.perf_counter()
            results = run_round(urls, req_count, args.concurrency, args.timeout)
            elapsed = time.perf_counter() - t0
            resources = sampler.stop()
            stat = summarize(results, elapsed, req_count, resources)
            stat["round"] = i
            rounds.append(stat)

            print(f"[round {i}] requests={req_count} duration={stat['durationSeconds']}s success={stat['success']} failed={stat['failed']} rps={stat['throughputRps']}", flush=True)

            if stat["failed"] > 0 or elapsed > args.target_seconds:
                break
            req_count = max(req_count + 1, int(req_count * args.multiplier))

    finally:
        stop_services(root, started)

    within_target = [r for r in rounds if r["failed"] == 0 and r["durationSeconds"] <= args.target_seconds]
    best = within_target[-1] if within_target else None

    report = {
        "meta": {
            "timestamp": datetime.now().isoformat(timespec="seconds"),
            "ports": ports,
            "concurrency": args.concurrency,
            "timeoutSeconds": args.timeout,
            "targetSeconds": args.target_seconds,
            "jsonPath": str(json_path),
            "mdPath": str(md_path),
        },
        "rounds": rounds,
        "bestWithinTarget": best,
    }

    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# Checksum 阶梯压测报告",
        "",
        f"- 时间: {report['meta']['timestamp']}",
        f"- 端口: {','.join(str(p) for p in ports)}",
        f"- 并发: {args.concurrency}",
        f"- 单轮时长目标: <= {args.target_seconds}s",
        "",
        "| Round | Requests | Duration(s) | Success | Failed | RPS | P95(ms) | CPU Avg(%) | CPU Peak(%) | Mem Avg(MB) | Mem Peak(MB) |",
        "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for r in rounds:
        res = r["resources"]
        lines.append(
            f"| {r['round']} | {r['requests']} | {r['durationSeconds']} | {r['success']} | {r['failed']} | {r['throughputRps']} | {r['latencyMs']['p95']} | {res['avgCpuPercent']} | {res['peakCpuPercent']} | {res['avgMemMb']} | {res['peakMemMb']} |"
        )

    lines.append("")
    if best:
        lines.append("## 3分钟内无报错最大请求量")
        lines.append("")
        lines.append(f"- round: {best['round']}")
        lines.append(f"- requests: {best['requests']}")
        lines.append(f"- duration: {best['durationSeconds']}s")
        lines.append(f"- successRate: {best['successRate']}%")
    else:
        lines.append("## 3分钟内无报错最大请求量")
        lines.append("")
        lines.append("- 未找到满足条件的轮次")

    lines.append("")
    lines.append("## 产物")
    lines.append("")
    lines.append(f"- JSON: `{json_path}`")
    lines.append(f"- Markdown: `{md_path}`")

    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"[report] {json_path}")
    print(f"[report] {md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
