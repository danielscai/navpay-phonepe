# Checksum Service

正式的 Scheme 3 checksum 服务模块。

## What It Does

- 使用 `unidbg` 调用 `EncryptionUtils.nmcs(...)`
- 暴露本地 HTTP 服务
- 返回结构成功的 checksum
- 提供一键脚本验证

默认监听：

- `127.0.0.1:19190`

## Commands

启动服务：

```bash
yarn checksum:start
```

测试服务：

```bash
yarn checksum:test
```

保留旧的 Android 进程内 helper 启动方式：

```bash
yarn checksum:android:start
```

## HTTP API

### `GET /health`

```bash
curl -sS http://127.0.0.1:19190/health
```

### `POST /checksum`

```bash
curl -sS http://127.0.0.1:19190/checksum \
  -H 'Content-Type: application/json' \
  -d '{"path":"/apis/tstore/v2/units/changes","body":"","uuid":"8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001"}'
```

### `POST /validate`

```bash
curl -sS http://127.0.0.1:19190/validate \
  -H 'Content-Type: application/json' \
  -d '{"path":"/apis/tstore/v2/units/changes","body":"","uuid":"8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001"}'
```

## Success Rule

当前服务按“结构成功”判定，不要求与真实 app 进程 checksum 完全同值。

成功条件：

- `ok=true`
- `structureOk=true`
- 返回值为合法 Base64
- 解码后为 ASCII 风格 token 串
- 长度落在当前成功样本区间

## Files

- Java 服务入口：`src/main/java/com/navpay/phonepe/unidbg/ChecksumHttpService.java`
- probe：`src/main/java/com/navpay/phonepe/unidbg/UnidbgChecksumProbe.java`
- 启动脚本：`scripts/start_http_service.sh`
- 测试脚本：`scripts/test_http_service.sh`
- 技术说明：`TECHNICAL.md`
