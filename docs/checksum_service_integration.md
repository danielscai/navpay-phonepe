# Checksum Service 接入文档

## 目标

给仓库内其他模块提供统一的 checksum 服务调用方式。

当前正式服务模块：

- [src/services/checksum](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/services/checksum)

推荐使用这个服务，不要直接依赖 research 目录脚本。

## 服务设计

该服务是一个本地 HTTP 服务，内部使用 `unidbg` 调用 `EncryptionUtils.nmcs(...)`。

核心设计：

- 对外暴露稳定的 HTTP 接口
- 对内封装 native 调用细节
- 默认使用 `CH emulate` 模式
- 优先读取 runtime 目录中的原始 app runtime 快照
- 以真实 replay 返回 `HTTP 200` 作为最终验收标准

默认监听地址：

- `127.0.0.1:19190`

## 启动方式

首次或 APK 更新后，先初始化 runtime：

```bash
yarn checksum:init /absolute/path/to/patched_signed.apk
```

启动正式 checksum 服务：

```bash
yarn checksum:start
```

测试正式 checksum 服务：

```bash
yarn checksum:test
```

旧的 Android 进程内 helper 服务保留为：

```bash
yarn checksum:android:start
```

它监听 `127.0.0.1:19090`，属于旧链路，不是当前推荐入口。

## HTTP 接口

### 1. 健康检查

```bash
curl -sS http://127.0.0.1:19190/health
```

响应示例：

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "mode": "emulate",
    "port": 19190
  }
}
```

### 2. 生成 checksum

```bash
curl -sS http://127.0.0.1:19190/checksum \
  -H 'Content-Type: application/json' \
  -d '{"path":"/apis/tstore/v2/units/changes","body":"","uuid":"8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001"}'
```

请求字段：

- `path`：必填，必须是 encoded path，不带 query
- `body`：可选，默认空字符串
- `uuid`：可选，建议显式传入，便于复现

响应字段：

- `checksum`
- `length`
- `decodedLength`
- `mode`
- `structureOk`
- `asciiLike`
- `hyphenCount`
- `decodedPreview`
- `generatedAt`

兼容性说明：

- `body` 字段会按标准 JSON 反转义处理（包含 `\uXXXX`、`\/`、`\n`、`\t` 等）
- replay 真实日志时请直接透传 JSON 字符串，不要提前手工改写转义字符

### 3. 结构校验

```bash
curl -sS http://127.0.0.1:19190/validate \
  -H 'Content-Type: application/json' \
  -d '{"path":"/apis/tstore/v2/units/changes","body":"","uuid":"8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001"}'
```

用途：

- 检查当前输出是否满足结构成功标准
- 可用于其他模块在联调时快速验收

## 真实日志验证

为了确认新服务能处理真实拦截日志，我们已经用 `navpay-admin` 的一条真实记录做过验证。

- 日志 ID：`654`
- 来源：`phonepe`
- 真实头字段：`X-REQUEST-CHECKMATE`
- 结论：`19190` 服务可以基于真实 `path` 和 `body` 返回 `structureOk=true`

复跑命令：

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/services/checksum
bash scripts/validate_real_fixture.sh
```

这个脚本默认执行验证，不会改写快照。若必须刷新期望结果，再显式加：

```bash
UPDATE_REAL_FIXTURE=1 bash scripts/validate_real_fixture.sh
```

推荐把它当作 checksum 服务的真实数据回归，而不是一次性的手工检查。

建议在每次修改解析逻辑后额外执行：

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/services/checksum
mvn -Dtest=ChecksumHttpServiceJsonParsingTest,ChecksumHttpServiceRealFixtureTest test
```

## 其他模块怎么调用

最简单的调用方式是直接发 HTTP 请求。

### Node.js 示例

```js
const response = await fetch('http://127.0.0.1:19190/checksum', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    path: '/apis/tstore/v2/units/changes',
    body: '',
    uuid: '8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001'
  })
});

const json = await response.json();
if (!json.ok || !json.data || !json.data.structureOk) {
  throw new Error('checksum service failed');
}

