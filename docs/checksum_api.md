# Checksum 接口调用文档

> 当前项目的正式 checksum 服务已经迁移到 `src/services/checksum`，推荐优先阅读：
> [docs/checksum_service_integration.md](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/docs/checksum_service_integration.md)

本地 `checksum.html` 页面通过 `log_server` 代理调用 APK 内的 checksum 服务，流程如下：

1. 浏览器访问 `http://127.0.0.1:8088/checksum.html`
2. 前端调用 `POST /api/checksum`
3. `log_server` 代理转发到 `http://127.0.0.1:19090/checksum`（phonepehelper 在 App 进程内启动）

## 1) 前端调用 (checksum.html)

**接口**: `POST /api/checksum`  
**请求体**:
```json
{
  "path": "/apis/tstore/v2/units/changes",
  "body": "",
  "uuid": ""
}
```

- `path` 必填，必须是 **encodedPath**（不包含 query）
- `body` 可选（原始字符串，默认 `""`）
- `uuid` 可选（为空则由服务端生成）

**响应体**:
```json
{
  "success": true,
  "data": {
    "checksum": "<value>",
    "uuid": "<uuid>"
  }
}
```

## 2) log_server 代理

`src/services/log_server/src/server.js`:

```
POST /api/checksum
  -> fetch("http://127.0.0.1:19090/checksum")
```

请求体和响应体不变，仅做转发。

## 3) APK 内 checksum 服务

**接口**: `POST http://127.0.0.1:19090/checksum`  
**请求体**:
```json
{
  "path": "/apis/tstore/v2/units/changes",
  "body": "",
  "uuid": ""
}
```

**响应体**:
```json
{
  "ok": true,
  "data": {
    "checksum": "<value>",
    "uuid": "<uuid>"
  }
}
```

## 4) 健康检查

**接口**: `GET http://127.0.0.1:19090/health`
```json
{ "ok": true, "data": { "status": "ok" } }
```

## 5) 说明

- checksum 由 App 进程内的 `EncryptionUtils.jnmcs(...)` 生成。
- 必须传 **encodedPath**，不要带 query 参数。

## 6) 正式服务说明

上面这份文档描述的是旧的 Android helper 链路：

- `127.0.0.1:19090`
- App 进程内 `phonepehelper`

当前仓库内正式推荐的 checksum 服务是：

- `127.0.0.1:19190`
- 模块位置：`src/services/checksum`
- 初始化命令：`yarn checksum:init /absolute/path/to/patched_signed.apk`
- 启动命令：`yarn checksum:start`
- 测试命令：`yarn checksum:test`

这个正式服务现在默认依赖 `src/services/checksum/runtime/` 下已经初始化好的运行时文件，不再要求每次启动时重新读取 APK。

正式服务接入文档：

- [docs/checksum_service_integration.md](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/docs/checksum_service_integration.md)
