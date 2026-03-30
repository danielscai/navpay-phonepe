# Checksum 压测使用说明

## 工具

- 主脚本: `src/services/checksum/scripts/stress_test_checksum.py`
- Shell 入口: `src/services/checksum/scripts/stress_test_checksum.sh`
- 输出目录: `src/services/checksum/run/stress/`

脚本特性：

- 支持自动启动/停止 checksum 服务（`19190`）
- 支持多轮压测（默认 3 轮）
- 支持每轮请求量（默认 10000）
- 输出 JSON 与 Markdown 报告

## 本次执行命令

```bash
src/services/checksum/scripts/stress_test_checksum.sh \
  --rounds 3 \
  --requests-per-round 10000 \
  --concurrency 100 \
  --timeout 0.3
```

## 常用复跑命令

默认参数（3 轮、每轮 1 万）：

```bash
src/services/checksum/scripts/stress_test_checksum.sh
```

自定义并发与超时：

```bash
src/services/checksum/scripts/stress_test_checksum.sh \
  --rounds 3 \
  --requests-per-round 10000 \
  --concurrency 50 \
  --timeout 1.0
```

禁用自动起停（服务需已手动启动）：

```bash
src/services/checksum/scripts/stress_test_checksum.sh --no-auto-start
```

## 报告字段说明

- `throughputRps`: 该轮总请求 / 该轮总耗时
- `successRate`: 以 HTTP 200 且返回 JSON 中 `ok=true` 计成功
- `latencyMs.p50/p95/p99`: 延迟分位统计（毫秒）
- `errors`: 异常类型计数（例如 `timeout`、`URLError`）

