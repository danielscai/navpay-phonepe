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
- 返回结构成功的 checksum

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

当前正式服务使用“结构成功”标准，而不是“与真实 app 进程完全同值”。

建议其他模块这样判断：

- `ok == true`
- `data.structureOk == true`
- 再取 `data.checksum`

如果只拿 `checksum` 而不检查 `structureOk`，调用方很难分辨异常输出和正常输出。

## 推荐实践

- 把 `src/services/checksum/runtime/manifest.json` 当成当前 runtime 的来源记录
- 所有调用方统一访问 `127.0.0.1:19190`
- 显式传入 `uuid`，便于问题复现
- 先调 `/health`，再调 `/checksum`
- 把 `structureOk` 当成调用成功条件之一

## 相关文档

- 正式模块说明：[src/services/checksum/README.md](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/services/checksum/README.md)
- 技术原理：[src/services/checksum/TECHNICAL.md](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/services/checksum/TECHNICAL.md)
- 方案 3 解决过程：[docs/checksum_service_scheme3_solution.md](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/docs/checksum_service_scheme3_solution.md)
