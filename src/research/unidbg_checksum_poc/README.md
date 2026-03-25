# unidbg checksum feasibility PoC

目标：验证 `方案3（unidbg）` 是否能在当前目标 APK（默认 `cache/profiles/full/build/patched_signed.apk`）下直接跑通 `EncryptionUtils.nmcs` 并产出 checksum。

当前默认模式已经切到 `CH emulate`，即直接运行脚本会优先产出接近真实结构的 Base64 checksum，而不是旧的 `passthrough` 模板串。

## HTTP service

启动本地 HTTP 服务：

```bash
src/research/unidbg_checksum_poc/scripts/start_http_service.sh
```

默认监听：`127.0.0.1:19190`

健康检查：

```bash
curl -sS http://127.0.0.1:19190/health
```

生成 checksum：

```bash
curl -sS http://127.0.0.1:19190/checksum \
  -H 'Content-Type: application/json' \
  -d '{"path":"/apis/tstore/v2/units/changes","body":"","uuid":"8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001"}'
```

返回字段：

- `checksum`
- `length`
- `decodedLength`
- `mode`
- `structureOk`
- `decodedPreview`

结构校验：

```bash
curl -sS http://127.0.0.1:19190/validate \
  -H 'Content-Type: application/json' \
  -d '{"path":"/apis/tstore/v2/units/changes","body":"","uuid":"8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001"}'
```

一键烟测：

```bash
src/research/unidbg_checksum_poc/scripts/test_http_service.sh
yarn checksum:test
```

## 快速执行

```bash
src/research/unidbg_checksum_poc/scripts/verify_feasibility.sh
```

对比真实服务与 unidbg 输出：

```bash
src/research/unidbg_checksum_poc/scripts/compare_with_live.sh
```

可选参数：

```bash
src/research/unidbg_checksum_poc/scripts/verify_feasibility.sh <path> <uuid> [body] [apk]
src/research/unidbg_checksum_poc/scripts/compare_with_live.sh <path> <uuid> [body] [apk]
```

输出日志：`cache/unidbg_probe/results/*.log`

## 判定标准

- 任一 probe 出现 `result=PASS` 且输出 `checksum=...`，判定 `IMPLEMENTABLE=YES`。
- 全部 probe 失败，判定 `IMPLEMENTABLE=NO`。

## 当前默认目标的已知结果（patched_signed）

- `libphonepe-cryptography-support-lib.so`：可作为 ELF 加载，且 `nmcs` 可直接调用。
- `liba41935.so`：`JNI_OnLoad` 成功，但不直接注册 `nmcs([B[B[BLjava/lang/Object;)[B`。

这说明当前问题已经不再是“找不到 `nmcs` 入口”，而是进入 `nmcs -> newChecksumSecure(...)` 之后的运行时依赖还没有被真实还原。
