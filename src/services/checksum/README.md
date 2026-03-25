# Checksum Service

正式的 Scheme 3 checksum 服务模块。

## Runtime Bundle

`src/services/checksum/runtime/` 是 checksum 服务的本地运行时目录。

目录内会保留：

- `manifest.json`
- `signature.bin`
- `lib/arm64-v8a/libphonepe-cryptography-support-lib.so`
- `lib/arm64-v8a/liba41935.so`
- `lib/arm64-v8a/libc++_shared.so`

后续会通过单独的初始化步骤把这些文件从 APK 提取出来。默认启动路径将优先依赖这个 runtime 目录，而不是在每次启动时重新读取 APK。

## What It Does

- 使用 `unidbg` 调用 `EncryptionUtils.nmcs(...)`
- 暴露本地 HTTP 服务
- 返回结构成功的 checksum
- 提供一键脚本验证

默认监听：

- `127.0.0.1:19190`

## Commands

初始化 runtime：

```bash
yarn checksum:init /absolute/path/to/com.phonepe.app_merged_signed.apk
```

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

APK 更新后的推荐流程：

1. 重新运行 `yarn checksum:init /absolute/path/to/com.phonepe.app_merged_signed.apk`
2. 检查 `src/services/checksum/runtime/manifest.json`
3. 运行 `yarn checksum:test` 或 `cd src/services/checksum && mvn test`

项目级接入文档：

- [docs/checksum_service_integration.md](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/docs/checksum_service_integration.md)

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

## Real-Log Validation

本模块已经用一条真实的 `navpay-admin` 拦截日志做过 real-fixture 验证。

- 样本来源：`navpay-admin` 日志 `654`
- 请求形态：真实 `phonepe` `POST`
- 真实头字段：`X-REQUEST-CHECKMATE`
- 验证目标：确认 `19190` 的 checksum 服务可以用真实的 `path` 和 `body` 返回 `structureOk=true`

复跑流程：

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/services/checksum
bash scripts/validate_real_fixture.sh
```

这个命令会：

- 读取 `src/test/resources/fixtures/phonepe_intercept_replay.json`
- 调用 `127.0.0.1:19190/checksum`
- 将稳定的校验结果与 `src/test/resources/fixtures/phonepe_intercept_replay.expected.json` 比对

如果你要更新期望快照，只在明确需要时使用：

```bash
UPDATE_REAL_FIXTURE=1 bash scripts/validate_real_fixture.sh
```

只建议在重新确认真实样本后使用这个更新模式。

## Files

- Java 服务入口：`src/main/java/com/navpay/phonepe/unidbg/ChecksumHttpService.java`
- probe：`src/main/java/com/navpay/phonepe/unidbg/UnidbgChecksumProbe.java`
- runtime 初始化器：`src/main/java/com/navpay/phonepe/unidbg/ChecksumRuntimeInitializer.java`
- 启动脚本：`scripts/start_http_service.sh`
- runtime 初始化脚本：`scripts/init_runtime.sh`
- 测试脚本：`scripts/test_http_service.sh`
- 技术说明：`TECHNICAL.md`
