# PhonePeHelper 数据采集字段设计

更新时间：2026-03-26
范围：`src/apk/phonepehelper` 当前实现（不含日志上传链路检查）

## 1. 文档目的

本文整理当前 `phonepehelper` 实现中“会采集/组装/持久化/输出”的数据字段，说明：
- 字段名
- 字段含义
- 来源方法
- 存储与输出位置

参考代码：
- `/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/apk/phonepehelper/src/main/java/com/PhonePeTweak/Def/PhonePeHelper.java`
- `/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/apk/phonepehelper/src/main/java/com/phonepehelper/ModuleInit.java`
- `/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/apk/phonepehelper/src/main/java/com/phonepehelper/LifecycleLogger.java`
- `/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/apk/phonepehelper/src/main/java/com/phonepehelper/ChecksumServer.java`

---

## 2. 本地持久化字段（SharedPreferences: `pph_store`）

| 存储键 | 字段含义 | 写入方法 | 读取方法 | 备注 |
|---|---|---|---|---|
| `user_phone` | 当前用户手机号缓存 | `setUserPhoneNum(String)` | `getUserPhoneNum()` | 用于 token/meta 关联 |
| `x_device_fp` | 设备指纹缓存（X-Device-Fingerprint） | `setX_Device_Fingerprint(String)` | `getDeviceFingerPrint()` | 请求元数据字段之一 |
| `token_1fa` | 1FA token JSON | `set1faToken(JSONObject)` | `get1faToken()` | 本实现为本地安全 stub 存储 |
| `token_sso` | SSO token JSON | `saveSSOToken(...)` | `getSSOToken()` | 支持 `JSONObject` 与 `Object` 包装写入 |
| `token_auth` | Auth token JSON | `saveAuthToken(JSONObject)` | `getAuthToken()` | |
| `token_accounts` | Accounts token JSON | `saveAccountsToken(...)` | `getAccountsToken()` | |
| `sent_1fa` | 最近一次“已发布”1FA 快照 | `publishTokenUpdateIfNeeded()` | 内部对比读取 | 用于变化检测 |
| `sent_sso` | 最近一次“已发布”SSO 快照 | `publishTokenUpdateIfNeeded()` | 内部对比读取 | 用于变化检测 |
| `sent_auth` | 最近一次“已发布”Auth 快照 | `publishTokenUpdateIfNeeded()` | 内部对比读取 | 用于变化检测 |
| `sent_accounts` | 最近一次“已发布”Accounts 快照 | `publishTokenUpdateIfNeeded()` | 内部对比读取 | 用于变化检测 |
| `last_mpin` | 最近一次 MPIN 文本 | `PublishMPIN(String)` | `getLastMpin()` | 日志只打印长度，不直接打印明文 |
| `upi_cache` | UPI 列表 JSON 缓存 | 当前实现读取为主 | `getUPIs()` | 若为空，返回结构化 fallback |

补充：内存态字段 `LastMpin` 为 MPIN 最近值镜像，便于无参 `PublishMPIN()` 调用。

---

## 3. Token 变化检测与同步判定字段

来源方法：`publishTokenUpdateIfNeeded(boolean)`、`performTokenSync()`、`shouldUpdateToken(...)`

| 字段/维度 | 含义 | 用途 |
|---|---|---|
| `1fa/sso/auth/accounts` 快照字符串 | 当前 token 全量 JSON 串 | 与 `sent_*` 对比判断是否变化 |
| `force` | 是否强制发布 | 初始化阶段可无条件触发一次发布 |
| `expiry` / `exp` | token 到期时间 | `shouldUpdateToken` 用于新旧 token 优先级比较 |
| `syncResult` (`LOCAL_TO_SERVER/NO_CHANGE/ERROR`) | 一次同步结果枚举 | lifecycle 与 monitor 日志输出 |

日志输出（PPHelper 标签）：
- `token snapshot: 1fa=..., sso=..., auth=..., accounts=...`
- `monitor tick: <n>, result=<TokenSyncResult>`

---

## 4. 请求元数据对象字段（`getRequestMetaInfoObj`）

来源方法：`getRequestMetaInfoObj()` / `getRequestMetaInfo()` / `getUPIRequestMetaInfo()`

| 字段名 | 含义 |
|---|---|
| `package` | 当前应用包名 |
| `appType` | 应用类型（固定 `phonepe`） |
| `clientVersion` | Android 系统版本（`Build.VERSION.RELEASE`） |
| `userPhone` | 用户手机号（缓存） |
| `phoneNumber` | 同 `userPhone`（兼容字段） |
| `androidId` | Android ID |
| `androidDeviceId` | 同 `androidId`（兼容字段） |
| `device` | 设备型号（`Build.MODEL`） |
| `brand` | 设备品牌（`Build.BRAND`） |
| `manufacturer` | 设备制造商（`Build.MANUFACTURER`） |
| `xDeviceFingerprint` | 设备指纹缓存值 |
| `deviceFingerprint` | 同上（兼容字段） |
| `handlerReady` | 是否已保存 Dagger handler（`saveHandler`） |
| `metaBuiltAt` | 元数据构建时间字符串 |
| `tokens` | token 聚合对象，含 `1fa/sso/auth/accounts` |
| `token` | `tokens.1fa` 别名 |
| `ssoToken` | `tokens.sso` 别名 |
| `authToken` | `tokens.auth` 别名 |
| `accountsToken` | `tokens.accounts` 别名 |

