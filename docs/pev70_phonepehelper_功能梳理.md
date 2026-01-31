# pev70 PhonePeHelper 功能梳理

日期：2026-01-31

本文基于现有分析文档整理 `PhonePeHelper` 在 pev70 中的功能范围与职责。该类位于注入层 `classes14.dex`，是恶意能力的“总控台”，负责 Token 获取/写入、UPI 信息读取、MPIN 上报、数据备份与同步等关键操作。

---

## 1) 核心定位

- **核心数据窃取与同步类**：聚合对 PhonePe 内部对象（Token、数据库、请求头等）的访问，并通过 Syncclient/日志通道对外上报。
- **账户接管能力枢纽**：既能读取本地 Token，也能将服务器下发的 Token 写回本地，形成双向控制。

---

## 2) 主要功能清单（按能力域）

### A. Token 获取（读取本地认证状态）
利用被劫持的 Dagger 容器（`SingletonC`）访问 PhonePe 内部依赖：
- `get1faToken()`：读取 1FA Token
- `getSSOToken()`：读取 SSO Token
- `getAuthToken()`：读取 Auth Token
- `getAccountsToken()`：读取 Accounts Token
- `getUserPhoneNum()`：从 CoreDatabase 读取当前用户手机号

### B. Token 写入（用于远程注入/接管）
将服务器下发的凭证写回 PhonePe 本地：
- `set1faToken(JSONObject)`
- `saveSSOToken(SSOToken, int)`
- `saveAuthToken(JSONObject)`
- `saveAccountsToken(AccountsToken)`

> 这类写入能力由 `DefaultMessageNotifier.updateTokenByTopic(...)` 调用路径触发。

### C. Token 同步与上报（与 Syncclient 协作）
- `startPhoneNumberMonitoring()`：5 秒定时轮询手机号/Token 变化
- `publishTokenUpdateIfNeeded(boolean force)`：对比新旧 Token，必要时通过 `Syncclient.publishMessage()` 上报
- `shouldUpdateToken(...)`：判断是否需要更新
- `performTokenSync()`：执行一次完整双向同步，返回 `TokenSyncResult`
- `InitTokenSyncClient(...)`：初始化全局 WebSocket 同步客户端

### D. UPI 数据读取与请求元数据构建
- `getUPIs()`：访问 CoreDatabase，读取账户与 VPA 列表并构造 JSON
- `buildUPIInfo()`：构造完整 UPI 信息 JSON
- `getRequestMetaInfoObj()`：构造请求元数据（Token + 设备指纹 + 请求头 + 用户 ID）
- `getUPIRequestMetaInfo()`：UPI 专用请求元数据

### E. MPIN / SMS 相关能力
- `LastMpin`：静态字段，保存最近捕获的 MPIN
- `PublishMPIN()`：通过 Syncclient 发送 MPIN（topic = `"mpin"`）
- `readRecentSms()`：读取最近短信（用于 OTP/短信窃取链路）

### F. 设备指纹/请求头缓存
- `setX_Device_Fingerprint()` / `getDeviceFingerPrint()`：缓存与读取 X-Device-Fingerprint
- 同时保存并复用请求 Headers 作为元数据上报材料

### G. 数据备份与上传
- `performDataSyncBackup()`：压缩 PhonePe SharedPreferences 并上传到 Azure Blob

### H. Token 刷新辅助
- `refreshToken(ResultCallback)`：触发 PhonePe 内部 Token 刷新流程并回调

---

## 3) 与其他模块的关键联动关系

- **HookUtil.generatedComponent() → PhonePeHelper.SingletonC**
  劫持 Hilt 组件后，PhonePeHelper 直接访问内部依赖（数据库、Token 管理器、网络客户端）。

- **PhonePeInterceptor / HttpJsonInterceptor**
  从网络响应中提取 Token 与用户信息，并调用 PhonePeHelper 构造/上传请求元数据。

- **DefaultMessageNotifier → PhonePeHelper.updateTokenByTopic()**
  服务器下发 Token 经 `onMessageUpdate(...)` 分发后写回本地，实现跨设备 Token 注入。

- **ActivityLifecycleCallbacker**
  触发 `performDataSyncBackup()`，配合截图/状态上传。

---

## 4) 影响与风险（简述）

- **账户接管**：通过 Token 写入能力可实现跨设备接管。
- **资金安全风险**：UPI/MPIN 获取与元数据构建可支撑后续交易操控。
- **隐私泄露**：手机号、设备指纹、短信与请求头等多维度隐私被集中采集。

---

## 5) 证据与参考

- 分析文档（作为本仓库结论来源）：
  - `docs/pev70注入代码详细分析.md`
  - `docs/pev70分析.md`
  - `docs/pev70_syncclient_分析.md`
- 反编译源码（路径证据）：
  - `decompiled/pev70_jadx/sources/com/PhonePeTweak/Def/PhonePeHelper.java`
  - `decompiled/pev70_jadx/sources/com/PhonePeTweak/Def/DefaultMessageNotifier.java`
  - `decompiled/pev70_jadx/sources/com/PhonePeTweak/Def/PhonePeInterceptor.java`

