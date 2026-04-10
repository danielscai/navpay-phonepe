# Checksum Content Provider API

## 目标

给其他程序提供统一的 content provider 调用方式，直接在 PhonePe 进程内生成 checksum。

## Provider 信息

- `authority`: `com.phonepe.navpay.provider`
- `uri`: `content://com.phonepe.navpay.provider/user_data`
- checksum 调用入口：`ContentProvider.call(...)`

## 调用约束

- **method 支持**：`checksum`、`tokenrefresh`、`setEnvironment`、`getEnvironment`
- `method=getChecksum` 已废弃并移除，不再保证可用。

### tokenrefresh 说明

- 作用：在 PhonePe 进程内触发一次 token refresh 流程（best-effort）。
- 当前策略：优先触发 `org/auth/oauth/v1/token/refresh`（scope=`1fa`）链路，保持与 PhonePe App 主请求一致。
- 典型调用：

```bash
adb shell content call \
  --uri content://com.phonepe.navpay.provider/user_data \
  --method tokenrefresh
```

- 返回字段（摘要）：
  - `ok`：是否成功触发 refresh 调用
  - `status`：`triggered` / `failed`
  - `message`：诊断信息
  - `triggered_at`：触发时间戳

### setEnvironment / getEnvironment 说明

- `setEnvironment` 作用：写入当前环境配置，供 `phonepehelper` 后续上传和读取。
- `getEnvironment` 作用：读取当前已保存的环境配置。
- `setEnvironment` 入参：
  - `envName`：必填，不能为空
  - `baseUrl`：必填，必须以 `http://` 或 `https://` 开头
  - `updatedAt`：可选，缺省时由 provider 自动使用当前时间
- `getEnvironment` 不需要额外参数。
- 返回字段（摘要）：
  - `ok`：是否成功
  - `status`：`updated` / `loaded` / `failed`
  - `code`：失败时的错误码
  - `message`：失败时的诊断信息
  - `envName`：当前环境名
  - `baseUrl`：当前环境 base URL
  - `updatedAt`：最后更新时间戳

`setEnvironment` 示例：

```bash
adb shell content call \
  --uri content://com.phonepe.navpay.provider/user_data \
  --method setEnvironment \
  --extra envName:s:'staging' \
  --extra baseUrl:s:'https://staging.example.com' \
  --extra updatedAt:l:1710000000000
```

`getEnvironment` 示例：

```bash
adb shell content call \
  --uri content://com.phonepe.navpay.provider/user_data \
  --method getEnvironment
```

## 入参

通过 `extras` 传参（推荐）：

- `path`（必填）
  - 语义：`encodedPath`，不包含 query
  - 示例：`/apis/tstore/v2/units/changes`
- `body`（可选，默认空字符串）
- `uuid`（可选，不传则服务端生成）

兼容 key（用于历史调用方）：

- path：`encodedPath` / `requestPath` / `urlPath` / `url` / `requestUrl` 等
- body：`requestBody` / `rawBody` / `payload` / `payloadJson` / `json` 等
- uuid：`requestId` / `traceId` / `nonce` / `correlationId` 等

## 返回结构

核心结构与 HTTP 服务保持一致：

- `ok`：`true/false`
- `data.checksum`：成功时返回 checksum
- `uuid`：请求或生成的 uuid
- `error`：失败时返回错误描述

为方便 `adb shell content call` 直接查看，provider 还会镜像一个顶层字段：

- `checksum`：与 `data.checksum` 同值

## 调用示例

```bash
adb shell content call \
  --uri content://com.phonepe.navpay.provider/user_data \
  --method checksum \
  --extra path:s:'/apis/tstore/v2/units/changes' \
  --extra body:s:'' \
  --extra uuid:s:'8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001'
```

成功示例（摘要）：

```text
Result: Bundle[{ok=true, data=Bundle[...], uuid=..., checksum=...}]
```

## 错误处理

- 缺少 path：`ok=false, error=missing path`
- 运行异常：`ok=false, error=internal_error: <Exception>`

## 联调建议

1. 先确认 App 已通过注入启动，并且 provider 已注册。
2. 使用固定 `uuid` 便于重放和问题复现。
3. 以 `ok=true` 且存在 `data.checksum`（或顶层 `checksum`）作为成功判据。