const checksum = json.data.checksum;
```

### shell 示例

```bash
checksum="$(curl -sS http://127.0.0.1:19190/checksum \
  -H 'Content-Type: application/json' \
  -d '{"path":"/apis/tstore/v2/units/changes","body":"","uuid":"8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001"}' \
  | python3 -c 'import sys, json; print(json.load(sys.stdin)["data"]["checksum"])')"
```

## 成功判据

`/checksum` 的本地结构校验仍然有价值，但它不是最终验收标准。

调用方本地可先检查：

- `ok == true`
- `data.structureOk == true`
- 再取 `data.checksum`

但最终是否通过，仍以 replay 到目标服务器后的 `HTTP 200` 为准。

## 端到端验收标准（Replay）

对于 `intercept_logs` 重放场景，最终验收标准统一为：

- 使用某个 checksum 服务端口（如 `19090` 或 `19190`）生成 checksum
- 将该 checksum 注入重放请求头后发往目标服务器
- 以目标服务器返回 `HTTP 200` 作为通过标准

注意：

- 不要求 `19090` 与 `19190` 输出的 checksum 字符串完全一致
- 是否通过以“目标服务器是否返回 200”为唯一判定依据
- 当前 V4 replay 输入按 `path` 传 `request.url().encodedPath()` 语义处理，不带 query
- 2026-03-27 实测样本：`/apis/tstore/v2/units/changes?...`
  - 传 `pathname` 给 `19090`，重放返回 `HTTP 200`
  - 传 `pathname` 给 `19190`，重放返回 `HTTP 200`
  - 传 `pathname + query` 给 `19090`，重放返回 `HTTP 400`
  - 因此当前正式接入应继续使用不带 query 的 `path`

## 推荐实践

- 把 `src/services/checksum/runtime/manifest.json` 当成当前 runtime 的来源记录
- runtime 初始化时要区分两类 APK：
  - `sourceApk`：供 DalvikVM 载入的 merged/repacked 可运行 APK
  - `signatureSourceApk`：供 `signature.bin` 提取的原始 PhonePe APK
- `signatureSourceApk` 不能指向 debug/repacked APK，否则会把调试证书喂给 `Signature->toByteArray()` stub
- 若已从原始 app 获取 `/debug/runtime`，把关键字段落到 `src/services/checksum/runtime/runtime_snapshot.json`
- `runtime_snapshot.json` 至少应包含：
  - `deviceId`
  - `serverTimeOffsetMs`
  - `adjustedTimeMs`（仅作观测；运行时应优先按 `currentTimeMillis + serverTimeOffsetMs` 计算）
- 所有调用方统一访问 `127.0.0.1:19190`
- 显式传入 `uuid`，便于问题复现
- 先调 `/health`，再调 `/checksum`
- 把 `structureOk` 当成调用成功条件之一

## 当前实现状态（2026-03-27）

`19190` 已补齐并验证的原始语义：

- 标准 JSON 反转义
- `NativeLibraryLoader.h2()` 初始化
- business `deviceId` 读取
- `serverTimeOffsetMs` 时间语义
- DalvikVM 优先载入 runtime manifest 指向的真实 APK
- `EncryptionUtils.jnmcs(context, ...)` 包装链
- 原始 PhonePe APK 证书字节作为 `signature.bin`

本轮最终修复的根因：

- `19190` 之前把 `signature.bin` 错误地取自 merged debug APK，指纹是 `c57335...`
- 真实运行时需要的是原始 PhonePe APK 的签名身份，指纹是 `5335bc...`
- 将 runtime 初始化改为“VM APK 和 signature source APK 分离”后，`19190` 已通过真实 V4 replay 验收

## 相关文档

- 正式模块说明：[src/services/checksum/README.md](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/services/checksum/README.md)
- 技术原理：[src/services/checksum/TECHNICAL.md](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/services/checksum/TECHNICAL.md)
- 方案 3 解决过程：[docs/checksum_service_scheme3_solution.md](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/docs/checksum_service_scheme3_solution.md)
