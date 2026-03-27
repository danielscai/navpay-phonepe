# Checksum Service

正式的 Scheme 3 checksum 服务模块。

## Runtime Bundle

`src/services/checksum/runtime/` 是 checksum 服务的本地运行时目录。

目录内会保留：

- `manifest.json`
- `signature.bin`
- `runtime_snapshot.json`（可选，保存原始 App runtime 的 `deviceId/serverTimeOffsetMs` 快照）
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

如果不显式传第二个参数，初始化脚本会默认把原始签名源设为：

- `samples/PhonePe APK v24.08.23.apk`

也可以手动指定：

```bash
bash src/services/checksum/scripts/init_runtime.sh \
  /absolute/path/to/com.phonepe.app_merged_signed.apk \
  /absolute/path/to/original-phonepe.apk
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

说明：

- `sourceApk` 继续用于 DalvikVM 载入合并后的可运行 APK
- `signatureSourceApk` 必须指向原始 PhonePe APK，而不是本地 debug/repacked APK
- 否则 `Signature->toByteArray()` 语义会偏到调试签名，真实 V4 replay 会失败

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

## Parser Compatibility Note

`/checksum` 和 `/validate` 现在会按标准 JSON 规则反转义请求体字段，包含：

- `\n`、`\r`、`\t`
- `\/`
- `\uXXXX`

这对从 `navpay-admin` 拦截日志导出的 replay payload 是必要的，尤其是 body 中包含 `\u003d` 这类转义时。

回归命令：

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/services/checksum
mvn -Dtest=ChecksumHttpServiceJsonParsingTest,ChecksumHttpServiceRealFixtureTest test
bash scripts/validate_real_fixture.sh
```

## Success Rule

当前正式验收不再以“结构成功”为最终标准。

最终通过条件：

- 使用该服务生成 checksum
- 将 checksum 注入真实 replay 请求头
- 目标服务器返回 `HTTP 200`

补充说明：

- `structureOk=true` 仍然保留，用作本地结构回归信号
- 但它不能替代真实 replay 验收
- `19090` 和 `19190` checksum 字符串不要求一致

## Real-Log Validation

本模块保留两类验证：

1. 结构回归：
   - 真实 fixture 走 `/checksum`
   - 验证 JSON parser 和输出结构稳定
2. 端到端 replay：
   - 用生成出的 checksum 重放到真实目标服务器
   - 以 `HTTP 200` 为唯一通过标准

当前已验证的真实 V4 样本：

- `navpay-admin` 日志 `1226`
- 真实头字段：`X-REQUEST-CHECKSUM-V4`
- `path` 取 `pathname`，不带 query
- 当前结果：
  - `19090` replay => `HTTP 200`
  - `19190` replay => `HTTP 200`

根因结论：

- `19190` 之前失败，不是 `nmcs/jnmcs` 主链路没跑通，而是 runtime 初始化把 `signature.bin` 错误地取自 merged debug APK
- 该签名指纹是 `c57335...`
- 真实 PhonePe 原始包签名指纹应为 `5335bc...`
- 将 `signature.bin` 改为原始 PhonePe APK 证书字节后，`19190` 的真实 V4 replay 恢复为 `HTTP 200`

当前已验证的旧样本 fixture：

- `navpay-admin` 日志 `654`
- 真实头字段：`X-REQUEST-CHECKMATE`
- 用于结构回归，不作为 V4 端到端通过依据

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
