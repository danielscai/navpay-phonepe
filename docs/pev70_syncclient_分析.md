# pev70 Syncclient 分析

日期：2026-01-31

本文基于 `decompiled/pev70_jadx` 中可见的 Java 侧代码梳理 Syncclient 的实现方式、追踪数据与发送路径。Syncclient 的核心逻辑在 native/Go 层，Java 侧只能看到对外接口与调用方式。

---

## 1) Syncclient 的实现方式（Java 侧可见）

- `syncclient.Syncclient` 为 **native/Go 实现**（通过 `go.Seq` 绑定）。
- Java 侧公开的方法：
  - `initGlobalTokenSyncClient(...)`：初始化全局同步客户端（长连接/全局实例）。
  - `syncMeta(...) / syncMetaV2(...)`：同步元数据。
  - `publishMessage(...)`：发布消息（topic + payload + TTL）。
  - `getGlobalTokenSyncClient()` / `isGlobalClientConnected()` 等。
- 证据：`decompiled/pev70_jadx/sources/syncclient/Syncclient.java`。

另外还包含：
- `TokenSyncClient`：提供连接状态与关闭能力（native）。
- `SyncTokenReq/SyncTokenResp/TokenMessage`：token 相关数据结构（native）。
- 证据：
  - `decompiled/pev70_jadx/sources/syncclient/TokenSyncClient.java`
  - `decompiled/pev70_jadx/sources/syncclient/SyncTokenReq.java`
  - `decompiled/pev70_jadx/sources/syncclient/SyncTokenResp.java`
  - `decompiled/pev70_jadx/sources/syncclient/TokenMessage.java`

---

## 2) Syncclient 追踪/同步的数据类型

### A. Token/账号类（通过 MessageNotifier 同步）
`DefaultMessageNotifier` 处理的 topic：
- `1fa`
- `authToken`
- `ssoToken`
- `accountsToken`
- `ALL_TEXT`（完整合并包）
- `report`（触发本地回传）

这些信息的**获取方式/来源**：
- Syncclient 由 `PhonePeHelper.InitTokenSyncClient(...)` 初始化时传入 `DefaultMessageNotifier`，native/Go 层在收到远端同步消息后回调 `MessageNotifier.onMessageUpdate(...)`，将 `topic + msgInfo(JSON)` 投递到 Java 侧。
- `1fa/authToken/ssoToken/accountsToken`：分别对应单独 topic。`onMessageUpdate` 直接拿 `msgInfo`（JSON 字符串）并调用 `updateTokenByTopic(...)`；后者从 JSON 读取 `type/token/refreshToken/expiry` 等字段并保存为本地 token（`set1faToken/saveAuthToken/saveSSOToken/saveAccountsToken`）。
- `ALL_TEXT`：`topic == SyncType.ALL_TEXT` 时视为完整合并包（“PhonePeMeta”），`msgInfo` 内包含嵌套的 `token(=1fa)`、`authToken`、`ssoToken`、`accountsToken`，`processPhonePeMetaTokens(...)` 逐一解析并按需更新。
- `report`：不是携带 token 的数据包，而是**指令**。收到后直接调用 `PhonePeHelper.publishTokenUpdateIfNeeded(false)` 触发本地回传。该回传的数据来源于本地存储的 `1fa/authToken/ssoToken/accountsToken`，并通过 Syncclient 的 native 通道发送（具体发送实现位于 Go 层，Java 侧不可见）。

Token JSON 的常见字段：
- `type`
- `token`
- `refreshToken`
- `expiry`

这些 token 会被解析成：
- `AccountsToken` / `SSOToken` / `authToken` 等对象并写入本地。

证据：
- `decompiled/pev70_jadx/sources/com/PhonePeTweak/Def/DefaultMessageNotifier.java`
- `decompiled/pev70_jadx/sources/com/PhonePeTweak/Def/PhonePeHelper.java`

### B. 设备与身份信息
`onMessageUpdate(...)` 回调入参包含：
- `topic`, `walletType`, `phoneNumber`, `deviceId`, `tokenType`, `msgInfo`
并做 `deviceId`/`phoneNumber` 校验。

证据：
- `decompiled/pev70_jadx/sources/com/PhonePeTweak/Def/DefaultMessageNotifier.java:100-220`

### C. MPIN 上报
`PhonePeHelper.PublishMPIN()` 调用 `publishMessage(...)` 上报 MPIN：
- topic: `"mpin"`
- payload: `{"mpin": ..., "timestamp": ...}`
- ttl: `3600` 秒