输出位置：
- 直接返回 JSON 字符串
- 同时在日志输出 `request-meta built: {...}`

---

## 5. UPI 信息字段（`getUPIs` / `buildUPIInfo`）

| 字段名 | 含义 | 说明 |
|---|---|---|
| `account` | 账户标识（当前实现用手机号） | fallback 结构字段 |
| `accountNum` | 账号/卡号 | 当前 fallback 为空字符串 |
| `appType` | 应用类型（`phonepe`） | |
| `upis` | VPA 列表 | 当前 fallback 为空数组 |
| `source` | 数据来源标记 | 当前 fallback 固定 `local_stub` |
| `status` | 数据状态 | 当前 fallback 固定 `no_account_data` |

---

## 6. Lifecycle 采集字段

来源文件：`LifecycleLogger`

| 事件 | 采集字段 |
|---|---|
| `onActivityCreated/Started/Resumed/Paused/Stopped/SaveInstanceState/Destroyed` | `Activity` 类名 |
| `onActivityResumed` 额外 | `syncResult`（`PhonePeHelper.performTokenSync()` 返回值） |

输出位置：
- `PPHelper` 日志，统一前缀 `[phonepehelper]`

---

## 7. 短信读取字段（`readRecentSms`）

来源方法：`readRecentSms()`

| 字段名 | 含义 |
|---|---|
| `_id` | 短信记录 ID |
| `date` | 短信时间戳（日志中格式化输出） |
| `address` | 发送方号码 |

当前行为：最多读取最近 3 条并打印日志。

---

## 8. 本地 Checksum 服务调试字段（`ChecksumServer`）

### 8.1 请求输入字段

`POST /checksum` 或 `/debug/checksum` 请求体：

| 字段名 | 含义 |
|---|---|
| `path` | 参与 checksum 的请求路径 |
| `body` | 参与 checksum 的请求体字符串 |
| `uuid` | 请求唯一标识（为空时自动生成） |

### 8.2 返回字段

| 接口 | 返回字段 |
|---|---|
| `/checksum` | `checksum`, `uuid` |
| `/debug/checksum` | `checksum`, `uuid`, `runtime` |
| `/debug/runtime` | runtime 快照 |

### 8.3 runtime 快照字段

| 字段名 | 含义 |
|---|---|
| `packageName` | 包名 |
| `packageCodePath` | 安装包路径 |
| `localTimeMs` | 本地毫秒时间 |
| `androidId` | Android ID |
| `deviceId` | 设备 ID（反射获取） |
| `serverTimeOffsetMs` | 服务端时间偏移 |
| `adjustedTimeMs` | 调整后时间 |
| `signatureSha256` | 安装包签名 SHA-256 |

---

## 9. 当前未纳入本轮检查范围

- 日志上传链路（你已明确后续再检查）
- 远端 token 下发写回链路联调
- Azure 备份上传（当前 `performDataSyncBackup` 为 `noop`）

---

## 10. Navpay Admin 上传与设备页展示

### 10.1 上传端点

- Endpoint：`http://10.0.2.2:3000/api/intercept/phonepe/snapshot`
- Method：`POST`
- Body：`{ "androidId": "...", "payload": { ... } }`
- 说明：`payload` 由 `PhonePeHelper.buildSnapshotForNavpay()` 组装，包含 requestMeta、upis 等采集字段快照。

### 10.2 Admin 设备页 Tab

- 页面：`/admin/resources/devices/<deviceId>?tab=phonepehelper`
- Tab 名称：`PhonePeHelper采集`
- 查询接口：`/api/admin/resources/devices/<deviceId>/phonepehelper`

### 10.3 最后采集时间规则

- `lastCollectedAtMs` 优先使用 `payload.collectedAtMs`
- 若缺失则尝试 `payload.requestMeta.metaBuiltAt`
- 仍缺失则回退到日志行 `created_at_ms`

---

## 11. 运行态验收字段（本轮日志 gate）

`scripts/check_phonepehelper_logs.sh` 当前强校验以下 5 项：
- `PhonePeHelper initialized`
- `Lifecycle logger registered`
- `token snapshot: 1fa=`
- `request-meta built`
- `monitor tick`

这些字段用于快速判断：初始化、生命周期注册、token 快照、meta 构建、监控循环是否都已生效。
