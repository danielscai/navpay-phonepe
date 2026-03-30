#!/usr/bin/env python3
"""Checksum HTTP service stress tester.

Runs configurable rounds of POST /checksum load tests and writes
JSON reports plus a Markdown summary for repeatable local benchmarking.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple


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
    lower = math.floor(pos)
    upper = math.ceil(pos)
    if lower == upper:
        return sorted_values[lower]
    weight = pos - lower
    return sorted_values[lower] * (1.0 - weight) + sorted_values[upper] * weight


def summarize(results: List[RequestResult], duration_s: float, round_id: int, requests: int, concurrency: int) -> Dict[str, object]:
    latencies = sorted(r.latency_ms for r in results)
    success = sum(1 for r in results if r.ok)
    failed = len(results) - success
    status_counts: Dict[str, int] = {}
    error_counts: Dict[str, int] = {}

    for r in results:
        if r.status is not None:
            key = str(r.status)
            status_counts[key] = status_counts.get(key, 0) + 1
        if r.error:
            error_counts[r.error] = error_counts.get(r.error, 0) + 1

    return {
        "round": round_id,
        "requests": requests,
        "concurrency": concurrency,
        "durationSeconds": round(duration_s, 3),
        "throughputRps": round(len(results) / duration_s, 2) if duration_s > 0 else 0,
        "success": success,
        "failed": failed,
        "successRate": round((success / len(results)) * 100.0, 2) if results else 0,
        "latencyMs": {
            "min": round(latencies[0], 2) if latencies else 0,
            "max": round(latencies[-1], 2) if latencies else 0,
            "mean": round(statistics.fmean(latencies), 2) if latencies else 0,
            "p50": round(percentile(latencies, 50), 2),
            "p90": round(percentile(latencies, 90), 2),
            "p95": round(percentile(latencies, 95), 2),
            "p99": round(percentile(latencies, 99), 2),
        },
        "statusCodes": status_counts,
        "errors": error_counts,
    }


def post_once(url: str, body: bytes, timeout_s: float) -> RequestResult:
    start = time.perf_counter()
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            payload = resp.read()
            ok = False
            if resp.status == 200:
                try:
                    parsed = json.loads(payload.decode("utf-8"))
                    ok = bool(parsed.get("ok"))
                except Exception:
                    ok = False
            return RequestResult(
                latency_ms=(time.perf_counter() - start) * 1000,
                status=resp.status,
                ok=ok,
                error="",
            )
    except urllib.error.HTTPError as e:
        return RequestResult(
            latency_ms=(time.perf_counter() - start) * 1000,
            status=e.code,
            ok=False,
            error=f"HTTP_{e.code}",
        )
    except Exception as e:
        return RequestResult(
            latency_ms=(time.perf_counter() - start) * 1000,
            status=None,
            ok=False,
            error=type(e).__name__,
        )


def run_round(urls: List[str], requests: int, concurrency: int, timeout_s: float, payload: Dict[str, str]) -> Tuple[List[RequestResult], float]:
    payload_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    results: List[RequestResult] = []
    lock = threading.Lock()
    started = time.perf_counter()

    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        futures = []
        url_count = len(urls)
        for i in range(requests):
            futures.append(ex.submit(post_once, urls[i % url_count], payload_bytes, timeout_s))
        for future in as_completed(futures):
            result = future.result()
            with lock:
                results.append(result)

    duration = time.perf_counter() - started
    return results, duration


def ensure_service(base_url: str, root_dir: Path, port: int, service_workers: int) -> bool:
    health_url = f"{base_url}/health"
    req = urllib.request.Request(health_url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=2):
            return False
    except Exception:
        pass

    start_script = root_dir / "src/services/checksum/scripts/start_http_service.sh"
    env = os.environ.copy()
    env["CHECKSUM_HTTP_PORT"] = str(port)
    env["CHECKSUM_HTTP_WORKERS"] = str(max(1, service_workers))
    subprocess.run([str(start_script)], cwd=str(root_dir), env=env, check=True)
    time.sleep(1)
    return True


def stop_service_if_needed(root_dir: Path, port: int, should_stop: bool) -> None:
    if not should_stop:
        return
    stop_script = root_dir / "src/services/checksum/scripts/stop_http_service.sh"
    env = os.environ.copy()
    env["CHECKSUM_HTTP_PORT"] = str(port)
    subprocess.run([str(stop_script)], cwd=str(root_dir), env=env, check=False)


def markdown_report(report: Dict[str, object]) -> str:
    lines = []
    meta = report["meta"]
    lines.append("# Checksum 压测报告")
    lines.append("")
    lines.append(f"- 时间: {meta['timestamp']}")
    lines.append(f"- 目标: {meta['url']}")
    lines.append(f"- 轮次: {meta['rounds']}")
    lines.append(f"- 每轮请求数: {meta['requestsPerRound']}")
    lines.append(f"- 并发: {meta['concurrency']}")
    lines.append(f"- 超时: {meta['timeoutSeconds']}s")
    lines.append("")
    lines.append("## 每轮统计")
    lines.append("")
    lines.append("| Round | Success | Failed | Success Rate | Duration(s) | RPS | P50(ms) | P95(ms) | P99(ms) | Max(ms) |")
    lines.append("|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for r in report["rounds"]:
        lat = r["latencyMs"]
        lines.append(
            "| {round} | {success} | {failed} | {successRate}% | {durationSeconds} | {throughputRps} | {p50} | {p95} | {p99} | {maxv} |".format(
                round=r["round"],
                success=r["success"],
                failed=r["failed"],
                successRate=r["successRate"],
                durationSeconds=r["durationSeconds"],
                throughputRps=r["throughputRps"],
                p50=lat["p50"],
                p95=lat["p95"],
                p99=lat["p99"],
                maxv=lat["max"],
            )
        )

    agg = report["aggregate"]
    lines.append("")
    lines.append("## 汇总")
    lines.append("")
    lines.append(f"- 总请求: {agg['totalRequests']}")
    lines.append(f"- 总成功: {agg['success']}")
    lines.append(f"- 总失败: {agg['failed']}")
    lines.append(f"- 总体成功率: {agg['successRate']}%")
    lines.append(f"- 总耗时: {agg['durationSeconds']}s")
    lines.append(f"- 平均吞吐: {agg['throughputRps']} req/s")
    lines.append(f"- 聚合 P95 延迟: {agg['latencyMs']['p95']} ms")
    lines.append(f"- 聚合 P99 延迟: {agg['latencyMs']['p99']} ms")
    lines.append("")
    lines.append("## 状态码分布")
    lines.append("")
    for code, count in sorted(agg["statusCodes"].items(), key=lambda kv: kv[0]):
        lines.append(f"- HTTP {code}: {count}")

    if agg["errors"]:
        lines.append("")
        lines.append("## 错误分布")
        lines.append("")
        for err, count in sorted(agg["errors"].items(), key=lambda kv: kv[1], reverse=True):
            lines.append(f"- {err}: {count}")

    lines.append("")
    lines.append("## 产物")
    lines.append("")
    lines.append(f"- JSON 明细: `{meta['jsonPath']}`")
    lines.append(f"- Markdown 报告: `{meta['mdPath']}`")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Stress test checksum service")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=19190)
    parser.add_argument("--ports", default="")
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--requests-per-round", type=int, default=10000)
    parser.add_argument("--concurrency", type=int, default=80)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--service-workers", type=int, default=1)
    parser.add_argument("--output-dir", default="src/services/checksum/run/stress")
    parser.add_argument("--auto-start", action="store_true", default=True)
    parser.add_argument("--no-auto-start", dest="auto_start", action="store_false")
    args = parser.parse_args()

    root_dir = Path(__file__).resolve().parents[4]
    output_dir = (root_dir / args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    ports: List[int]
    if args.ports.strip():
        ports = [int(p.strip()) for p in args.ports.split(",") if p.strip()]
    else:
        ports = [args.port]

    checksum_urls = [f"http://{args.host}:{p}/checksum" for p in ports]
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    json_path = output_dir / f"stress-{timestamp}.json"
    md_path = output_dir / f"stress-{timestamp}.md"

    started_ports: List[int] = []
    if args.auto_start:
        for port in ports:
            base_url = f"http://{args.host}:{port}"
            if ensure_service(base_url, root_dir, port, args.service_workers):
                started_ports.append(port)

    round_reports: List[Dict[str, object]] = []
    all_results: List[RequestResult] = []
    total_start = time.perf_counter()

    try:
        for r in range(1, args.rounds + 1):
            print(f"[run] round={r} requests={args.requests_per_round} concurrency={args.concurrency}", flush=True)
            results, duration = run_round(
                urls=checksum_urls,
                requests=args.requests_per_round,
                concurrency=args.concurrency,
                timeout_s=args.timeout,
                payload=DEFAULT_PAYLOAD,
            )
            summary = summarize(results, duration, r, args.requests_per_round, args.concurrency)
            round_reports.append(summary)
            all_results.extend(results)
            print(
                "[done] round={round} success={success} failed={failed} rps={rps} p95={p95}ms".format(
                    round=summary["round"],
                    success=summary["success"],
                    failed=summary["failed"],
                    rps=summary["throughputRps"],
                    p95=summary["latencyMs"]["p95"],
                ),
                flush=True,
            )

        total_duration = time.perf_counter() - total_start
        aggregate = summarize(
            all_results,
            total_duration,
            round_id=0,
            requests=len(all_results),
            concurrency=args.concurrency,
        )
        aggregate = {
            "totalRequests": len(all_results),
            "success": aggregate["success"],
            "failed": aggregate["failed"],
            "successRate": aggregate["successRate"],
            "durationSeconds": aggregate["durationSeconds"],
            "throughputRps": aggregate["throughputRps"],
            "latencyMs": aggregate["latencyMs"],
            "statusCodes": aggregate["statusCodes"],
            "errors": aggregate["errors"],
        }

        report = {
            "meta": {
                "timestamp": datetime.now().isoformat(timespec="seconds"),
                "url": checksum_urls[0] if len(checksum_urls) == 1 else ",".join(checksum_urls),
                "ports": ports,
                "rounds": args.rounds,
                "requestsPerRound": args.requests_per_round,
                "concurrency": args.concurrency,
                "timeoutSeconds": args.timeout,
                "serviceWorkers": args.service_workers,
                "autoStartedPorts": started_ports,
                "jsonPath": str(json_path),
                "mdPath": str(md_path),
            },
            "rounds": round_reports,
            "aggregate": aggregate,
        }

        json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        md_path.write_text(markdown_report(report), encoding="utf-8")
        print(f"[report] {json_path}")
        print(f"[report] {md_path}")

    finally:
        for port in started_ports:
            stop_service_if_needed(root_dir, port, True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