证据：
- `decompiled/pev70_jadx/sources/com/PhonePeTweak/Def/PhonePeHelper.java:472-506`

### D. 登录 token / 1fa token 主动同步
`PhonePeInterceptor` 在解析登录响应后调用：
- `Syncclient.syncMeta("phonepe", "diff", payload, PhonePeHelper.GetTokenURL())`
- payload 为 JSON 字符串，包含 `type/scope/token/refreshToken/userId/phoneNumber` 等字段（从日志可见）。

证据：
- `decompiled/pev70_jadx/sources/com/PhonePeTweak/Def/PhonePeInterceptor.java:162-174`
- `decompiled/pev70_jadx/sources/com/PhonePeTweak/Def/PhonePeInterceptor.java:198-307`

### E. OkHttp 拦截器提取 token 的触发 URL 与字段来源
以下均来自 `PhonePeInterceptor.intercept(...)` 的 **HTTPS 响应 body** 解析（非 header）：
- `https://accounts-api.phonepe.com/apis/users/accounts/auth/oauth/v1/login`  
  - 解析响应 `tokenResponse + profileSummary`  
  - 提取 `token/refreshToken/tokenExpiresAfter/type/scope/userId/phoneNumber`  
  - 进入 `saveAccountToken(...)` → `buildRequestMetaInfoObj(...)` → `syncMeta(diff, ...)` 上报。  
- `https://accounts-api.phonepe.com/apis/users/org/auth/oauth/v1/login`  
  - 解析响应 `tokenResponses + profileSummary`  
  - 找 `type=consumer && scope=1fa` 的 token  
  - 进入 `sync1faToken(...)` → `buildRequestMetaInfoObj(...)` → `syncMeta(diff, ...)` 上报。  
- `/apis/users/org/auth/oauth/v1/token/refresh`  
  - 解析响应 body 中 `token/refreshToken/tokenExpiresAfter`  
  - 拼入 `RequestMetaInfo` 后 `syncMeta(diff, ...)` 上报 1fa。  
- `/apis/users/v1/tokenrefresh/`  
  - 解析响应 body 中 `token/refreshToken/expiresAt`  
  - 拼入 `RequestMetaInfo` 后 `syncMeta(diff, ...)` 上报 authToken。  
- `https://apicp2.phonepe.com/apis/users/v5.0/profile/user/<id>/mapping?includeVpaDetails=...`  
  - 解析响应 body 中 `profileDetails.phoneNumber`  
  - 写入 `PhonePeHelper.setUserPhoneNum(...)`，作为后续 token 同步的手机号来源。  

证据：
- `decompiled/pev70_jadx/sources/com/PhonePeTweak/Def/PhonePeInterceptor.java`（`intercept(...)`、`saveAccountToken(...)`、`sync1faToken(...)`）

---

## 3) 发送格式与目标

### A. `syncMeta(...)`
调用签名：
```
syncMeta(appType, mode, payload, url)
```
- appType：调用处为 `"phonepe"`
- mode：调用处为 `"diff"`
- payload：JSON 字符串（token、refreshToken、userId、phoneNumber 等）
- url：由 `PhonePeHelper.GetTokenURL()` 提供

`GetTokenURL()` 行为：
- 当 `Config.ClientType == "test"` → 返回 `https://api.techru.cc/test/wallet/phonepe/syncToken`
- 否则返回空字符串（真实生产地址可能在 native 层配置）

证据：
- `decompiled/pev70_jadx/sources/com/PhonePeTweak/Def/PhonePeHelper.java:1789-1796`
- `decompiled/pev70_jadx/sources/com/tweakUtil/DataCallback.java:11`

### B. `publishMessage(...)`
调用签名：
```
publishMessage(topic, payload, ttlSeconds)
```
- payload 为 JSON 字符串（例如 MPIN 上报）。
- 具体发送协议与目标在 native/Go 层实现，Java 侧不可见。

证据：
- `decompiled/pev70_jadx/sources/syncclient/Syncclient.java`

---

## 4) 结论

- Syncclient 采用 **native/Go 通道**，与 OTLP/Azure 日志通道不同。
- 可见数据同步范围包括：多类 token、设备/手机号校验信息、MPIN 等。
- Java 侧能确认的远端地址仅限测试环境 `api.techru.cc`；生产地址可能由 native 层注入。

如需进一步确认实际发送地址/协议，需要分析 native 层 `go` 实现或运行时抓包验证。
