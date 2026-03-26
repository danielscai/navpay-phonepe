# pev70.apk 注入代码详细逆向分析报告

> 分析目标：pev70.apk (88MB, 重打包 PhonePe) 中 classes14.dex 的全部注入代码
> 重点：交易记录捕获机制的完整链路

---

## 目录

1. [注入架构总览](#1-注入架构总览)
2. [启动链路](#2-启动链路)
3. [com.PhonePeTweak 根包 (4文件)](#3-comphonepetweak-根包)
4. [com.PhonePeTweak.Def 核心Hook层 (42文件)](#4-comphonepetweak-def-核心hook层)
5. [com.longfafa 支付服务层 (17文件)](#5-comlongfafa-支付服务层)
6. [com.tweakUtil 工具层 (7文件)](#6-comtweakutil-工具层)
7. [syncclient Token同步层 (6文件)](#7-syncclient-token同步层)
8. [azure 云存储层 (4文件)](#8-azure-云存储层)
9. [com.zerolog 日志层 (1文件)](#9-comzerolog-日志层)
10. [交易记录捕获的完整路径](#10-交易记录捕获的完整路径)
11. [C2基础设施与外传通道](#11-c2基础设施与外传通道)

---

## 1. 注入架构总览

所有恶意代码位于 `classes14.dex`，共约 **80+ Java 文件**，分布在 6 个包中：

```
classes14.dex
├── com.PhonePeTweak/            ← 入口 + Hook 核心 (57 文件)
│   ├── 根包 (4 文件)            ← 启动入口、主线程、生命周期监控
│   ├── Def/ (51 文件)           ← 所有 Hook 定义、数据获取、安全绕过
│   └── Def/npci/ (2 文件)       ← NPCI 安全组件数据读取
├── com.longfafa/ (17 文件)      ← AIDL IPC 服务层 (暴露给 MovPay)
├── com.tweakUtil/ (7 文件)      ← 工具类、配置、压缩、Azure URL
├── syncclient/ (6 文件)         ← Go 原生 WebSocket Token 同步
├── azure/ (4 文件)              ← Azure Blob/Table 存储客户端
└── com.zerolog/ (1 文件)        ← 结构化远程日志系统
```

---

## 2. 启动链路

```
Android 系统启动 PhonePe
       │
       ▼
MyInitProvider.onCreate()          ← ContentProvider 自动初始化
       │
       ▼
MyEntryPoint.init()                ← 创建主工作线程
       │
       ▼
PhonePeHomeScreenActivityThread   ← 后台线程持续运行
       │
       ├──→ Pine 框架初始化 (PhonePeApplication.attachBaseContext)
       ├──→ HookUtil.build() 注入 OkHttp 拦截器
       ├──→ HookUtil.generatedComponent() 劫持 Dagger DI 容器
       ├──→ Token 监控循环 (5秒轮询)
       ├──→ ActivityLifecycleCallbacker 截图监控
       ├──→ CrashHandler 崩溃捕获
       └──→ JobService AIDL 服务就绪
```

---

## 3. com.PhonePeTweak 根包

### 3.1 MyInitProvider.java
**文件路径**: `com/PhonePeTweak/MyInitProvider.java`
**作用**: 利用 Android ContentProvider 机制在应用启动时自动执行恶意代码初始化

| 方法 | 说明 |
|------|------|
| `onCreate()` | 调用 `MyEntryPoint.init()` 启动恶意代码，返回 `true` |
| `delete()` | 空实现，返回 0 |
| `insert()` | 空实现，返回 null |
| `query()` | 空实现，返回 null |
| `update()` | 空实现，返回 0 |
| `getType()` | 返回空字符串 |

**关键点**: ContentProvider 在 Application.onCreate() 之前执行，确保恶意代码优先于所有应用逻辑启动。
contentprovider 通过在AndroidManifest.xml中定义一个 provider把 com.PhonePeTweak 引入进来。
代码如下
```
<provider android:authorities="com.PhonePeTweak.MyInitProvider" android:exported="false" android:grantUriPermissions="true" android:initOrder="1" android:multiprocess="true" android:name="com.PhonePeTweak.MyInitProvider"/>
```

### 3.2 MyEntryPoint.java
**作用**: 恶意代码主入口点

| 方法/字段 | 说明 |
|-----------|------|
| `static PhonePeHomeScreenActivityThread thread` | 静态持有主工作线程引用 |
| `static void init()` | 创建 `PhonePeHomeScreenActivityThread` 实例，设置为 `Z.dataCallback`（日志回调），启动线程 |

### 3.3 PhonePeHomeScreenActivityThread.java
**作用**: 主工作线程，持续运行处理数据获取任务

| 方法 | 说明 |
|------|------|
| `run()` | 线程主循环：初始化 Token 同步客户端、启动 5 秒轮询检测 token 变化、注册 Activity 生命周期回调 |
| `onBind()` | MovPay 绑定时调用，触发数据上报 |
| `unbind()` | MovPay 解绑时调用 |
| `downloadData(key, value)` | 从 Azure Blob 下载数据到本地 |
| `buildBaseInfo(JSONObject, String)` | 构建基础上报信息（设备ID、手机号、应用类型、版本号） |
| `getDeviceID()` / `getPhoneNumber()` | 返回设备和用户标识 |
| `getHomeActivity()` | 返回当前前台 Activity 名称 |
| `onGetUploadPath()` | 生成 Azure Blob 上传路径：`phonepe/<手机号>/<设备信息>/` |
| `uploadToken()` | 触发 Token 上传 |

**实现 `DataCallback` 接口**：为整个注入框架提供设备信息和上传路径。

### 3.4 ActivityLifecycleCallbacker.java
**作用**: 注册到 Application 的 ActivityLifecycleCallbacks，监控所有 Activity 生命周期，实现自动截图上传

| 方法 | 说明 |
|------|------|
| `onActivityCreated()` | 记录 Activity 创建事件 |
| `onActivityResumed()` | 记录恢复事件；在特定页面延迟截图（等待动画结束） |
| `onActivityPaused()` | 触发截图上传 |
| `onActivityDestroyed()` | 记录销毁事件 |
| `captureScreenshot(Activity)` | 使用 `PixelCopy` API 截取 Activity 窗口 |
| `compressAndUpload(Bitmap)` | 将截图缩放至 40%，JPEG 压缩质量 70%，上传到 Azure Blob |

**上传路径格式**: `phonepe/<手机号>/<设备信息>/snapshot/<日期>/<时间>_<Activity名>_<状态>.jpg`

### 3.5 RequestSmsActivity.java
**作用**: SMS 权限请求中间页

| 方法 | 说明 |
|------|------|
| `onCreate()` | 显示"继续跳转到目标 Activity"按钮，点击后启动原始 Intent |

### 3.6 IntegrityHelper.java
**作用**: Google Play Integrity API 工具

| 方法 | 说明 |
|------|------|
| `generateNonce()` | 生成 24 字节 SecureRandom nonce，Base64 编码 |
| `requestIntegrityToken(Context, callback)` | 请求 Google Play Integrity Token，通过回调返回 |

---

## 4. com.PhonePeTweak.Def 核心Hook层

### 4.1 PhonePeApplication.java
**作用**: 替换原始 Application，初始化 Hook 框架

| 方法 | 说明 |
|------|------|
| `attachBaseContext(Context)` | **核心初始化入口**：1) 调用 `SplitCompat.a()` 加载动态模块；2) 调用 `Pine.ensureInitialized()` 初始化 inline hook 框架；3) 设置 Kotlin Debug 模式；4) 读取 `android_id` 作为设备标识；5) 调用 `Z.InitConfig()` 初始化日志系统；6) 调用 `Plugin.attach()` 加载 Airtel 插件 |

### 4.2 HookUtil.java (232 行)
**作用**: 安全机制绕过 + OkHttp 注入 + Dagger DI 劫持

| 方法/字段 | 说明 |
|-----------|------|
| `Certificates` (static String) | 硬编码正版 PhonePe APK 签名证书（hex 编码），用于通过签名验证 |
| `Signature` (static String) | 硬编码签名 hex 值 |
| `ResponseCheckSum()` | Hook PhonePe 的响应校验方法，**强制返回 `true`**，绕过服务端响应完整性验证 |
| `isSensitiveHeader()` | Hook PhonePe 的敏感 header 检测，**强制返回 `false`**，允许获取 Authorization/Cookie 等敏感头 |
| `getPlayIntegrityEnabled()` | **强制返回 `false`**，禁用 Google Play Integrity 检测 |
| `generatedComponent()` | **关键**：Hook Dagger `ActivityComponentManager.generatedComponent()`，在依赖注入组件创建时截获 `DaggerPhonePeApplication_HiltComponents_SingletonC` 实例，存储到 `PhonePeHelper.SingletonC`。这使恶意代码可以直接访问 PhonePe 的所有内部依赖（数据库、Token 管理器、网络客户端等） |
| `build()` | **关键**：Hook `OkHttpClient.Builder.build()`，在真正构建之前注入三个拦截器：1) `HttpLoggingInterceptor`（BODY 级别，完整网络日志）；2) `PhonePeInterceptor`（Token 获取）；3) `HttpJsonInterceptor`（结构化日志） |
| `HeaderCheckSum()` | Hook PhonePe 的 `X-Device-Fingerprint` header 生成方法，缓存并上报设备指纹值到 `PhonePeHelper` |

### 4.3 PhonePeHelper.java (900+ 行)
**作用**: 核心数据获取类，提供获取 Token、UPI 信息、MPIN 的所有方法

#### Token 获取方法（利用劫持的 Dagger 容器）
| 方法 | 说明 |
|------|------|
| `get1faToken()` | 通过 `SingletonC` → Dagger DI → 获取 1FA (一级认证) Token 对象 |
| `getSSOToken()` | 通过 `SingletonC` → Dagger DI → 获取 SSO Token 对象 |
| `getAuthToken()` | 通过 `SingletonC` → Dagger DI → 获取 Auth Token 对象 |
| `getAccountsToken()` | 通过 `SingletonC` → Dagger DI → 获取 Accounts Token 对象 |
| `getUserPhoneNum()` | 通过 `CoreDatabase.F0().getCurrentUserIfPresent()` 获取用户手机号 |

#### Token 写入方法（用于远程账户接管）
| 方法 | 说明 |
|------|------|
| `set1faToken(JSONObject)` | 将服务器下发的 1FA token 写入 PhonePe 的 DI 容器，实现远程注入认证凭证 |
| `saveSSOToken(SSOToken, int)` | 保存远程下发的 SSO Token |
| `saveAuthToken(JSONObject)` | 保存远程下发的 Auth Token |
| `saveAccountsToken(AccountsToken)` | 保存远程下发的 Accounts Token |

#### UPI 数据获取
| 方法 | 说明 |
|------|------|
| `getUPIs()` | **交易记录捕获核心**：通过 `AppSingletonModule.X(context).l()` 获取 `CoreDatabase` → 调用 `B().l()` 获取所有账户（排除 CREDIT/CREDITLINE 类型） → 遍历每个 Account 获取 `getAccountNo()`、`getVpas()`（VPA 地址列表） → 构建包含 `account`、`accountNum`、`appType`、`upis` 的 JSON 数组 |
| `buildUPIInfo()` | 构造完整 UPI 信息 JSON（账户名、账号、应用类型、VPA 地址列表） |
| `getRequestMetaInfoObj()` | 构建请求元数据 JSON：包含 1FA Token、Auth Token、Device Fingerprint、用户 ID、请求 Headers |
| `getUPIRequestMetaInfo()` | 获取 UPI 专用请求元数据 |

#### Token 同步与上报
| 方法 | 说明 |
|------|------|
| `startPhoneNumberMonitoring()` | 启动 5 秒定时器循环：检查手机号是否变化 → 检查 token 是否变化 → 若有变化调用 `publishTokenUpdateIfNeeded()` |
| `publishTokenUpdateIfNeeded(boolean force)` | 比较当前 1FA/SSO/Auth/Accounts token 与上次上传的值，若不同则通过 `Syncclient.publishMessage()` 上传。参数 `force=true` 时无条件上传 |
| `shouldUpdateToken(topic, newValue, currentValue)` | 对比新旧 Token 值决定是否需要更新 |
| `performTokenSync()` | 执行一次完整 Token 同步操作，返回 `TokenSyncResult` (LOCAL_TO_SERVER / SERVER_TO_LOCAL / NO_CHANGE) |
| `InitTokenSyncClient()` | 初始化 `Syncclient.initGlobalTokenSyncClient(clientType, appType, phoneNumber, deviceId, notifier, enableDoH)`，建立 WebSocket 持久连接 |

#### MPIN 获取
| 方法 | 说明 |
|------|------|
| `LastMpin` (static String) | 静态字段存储最近捕获的 MPIN |
| `PublishMPIN()` | 通过 `Syncclient.publishMessage("mpin", mpin, ttl)` 将 MPIN 发送到远程服务器 |

#### 数据备份
| 方法 | 说明 |
|------|------|
| `performDataSyncBackup()` | 使用 `FileCompressor` 压缩 PhonePe 的 SharedPreferences 目录 → 上传到 `DataCallback.azurePersistenceBlobClient` (Azure Blob) |
| `setX_Device_Fingerprint()` / `getDeviceFingerPrint()` | 缓存和获取设备指纹值 |
| `readRecentSms()` | 读取最近 SMS 消息（用于 OTP 获取） |

#### Token 刷新
| 方法 | 说明 |
|------|------|
| `refreshToken(ResultCallback)` | 触发 PhonePe 内部 Token 刷新流程，完成后通过回调通知 |

### 4.4 PhonePeInterceptor.java (317 行)
**作用**: 注入到 OkHttp 请求链的核心拦截器，实现网络层 Token 获取

| 方法 | 说明 |
|------|------|
| `intercept(Chain)` | **核心拦截方法**：获取每个请求的 URL 并进行模式匹配 |
| → 匹配 `/v5.0/tokens/1fa` | 拦截 1FA Token 刷新响应 → 调用 `sync1faToken()` 提取并上传 token |
| → 匹配 `/v5.0/token` | 拦截登录响应 → 调用 `saveAccountToken()` 提取用户 ID、手机号、token |
| → 匹配 `/v5.0/profile/user/*/mapping` | 拦截用户资料映射接口 → 获取 UPI 绑定信息 |
| `sync1faToken()` | 从 1FA 响应 JSON 中提取 `token`、`refreshToken`、`expiry`，通过 `Syncclient.syncMeta()` 上传 |
| `saveAccountToken()` | 从登录响应中提取 `tokenResponse`（含 userId, phoneNumber）和完整 Token，保存并上传 |
| `createMockResponse()` | 构造伪造的 HTTP 响应（200 OK），可用于注入虚假数据给 PhonePe 客户端 |

### 4.5 HttpJsonInterceptor.java (171 行)
**作用**: OkHttp 拦截器，以 JSON 格式记录所有 HTTP 请求和响应

| 方法 | 说明 |
|------|------|
| `intercept(Chain)` | 记录请求 URL/method/headers/body + 响应 status/headers/body（反编译失败，978 条指令） |
| `setLevel(Level)` | 设置日志级别（NONE/BASIC/HEADERS/BODY） |
| `redactHeader(String)` | 设置需要脱敏的 header 名 |
| `redactUrl(HttpUrl)` | 对 URL 查询参数进行脱敏（替换为 `██`） |
| `bodyHasUnknownEncoding()` | 检查 Content-Encoding 是否可处理 |
| `bodyIsStreaming()` | 检查是否是 SSE 流式响应 |
| `promisesBody()` | 检查响应是否包含 body |
| `headersContentLength()` | 获取 Content-Length header 值 |

**Logger.DefaultLogger**: 将请求/响应的 Map 数据转为 JSON 字符串后通过 `Platform.get().log()` 输出。

### 4.6 DefaultMessageNotifier.java (259 行)
**作用**: Syncclient WebSocket 消息回调，实现**双向** Token 同步（服务器→本地）

| 方法 | 说明 |
|------|------|
| `onMessageUpdate(topic, walletType, phoneNumber, deviceId, tokenType, msgInfo)` | **服务器下发消息处理入口**：1) 验证 `deviceId` 匹配当前设备；2) 验证 `phoneNumber` 匹配当前用户；3) 按 `topic` 分发处理 |
| → topic = `SyncType.ALL_TEXT` | 调用 `processPhonePeMetaTokens()` 批量处理所有 Token |
| → topic = `"1fa"` | 比较并更新 1FA Token |
| → topic = `"authToken"` | 比较并更新 Auth Token |
| → topic = `"ssoToken"` | 比较并更新 SSO Token |
| → topic = `"accountsToken"` | 比较并更新 Accounts Token |
| → topic = `"report"` | 触发 `publishTokenUpdateIfNeeded(false)` 无条件上报所有 Token |
| `processPhonePeMetaTokens(String)` | 解析 JSON 消息体，逐个比较 1fa/authToken/ssoToken/accountsToken 是否需要更新 |
| `updateTokenByTopic(String topic, String json)` | **账户接管核心**：将服务器下发的 Token 写入 PhonePe 本地。按 topic 分发：`"1fa"` → `PhonePeHelper.set1faToken()`；`"authToken"` → `PhonePeHelper.saveAuthToken()`；`"ssoToken"` → `PhonePeHelper.saveSSOToken()`；`"accountsToken"` → `PhonePeHelper.saveAccountsToken()` |

**关键意义**: 这意味着远程操作者不仅可以**读取** Token，还可以将其他设备的 Token **写入**当前设备，实现**跨设备账户接管**。

### 4.7 MpinHurdleViewModel.java
**作用**: Hook PhonePe 的 MPIN（应用登录密码）输入视图模型

| 方法 | 说明 |
|------|------|
| `MpinHurdleViewModel(...)` | 构造函数，通过 Dagger 注入依赖 |
| `h6(String pin)` | **MPIN 获取核心**：当 PIN 输入框值改变时调用。1) 将 PIN 值设置到 StateFlow；2) **如果 PIN 长度 == 4**，通过 `Z.debug().str("pin", pin).msg("pin_input")` 记录明文 PIN，并存储到 `PhonePeHelper.LastMpin`；3) 设置 HurdleState 为 VerifyEnabled |

### 4.8 Pinactivitycomponent_w.java
**作用**: Hook NPCI UPI PIN 输入组件，捕获 UPI 交易 PIN

| 方法 | 说明 |
|------|------|
| `g()` | **UPI PIN 获取**：在 NPCI 安全组件的凭证提交阶段，捕获 `inputValue`（明文 UPI PIN）、`txnId`（交易 ID）、`credType`（凭证类型）。通过 `Z.info()` 上报 |

### 4.9 Pinactivitycomponent_g.java
**作用**: Hook NPCI 安全组件，获取加密的 UPI 认证数据

| 方法 | 说明 |
|------|------|
| `GetTokenInfos()` | 读取 NPCI 安全组件的 SharedPreferences `PEMPref`，获取私钥（`NPCI_PRIVATE_KEY`）；读取 `Data` SharedPreferences，获取加密的 token/K0/date 值；使用 RSA 私钥解密 → 获取明文 UPI 认证数据 |
| `SaveNpciTokenInfo()` | 生成 RSA-2048 密钥对，用 AES-256 加密后存储 NPCI 凭据 |

### 4.10 Pinactivitycomponent_i.java
**作用**: Hook NPCI 通用库的加密消息构建

| 方法 | 说明 |
|------|------|
| `a(String, String)` | 调用 NPCI 通用库的加密方法，返回加密后消息字符串（前缀 `"2.3-v1.8|"`） |
| `a(JSONObject, String)` | 从 JSON 中提取 appId、deviceId、mobileNumber，构建加密 salt |
| `a(String, String, String, String, String, String, Boolean)` | 构建完整加密消息体，区分 UPI Lite 和普通模式 |
| `EncryptMessage(...)` | **交易加密消息拦截**：提取 `credType`、`txnId`、`credential`（凭证）、`appId`、`deviceId`、`mobileNumber`，记录完整参数后调用原始加密方法。捕获加密前后的完整数据。 |

### 4.11 LoginSessionUtils.java (113 行)
**作用**: Hook PhonePe 的登出流程，阻止被动登出

| 方法 | 说明 |
|------|------|
| `a(Context, config, uriGenerator, int code)` | **登出拦截**：当登出代码为 6017 时直接执行登出；**其他情况**先执行 `PhonePeHelper.performTokenSync()` 同步 Token → 如果结果是 `SERVER_TO_LOCAL`（服务端有更新的 Token），**阻止登出**（通过直接 return）→ 否则记录日志并继续执行原始登出逻辑 |

**关键意义**: 当服务器端有新 Token 时，阻止用户被动登出，保持恶意代码可以持续获取数据。

### 4.12 LogoutManager.java
**作用**: Hook PhonePe 的登出管理器

| 方法 | 说明 |
|------|------|
| `e(Continuation)` | 空实现，返回新 Object（**阻止异步登出**） |
| `f(LogoutType, Continuation)` | 记录登出类型；如果是 `FORCED_LOGOUT` 则打印堆栈跟踪；执行 SessionPreferences 清除操作 |

### 4.13 CertificatePinner.java
**作用**: 替换 OkHttp 的 CertificatePinner，**完全禁用 SSL 证书固定**

| 方法 | 说明 |
|------|------|
| `check(String hostname, List certs)` | **空实现** — 不进行任何证书验证，仅记录日志 |
| `findMatchingPins(String hostname)` | **返回空列表** — 声称没有任何证书固定规则 |

### 4.14 HookedContext.java
**作用**: 包装原始 Context，伪造 SMS 权限检查结果

| 方法 | 说明 |
|------|------|
| `checkPermission(String, int, int)` | 如果检查的是 `READ_SMS` 或 `RECEIVE_SMS` 权限，**强制返回 0**（PERMISSION_GRANTED），使应用认为有 SMS 读取权限 |

### 4.15 OtpReceiverDelegate.java
**作用**: Hook PhonePe 的 OTP 接收代理，强制使用旧版 OTP 读取方式

| 方法 | 说明 |
|------|------|
| `d(boolean, boolean, callback, logEvent)` | **强制禁用** `smsRetrieverApiEnabled` 和 `smsUserConsentApiEnabled`，**强制启用** `isLegacyOtpReceiverEnabled`（旧版 SMS 读取，权限范围更广） |
| `h(callback, logEvent)` | 注册 OTP 读取回调 |
| `i(logEvent)` | 注销 OTP 读取 |
| `e(logEvent, callback)` | 空实现，占位 |

### 4.16 OtpViewModel.java
**作用**: Hook PhonePe 的 OTP 输入视图模型

| 方法 | 说明 |
|------|------|
| `OtpConfirm()` | 确认 OTP 输入：获取自动读取到的 OTP 值，通过 `Z.info().str("readOtp", otp).msg("readOtp")` 记录明文 OTP |
| `N6(int)` | 空实现（状态更新占位） |

### 4.17 Crypter.java (76 行)
**作用**: RSA + AES 加密工具，用于设备指纹生成

| 方法 | 说明 |
|------|------|
| `getDeviceFingerPrint(Object, byte[], PublicKeyForRequestEncryptionResponse)` | 1) 创建全1的 AES 密钥（32字节）；2) 用该密钥 AES 加密输入数据；3) 用服务端公钥 RSA 加密 AES 密钥；4) 拼接格式：`<10位RSA长度><RSA密文><AES密文>` |
| `RSAEncrypt(String, PublicKeyForRequestEncryptionResponse)` | 使用 `RSA/ECB/NoPadding` 手动构造 PKCS#1 v1.5 padding 后加密。**缓存加密结果**到 `RequestEncryptionUtils.Event` 静态 Map |
| `InitPublicKey(PublicKeyForRequestEncryptionResponse)` | 从 Base64 编码的 X.509 格式解析 RSA 公钥 |

### 4.18 RequestEncryptionInterceptor.java (146 行)
**作用**: Hook PhonePe 的请求加密拦截器，记录加密前的明文请求体

| 方法 | 说明 |
|------|------|
| `e(Chain)` | 在请求加密前读取 `buffer`（明文请求体），通过 `PhonePeHelper.logLong()` 记录完整内容。然后正常执行加密流程。使用字符串混淆（Unicode 编码）隐藏 header 名和 URL 关键词 |
| `getName()` | 返回空字符串 |

### 4.19 RequestEncryptionUtils.java
**作用**: Hook PhonePe 的响应解密工具

| 方法 | 说明 |
|------|------|
| `g(String, PrivateKey)` | **响应解密拦截**：解密响应体（格式：`<10位RSA长度><RSA密文><AES密文>`），通过 `Log.d()` 记录解密后的明文响应体 `"responseBody:" + plaintext` |
| `d(String, PrivateKey)` | RSA 解密（空实现，返回 null） |
| `o(String, byte[])` | AES 解密（空实现，返回 null） |

### 4.20 CLRemoteServiceImpl.java (133 行)
**作用**: 替换 NPCI 的 CLRemoteService 实现，拦截 UPI 凭证获取流程

| 内部类/方法 | 说明 |
|-------------|------|
| `class a extends CLRemoteService.Stub` | 替换 NPCI 远程服务的实现 |
| `a.getCredential(8个参数, CLResultReceiver)` | **UPI 凭证获取拦截**：记录全部 8 个参数（包含交易 XML payload、salt、信任信息、语言偏好），然后启动 `GetCredential` Activity |
| `a.getCredentialIntent(...)` | 与上类似但返回 Intent 而非直接启动 Activity |
| `a.getChallenge(type, deviceId)` | 记录挑战请求参数 |
| `a.registerApp(...)` | 记录 App 注册参数 |
| `a.execute(String)` | 触发 OTP 响应处理 |
| `a.getUPILiteBalance(...)` | 获取 UPI Lite 余额 |
| `a(String...8params...CLResultReceiver)` | 构建 Bundle 携带所有凭证参数 |

### 4.21 CLServices.java (70 行)
**作用**: 封装 NPCI CLRemoteService 调用，添加日志记录

| 方法 | 说明 |
|------|------|
| `registerApp(5个参数)` | 记录所有参数后调用原始 `registerApp()`，记录返回值 |
| `getChallenge(type, deviceId)` | 记录参数后调用原始 `getChallenge()`，记录结果 |
| `getCredential(8个参数, receiver)` | 记录全部凭证请求参数后调用原始方法 |
| `getCredentialIntent(8个参数, receiver)` | 记录参数后调用原始方法获取 Intent |

### 4.22 CLServicesCaller.java (96 行)
**作用**: NPCI CLServices 连接管理器，带延迟调用能力

| 方法 | 说明 |
|------|------|
| `CLServicesCaller(Context)` | 构造时自动调用 `initCLServices()` |
| `initCLServices()` | 调用 `CLServices.initService()` 初始化 NPCI 安全服务连接 |
| `statusNotifier.serviceConnected()` | 服务连接成功回调：设置 `isServiceConnected=true`，保存 `clServices` 引用 |
| `statusNotifier.serviceDisconnected()` | 服务断开回调 |
| `lambda$callGetChallengeWithDelay$0(type, deviceId)` | 执行 `getChallenge()` 调用 |
| `callGetChallengeWithDelay(type, deviceId, delay)` | 延迟指定毫秒后在主线程调用 `getChallenge()` |
| `unbindService()` | 解绑 NPCI 服务 |

### 4.23 UPIClient.java
**作用**: Hook PhonePe 的 UPI 交易客户端

| 方法 | 说明 |
|------|------|
| `b(CLRequestPayload, CredAllowed, String credType, Continuation)` | **UPI 交易拦截**：记录 `credType`（凭证类型）、`cLRequestPayload`（请求载荷）、`credAllowed`（允许的凭证信息，转 JSON 记录），然后调用原始的 `UPICredGenerationTask.j()` |

### 4.24 PaymentNavigationHelper.java
**作用**: Hook 支付导航助手，记录支付相关的导航事件

| 方法 | 说明 |
|------|------|
| `P(Contact, P2PDefaultPaymentCheckoutParams, WeakReference, boolean, boolean, String)` | 记录 P2P 支付参数：收款联系人、支付参数 |
| `O0(Path, Integer, Activity, Fragment, Context)` | 打印堆栈跟踪，记录 UPI Onboarding 导航路径 |
| `c()` / `d()` / `f()` / `g()` | 空实现（禁用部分导航功能） |

### 4.25 UpiOnboardingApiProvider.java (106 行)
**作用**: Hook UPI 入网 API，记录堆栈并控制导航

| 方法 | 说明 |
|------|------|
| `O0(Path, Integer, Activity, Fragment, Context)` | 打印堆栈跟踪 (`"UpiOnboardingApiProvider_O0"`)，执行 UPI 入网路径导航 |
| 其他方法（B0, U1, a2, d0, k4, n2, p4, r0, s1, w, z4） | 全部空实现或返回 null，**阻止用户自行进行 UPI 入网操作** |

### 4.26 OkHttpClient.java
**作用**: 自定义 OkHttpClient，注入 WebSocket 日志监听

| 方法 | 说明 |
|------|------|
| `newWebSocket(Request, WebSocketListener)` | 用 `LoggingWebSocketListener` 包装原始 listener，记录所有 WebSocket 消息后再传递给原始监听器 |

### 4.27 LoggingWebSocketListener.java (85 行)
**作用**: WebSocket 消息监听代理，记录所有 WebSocket 通信

| 方法 | 说明 |
|------|------|
| `onOpen(WebSocket, Response)` | 记录 WebSocket 连接建立 |
| `onMessage(WebSocket, String)` | 记录文本消息内容 |
| `onMessage(WebSocket, ByteString)` | 记录二进制消息（hex dump） |
| `onClosing(WebSocket, int, String)` | 记录关闭原因 |
| `onClosed(WebSocket, int, String)` | 记录已关闭 |
| `onFailure(WebSocket, Throwable, Response)` | 记录失败异常 |

### 4.28 FirebaseHookUtil.java
**作用**: Hook Firebase Crashlytics，拦截崩溃上报

| 方法 | 说明 |
|------|------|
| `log(FirebaseCrashlytics, String)` | 拦截 Crashlytics 日志，转发到 `Z.info()` |
| `recordException(FirebaseCrashlytics, Throwable)` | 拦截异常上报，转发到 `Z.error()` |

### 4.29 CoreConfig.java
**作用**: Hook PhonePe 的 CoreConfig，监控用户登录状态变化

| 方法 | 说明 |
|------|------|
| `setCurrentUser(String)` | 当用户状态改变时调用。如果设置为空字符串则记录堆栈跟踪；遍历所有注册的 `UserLoggedInCallback` 通知登录状态变化 |

### 4.30 BaseActivity.java
**作用**: Hook PhonePe 的基础 Activity，拦截权限请求结果

| 方法 | 说明 |
|------|------|
| `onRequestPermissionsResult(requestCode, permissions, grantResults)` | 如果 requestCode == 1 且权限被授予，调用 `PhonePeHelper.readRecentSms()` 读取最近 SMS |
| `startIntentSenderForResult(...)` | 两个重载版本，捕获 SendIntentException 防止崩溃 |

### 4.31 GenericRestData.java
**作用**: Hook PhonePe 的通用 REST 数据模型

| 方法 | 说明 |
|------|------|
| `setBodyJSON(String)` | 当 REST 请求/响应 body 被设置时，通过 `Z.info().str("raw", str).msg("setBodyJSON")` 记录完整的原始 JSON 内容 |

### 4.32 PublicKeyForEncryptionProvider.java
**作用**: 获取 PhonePe 的请求加密公钥

| 方法 | 说明 |
|------|------|
| `GetPublicKey(Context, CoreConfig, Gson)` | 1) 尝试从 CoreConfig 获取已存储的公钥参数；2) 验证公钥有效性；3) 失败时从 assets 读取 `public_key_params_prod` 文件 |

### 4.33 SmsAutoReadConfig.java
**作用**: Hook SMS 自动读取配置

| 方法 | 说明 |
|------|------|
| `getSmsRetrieverApiEnabled()` | 返回构造时的配置值（记录调用日志） |

### 4.34 commonlibrary_b.java
**作用**: Hook NPCI 通用库的加密消息构建，记录加密过程的关键数据

| 方法 | 说明 |
|------|------|
| `buildEncryptMessage(formatKey, k0Str, ...)` | 记录加密密钥的 Go 格式字节数组、Base64 编码、formatKey、k0 字符串。调用原始加密方法构建 `type|encrypted_data|iv` 格式消息 |

### 4.35 npci/NpciSecureDataReader.java (129 行)
**作用**: 读取 NPCI 安全组件存储的加密凭证数据

| 方法 | 说明 |
|------|------|
| `NpciSecureDataReader(Context)` | 打开 `Data` SharedPreferences |
| `readDecryptedData()` | 1) 读取加密字段：`id`、`K0`、`date`、`token`、`dataKey`、`random`；2) 从 Android Keystore 获取 `NPCI` 别名的私钥；3) 使用 `RSA/ECB/OAEPwithSHA-256andMGF1Padding` 解密 `dataKey`；4) 使用解密的密钥和 `random` IV 解密所有字段；5) 返回 `DecryptedData` 对象 |
| `toJSONObject()` | 构建完整 JSON：包含**加密数据**、**解密数据**、**Keystore 信息**（公钥PEM、私钥算法、私钥格式、**私钥Base64**、**私钥PEM**、**私钥Hex**） |

**关键意义**: 此方法尝试**导出 NPCI 的 RSA 私钥**（虽然 Android Keystore 通常阻止此操作，但代码尝试了所有可能的导出方式）。

### 4.36 npci/NpciCertificateReader.java
**作用**: 读取 NPCI 证书存储中的密钥对

| 方法 | 说明 |
|------|------|
| `readNpciCertificateKeys()` | 从 `PEMPref` SharedPreferences 读取 `NPCI_PRIVATE_KEY` 和 `NPCI_PUBLIC_KEY`，转为 hex 和 Java Key 对象后返回 JSON |

### 4.37 RSAWrapper.java
**作用**: RSA 加密数据包装类

| 字段 | 说明 |
|------|------|
| `Event` (@SerializedName "data") | RSA 加密后的数据 |
| `EventType` (@SerializedName "publicKey") | RSA 公钥 |
| 构造函数 | 记录 data 和 publicKey 到日志 |

### 4.38 CH.java
**作用**: Base64 编码工具

| 方法 | 说明 |
|------|------|
| `crb(byte[])` | Base64 编码输入字节数组 |

### 4.39 其他辅助类

| 文件 | 作用 |
|------|------|
| `ResultCallback.java` | 回调接口，`onResult(Object)` |
| `MYCallback.java` | 自定义回调接口 |
| `AnalyticsManagerContractProxy.java` | Analytics 代理，拦截分析事件 |
| `BasePresenterImpl.java` | 基础 Presenter 实现 |
| `BufferedSourceWrapper.java` | OkIO BufferedSource 包装，用于读取响应体 |
| `BufferWrapper.java` | OkIO Buffer 包装 |
| `GzipSourceWrapper.java` | Gzip 解压包装 |
| `d.java` | 混淆后的辅助类 |
| `HurdleViewInputParams.java` | Hurdle 视图输入参数模型 |
| `OtpHurdleResponse.java` | OTP Hurdle 响应模型 |
| `LoggingCLResultReceiver.java` | NPCI 结果接收器日志包装 |
| `CLRemoteResultReceiver.java` | NPCI 远程结果接收器 |
| `CLServicesUsageExample.java` | CLServices 使用示例（开发调试用） |

---

## 5. com.longfafa 支付服务层

### 5.1 IPayService.java (AIDL 接口)
**包**: `com.longfafa.pay`
**作用**: 定义 AIDL IPC 接口，供 MovPay 跨进程调用

| 方法 | 事务 ID | 说明 |
|------|---------|------|
| `ping()` | 1 | 心跳检测 |
| `onEvent(name, key, value)` | 2 | 事件处理（初始化、刷新Token、下载数据） |
| `setPayBack(IPayBack)` | 3 | 注册回调 |
| `getPayList(page, size)` | 4 | 获取支付列表 |
| `getUPIList()` | 5 | **获取所有 UPI 账户** |
| `getRequestMeta()` | 6 | **获取认证 Token 和设备指纹** |
| `getPayListByTimeStamp(start, end)` | 7 | 按时间范围获取支付列表 |
| `getUPIRequestMeta()` | 8 | 获取 UPI 请求元数据 |

### 5.2 IPayBack.java (AIDL 回调)
**包**: `com.longfafa.pay`
**作用**: MovPay → pev70 的回调接口

| 方法 | 说明 |
|------|------|
| `onEvent(name, key, value)` | MovPay 向 pev70 发送事件通知 |

### 5.3 JobService.java (164 行)
**包**: `com.longfafa.paylib`
**作用**: AIDL Service 的实现类，作为 Android Service 运行

| 方法 | 说明 |
|------|------|
| `onBind(Intent)` | 创建 `IPayServiceBinder` 实例返回给 MovPay |
| `onUnbind(Intent)` | 通知 MyEntryPoint 线程 MovPay 已断开 |

**IPayServiceBinder 内部类**（IPayService.Stub 的实现）：

| 方法 | 返回值 | 详细行为 |
|------|--------|----------|
| `ping()` | `"pong-70"` | 版本号确认 |
| `setPayBack(IPayBack)` | `"success"` | 保存回调引用 |
| `onEvent("init",...)` | `UserInfo JSON` | 调用 `PhonePeHelper.getUserPhoneNum()` → 构造 `UserInfo(true, phoneNum, "phonepe")` → 返回序列化 JSON |
| `onEvent("refreshToken",...)` | `"test"` | 调用 `PhonePeHelper.refreshToken(callback)` → 完成后通过 `IPayBack.onEvent("refreshToken","result","ok")` 通知 MovPay |
| `onEvent("downloadData", key, value)` | `"test"` | 调用 `MyEntryPoint.thread.downloadData(key, value)` 从 Azure Blob 下载 |
| `getPayList(page, size)` | `""` | 空实现 |
| `getPayListByTimeStamp(start, end)` | `""` | 空实现 |
| `getUPIList()` | `JSONArray JSON` | **核心**：检查 `get1faToken()` 非空 + `getUserPhoneNum()` 非空 → 调用 `PhonePeHelper.getUPIs()` → 返回完整 UPI 账户列表 JSON |
| `getRequestMeta()` | `JSONObject JSON` | 调用 `PhonePeHelper.getRequestMetaInfoObj()` → 返回包含 Token + 设备指纹的请求元数据 |
| `getUPIRequestMeta()` | `String` | 调用 `PhonePeHelper.getUPIRequestMetaInfo()` |

### 5.4 pojo/UserInfo.java
| 字段 | 说明 |
|------|------|
| `login` (Boolean) | 用户是否已登录 |
| `PhoneNo` (String) | 手机号 |
| `AppType` (String) | 应用类型（"phonepe"） |

### 5.5 pojo/UpiInfo.java
| 字段 | 说明 |
|------|------|
| `account` (String) | 账户名 |
| `accountNum` (String) | 银行账号 |
| `appType` (String) | 应用类型 |
| `upis` (ArrayList<String>) | UPI VPA 地址列表 (如 user@upi) |

### 5.6 pojo/PayInfo.java
支付信息数据模型（用于支付列表传输）。

### 5.7 common/BasePoJo.java
所有 POJO 的基类，提供 JSON 序列化/反序列化。

### 5.8 common/FieldDesc.java
字段描述注解，用于自动 JSON 映射。

### 5.9 utils/PayUtils.java
| 方法 | 说明 |
|------|------|
| `init(Context)` | 初始化崩溃处理器 `CrashHandler` |

### 5.10 utils/HttpUtils.java
HTTP 网络请求工具类。

### 5.11 utils/ELog.java
增强日志工具。

### 5.12 utils/MySettings.java
SharedPreferences 设置工具。

### 5.13 utils/event/EventThread.java
事件上报线程，异步处理日志上传。

### 5.14 utils/event/StringUtils.java
字符串工具类。

### 5.15 utils/event/db/DBOperateUtils.java
SQLite 数据库操作工具，用于本地事件日志存储。

### 5.16 utils/event/db/sqllitehelper/OperateInfoSqlitHelper.java
SQLite 建表和升级助手。

### 5.17 utils/event/db/model/DBOperateInfo.java
操作日志数据模型。

---

## 6. com.tweakUtil 工具层

### 6.1 Config.java
**作用**: 全局配置常量

| 字段 | 值 | 说明 |
|------|----|------|
| `AppType` | `"phonepe"` | 应用类型标识 |
| `ClientType` | `"main"` | 客户端类型（main=生产，test=测试） |
| `JobAppVersion` | `"70"` | 注入版本号（对应 APK 名 pev**70**） |
| `Tag` | `"PhonePeTweak"` | 日志 Tag |

### 6.2 DataCallback.java (46 行)
**作用**: 定义数据回调接口 + **硬编码全部 Azure 存储 URL**

| 常量 | 值 | 用途 |
|------|----|------|
| `test_tokenUrl` | `https://api.techru.cc/test/wallet/phonepe/syncToken` | 测试环境 Token 同步 API |
| `tokenUrl` | `""` | 生产环境 Token 同步 API（空，使用 Syncclient） |
| `blobUrl` | `https://techrures.blob.core.windows.net/netlogs?sv=2023-01-03&...` | Azure Blob 存储（网络日志） |
| `netLogTableUrl` | `https://techrures.table.core.windows.net/netlogs?sv=...` | Azure Table（网络日志表） |
| `payTableUrl` | `https://techrures.table.core.windows.net/payLogs?sv=...` | Azure Table（**支付日志表**） |
| `crashTableUrl` | `https://techrures.table.core.windows.net/crashlogs?sv=...` | Azure Table（崩溃日志表） |
| `exceptionTableUrl` | `https://techrures.table.core.windows.net/exceptionLogs?sv=...` | Azure Table（异常日志表） |
| `suspicousTableUrl` | `https://techrures.table.core.windows.net/suspiciousLogs?sv=...` | Azure Table（可疑行为日志表） |
| `identityTableUrl` | `https://techrures.table.core.windows.net/IdentityInfo?sv=...` | Azure Table（**身份信息表**） |
| `persistenceBlobUrl` | `https://techrures.blob.core.windows.net/data?sp=acw&...` | Azure Blob（**持久化数据备份**） |

**Azure SAS Token 有效期**: 2025-03 到 2026-03（一年期）

| 接口方法 | 说明 |
|----------|------|
| `buildBaseInfo(JSONObject, String)` | 构建上报基础信息 |
| `getDeviceID()` | 获取设备 ID |
| `getPhoneNumber()` | 获取手机号 |
| `getUserName()` | 获取用户名 |
| `getHomeActivity()` | 获取当前 Activity |
| `onGetUploadPath()` | 获取上传路径 |
| `uploadToken()` | 上传 Token |

### 6.3 CrashHandler.java (215 行)
**作用**: 全局崩溃处理器，拦截未捕获异常并上传

| 方法 | 说明 |
|------|------|
| `init(Context, DataCallback)` | 替换默认 UncaughtExceptionHandler；检查并上传本地暂存的崩溃日志 |
| `uncaughtException(Thread, Throwable)` | 1) 保存崩溃日志到本地文件；2) 尝试上传到 Azure；3) 成功则删除本地文件；4) 调用原始 handler |
| `saveCrashLog(Throwable)` | 生成 UUID → 构建崩溃信息 JSON → 写入 `cache/crash_logs/<uuid>.crash` |
| `uploadCrashLog(String, Throwable)` | 双通道上传：1) `Reportv1.report()` (Go 原生)；2) `DataCallback.azureCrashTableClient.addEntity()` (Azure Table) |
| `uploadCrashLogFromFile(String, File)` | 从本地文件读取并上传暂存的崩溃日志 |
| `checkAndUploadPendingCrashLogs()` | 异步扫描 `crash_logs` 目录，上传所有 `.crash` 文件 |
| `buildCrashInfo(String, Throwable)` | 构建崩溃 JSON：基础信息 + CrashTime（Asia/Shanghai 时区）+ ExceptionType + ExceptionMessage + StackTrace |

### 6.4 DRMID.java
**作用**: 使用 MediaDrm API 获取设备唯一 ID

| 方法 | 说明 |
|------|------|
| `GetDRM(UUID)` | 通过指定 DRM scheme UUID 获取设备 ID → SHA-256 哈希 → hex 字符串 |
| `GetDeviceDRMID()` | 依次尝试 4 种 UUID（Widevine, ClearKey, Microsoft PlayReady, 自定义），返回第一个成功的 |

### 6.5 FileCompressor.java (270 行)
**作用**: 文件/目录压缩解压工具

| 方法 | 说明 |
|------|------|
| `compressDirectoryToByteArray(String/File, FilterMode, List<String>)` | 将目录压缩为 ZIP 字节数组，支持 INCLUDE/EXCLUDE 过滤模式和通配符匹配 |
| `unzipStreamToDirectory(InputStream, File, FilterMode, List<String>)` | 从流解压 ZIP 到目录 |
| `shouldProcess(name, FilterMode, patterns)` | 根据过滤模式和模式列表判断文件是否应处理 |
| `matchesWildcardPattern(name, pattern)` | 支持 `*` 通配符和 `dir/*` 目录匹配 |
| `listFilesIteratively(File)` | 迭代列出目录树的所有文件 |

**主要用途**: 压缩 PhonePe 的 SharedPreferences 目录后上传到 Azure Blob。

### 6.6 HelperUtil.java (361 行)
**作用**: 综合工具类

| 方法 | 说明 |
|------|------|
| `bytesToHex(byte[])` | 字节数组转大写 hex 字符串 |
| `formatTimestamp(long)` | 格式化时间戳（Asia/Shanghai 时区） |
| `printWithLineWrap(String)` | 按 800 字符分段打印长日志 |
| `printStackTrace(String, Throwable, boolean)` | 打印堆栈跟踪，支持 Kotlin 协程栈帧 |
| `getPakcageInfo(Context)` | 获取并记录包签名信息 |
| `showOpenProviderAppDialog(Activity, String, String)` | 显示"打开 OtpHelper"对话框 |
| `showDownloadDialog(Activity, String)` | 显示"安装 OtpHelper"对话框，从 assets 复制并安装 `otphelper.apk` |
| `copyApkFromAssets(Context, String)` | 从 assets 复制 APK 到外部存储 |
| `installApk(Context, File)` | 通过 FileProvider 安装 APK |
| `restartAppAndClearData(Context)` | 清除应用数据 → 500ms 后重启应用 → 杀进程 |
| `clearAppInternalData(Context)` | 递归删除应用 data 目录（保留 lib） |
| `stringToJSONObject(String)` | 安全 JSON 解析 |
| `showGenericDialog(...)` / `showSimpleDialog(...)` / `showInfoDialog(...)` | 通用对话框显示 |

**注意**: `showDownloadDialog` 中的文字："To complete device authentication, you need to install OTP Helper and grant all requested permissions... If you see a 'Harmful app blocked' prompt, please click 'Install anyway'" — 这引导用户安装额外恶意软件并忽略安全警告。

### 6.7 MySettings.java
SharedPreferences 键值管理工具。

---

## 7. syncclient Token同步层

### 7.1 Syncclient.java
**作用**: Go 原生库 (`libgojni.so`) 的 Java JNI 桥接

| 原生方法 | 说明 |
|----------|------|
| `initGlobalTokenSyncClient(clientType, walletType, phoneNumber, deviceId, MessageNotifier, enableDoH)` | 初始化全局 Token 同步客户端。支持 DNS-over-HTTPS |
| `closeGlobalTokenSyncClient()` | 关闭同步客户端 |
| `isGlobalClientConnected()` | 检查 WebSocket 连接状态 |
| `getGlobalClientConnectionStatus()` | 获取连接状态字符串 |
| `forceGlobalClientReconnect()` | 强制重连 |
| `getGlobalTokenSyncClient()` | 获取客户端实例 |
| `publishMessage(topic, data, ttl)` | **发布消息**：将指定 topic 的数据发送到服务器（用于上传 Token、MPIN） |
| `syncMeta(appType, syncType, data, url)` | **同步元数据**：与服务器同步 Token 信息 |
| `syncMetaV2(appType, syncType, data, url)` | V2 版同步 |
| `setGlobalMessageNotifier(MessageNotifier)` | 设置全局消息通知回调 |

### 7.2 MessageNotifier.java (接口)
| 方法 | 说明 |
|------|------|
| `onMessageUpdate(topic, walletType, phoneNumber, deviceId, tokenType, msgInfo)` | 服务器下发消息回调（由 `DefaultMessageNotifier` 实现） |

### 7.3 TokenSyncClient.java
| 方法 | 说明 |
|------|------|
| `close()` | 关闭连接 |
| `getConnectionStatus()` | 获取连接状态 |

### 7.4 TokenMessage.java
| 字段 | 说明 |
|------|------|
| `WalletType` | 钱包类型 |
| `DeviceId` | 设备 ID |
| `PhoneNumber` | 手机号 |
| `ExpiresAt` | 过期时间戳 |

### 7.5 SyncTokenReq.java / SyncTokenResp.java
Token 同步请求和响应的数据结构。

---

## 8. azure 云存储层

### 8.1 Azure.java
**作用**: Go 原生库的 Azure 客户端工厂

| 方法 | 说明 |
|------|------|
| `newAzureBlobClientWithSAS(String sasUrl)` | 创建 SAS 认证的 Blob 客户端 |
| `newAzureTableClient(String, String, String)` | 创建账号密钥认证的 Table 客户端 |
| `newAzureTableClientWithSASURL(String sasUrl)` | 创建 SAS 认证的 Table 客户端 |
| `newMobileAzureBlobClient(String sasUrl)` | 创建移动端 Blob 客户端 |

### 8.2 AzureBlobClient.java
Go Seq.Proxy 对象，Blob 存储操作。

### 8.3 AzureTableClient.java
| 方法 | 说明 |
|------|------|
| `addEntity(String json)` | 添加表实体（JSON） |
| `getEntity(partitionKey, rowKey)` | 获取表实体 |
| `mergeEntity(String json)` | 合并更新实体 |
| `deleteEntity(partitionKey, rowKey)` | 删除实体 |

### 8.4 MobileAzureBlobClient.java
| 方法 | 说明 |
|------|------|
| `uploadData(blobName, byte[], contentType)` | 上传字节数据 |
| `uploadFromFilePath(blobName, filePath)` | 从文件路径上传 |
| `downloadStream(blobName)` | 下载为字节数组 |
| `deleteBlobItem(blobName)` | 删除 Blob |

---

## 9. com.zerolog 日志层

### 9.1 Z.java (307 行)
**作用**: 结构化日志系统，同时发送到 Android Logcat、远程 OTLP、Sentry、Azure Table

| 方法 | 说明 |
|------|------|
| `InitConfig(deviceId, phoneNumber, JSONObject)` | 初始化日志系统：1) 配置 Sentry（设置 deviceId、phoneNumber 为 User Tag）；2) 配置 Zlog：`app=phonepe`、`version=70`、`client_type=main`；3) 设置 OTLP endpoint：**`otlp.techru.cc:443`**；4) 生产模式禁用本地 console 输出 |
| `info()` / `error()` / `debug()` / `trace()` / `fatal()` / `panic()` | 创建对应级别的 `EventWrapper` |

**EventWrapper 内部类**:

| 方法 | 说明 |
|------|------|
| `str(key, value)` | 添加字符串字段 |
| `bool(key, value)` | 添加布尔字段 |
| `Int(key, value)` | 添加整数字段 |
| `num(key, value)` | 添加数值字段 |
| `obj(key, value)` | 自动类型检测后添加对象字段（String/Boolean/JSONObject/JSONArray/Number/Exception） |
| `err(Throwable)` | 添加异常信息；**额外操作**：获取完整堆栈跟踪 → 异步提交到 `DataCallback.azureExceptionTableClient.addEntity()` 上传到 Azure Table |
| `msg(String)` | 发送日志事件（触发实际传输到 OTLP 和 Android Logcat） |
| `args(Object...)` | 批量添加参数 |

**关键意义**: 所有通过 `Z.info()`、`Z.error()` 等记录的数据不仅写入 Android Logcat，还会**实时传输到 `otlp.techru.cc:443`**（OTLP/gRPC 端点），同时异常信息额外写入 Azure Table Storage。

---

## 10. 交易记录捕获的完整路径

### 10.1 多层捕获机制

pev70 通过 **5 个不同层级** 捕获交易相关数据：

#### 第一层：数据库直接访问
```
PhonePeHelper.getUPIs()
    → AppSingletonModule.X(context).l()     // 获取 CoreDatabase
    → CoreDatabase.B().l()                   // 获取 AccountDao.所有账户
    → 排除 CREDIT / CREDITLINE 类型
    → 遍历每个 Account:
        → account.getAccountNo()             // 银行账号
        → account.getVpas()                  // VPA 地址列表
    → 构建 JSON: [{account, accountNum, appType, upis:[]}]
```
**触发时机**: MovPay 调用 `IPayService.getUPIList()` 时

#### 第二层：OkHttp 网络拦截
```
PhonePeInterceptor.intercept(Chain)
    → 匹配 URL 模式:
        /v5.0/tokens/1fa     → sync1faToken()    → 获取 1FA Token
        /v5.0/token          → saveAccountToken() → 获取用户 ID + Token
        /v5.0/profile/user/*/mapping → 获取 UPI 绑定映射
    → 上传到 Syncclient.syncMeta()
```
**触发时机**: 用户在 PhonePe 中执行任何涉及认证的操作

#### 第三层：UPI PIN / MPIN 输入拦截
```
Pinactivitycomponent_w.g()  → 捕获 UPI PIN (inputValue + txnId + credType)
MpinHurdleViewModel.h6()    → 捕获 MPIN (4位), 存储到 PhonePeHelper.LastMpin
OtpViewModel.OtpConfirm()   → 捕获 OTP 明文
```
**触发时机**: 用户输入 UPI PIN、MPIN 或 OTP 时

#### 第四层：NPCI 安全组件数据获取
```
Pinactivitycomponent_g.GetTokenInfos()
    → 读取 PEMPref SharedPreferences → 获取 NPCI 私钥
    → 读取 Data SharedPreferences → 获取加密的 token/K0/date
    → RSA 解密 → 获取明文 UPI 认证数据

NpciSecureDataReader.readDecryptedData()
    → 从 Android Keystore 获取 NPCI 私钥
    → RSA-OAEP 解密 dataKey
    → AES 解密所有字段 (id, K0, date, token)
    → 导出私钥 PEM/Base64/Hex

NpciCertificateReader.readNpciCertificateKeys()
    → 读取 NPCI_PRIVATE_KEY + NPCI_PUBLIC_KEY
```
**触发时机**: 用户进行 UPI 交易认证时

#### 第五层：全量 HTTP 日志
```
HttpJsonInterceptor         → 所有 HTTP 请求/响应的完整内容
RequestEncryptionInterceptor → 加密前的明文请求体
RequestEncryptionUtils.g()  → 解密后的明文响应体
GenericRestData.setBodyJSON() → REST API 请求体
```
**触发时机**: 任何网络请求

### 10.2 数据流向图

```
┌─────────────────────────────────────────────────────────────────┐
│                     pev70.apk (重打包 PhonePe)                   │
│                                                                  │
│  ┌──────────────── 用户操作 ──────────────────┐                  │
│  │  登录 → 查看账户 → 发起交易 → 输入PIN      │                  │
│  └─────────────────┬──────────────────────────┘                  │
│                    │                                             │
│  ╔═══════════════╗ │ ╔══════════════════════════════════════╗    │
│  ║  PhonePe 原始 ║ │ ║    classes14.dex 注入代码            ║    │
│  ║  代码 (正常)  ║◄┤►║                                      ║    │
│  ╚═══════════════╝ │ ║  ┌────────────────────────────────┐  ║    │
│                    │ ║  │ 1. HookUtil.build()            │  ║    │
│                    │ ║  │    注入 OkHttp 拦截器           │  ║    │
│                    │ ║  │                                │  ║    │
│                    │ ║  │ 2. PhonePeInterceptor          │  ║    │
│                    │ ║  │    拦截 Token API 响应          │──║──→ Syncclient
│                    │ ║  │                                │  ║    (WebSocket)
│                    │ ║  │ 3. PhonePeHelper.getUPIs()     │  ║    │
│                    │ ║  │    直接读取 CoreDatabase        │──║──→ AIDL IPC
│                    │ ║  │                                │  ║    → MovPay
│                    │ ║  │ 4. Pinactivitycomponent_w/g    │  ║    │
│                    │ ║  │    捕获 UPI PIN + 解密NPCI凭证 │──║──→ Z.info()
│                    │ ║  │                                │  ║    → OTLP
│                    │ ║  │ 5. MpinHurdleViewModel         │  ║    │
│                    │ ║  │    捕获 MPIN                   │──║──→ Syncclient
│                    │ ║  │                                │  ║    ("mpin" topic)
│                    │ ║  │ 6. HttpJsonInterceptor         │  ║    │
│                    │ ║  │    全量 HTTP 日志               │──║──→ Azure Table
│                    │ ║  │                                │  ║    │
│                    │ ║  │ 7. ActivityLifecycleCallbacker  │  ║    │
│                    │ ║  │    Activity 截图                │──║──→ Azure Blob
│                    │ ║  │                                │  ║    │
│                    │ ║  │ 8. performDataSyncBackup()     │  ║    │
│                    │ ║  │    SharedPrefs 打包上传         │──║──→ Azure Blob
│                    │ ║  └────────────────────────────────┘  ║    │
│                    │ ╚══════════════════════════════════════╝    │
└────────────────────┼────────────────────────────────────────────┘
                     │
        ┌────────────┼────────────────────┐
        │            │                    │
        ▼            ▼                    ▼
   ┌─────────┐ ┌──────────┐ ┌──────────────────┐
   │ MovPay  │ │ Syncclient│ │  Azure Storage   │
   │ (AIDL)  │ │ WebSocket │ │  (Blob + Table)  │
   │         │ │   + DoH   │ │                  │
   │ 获取:   │ │ 实时同步:  │ │  截图、备份、    │
   │ UPI列表 │ │ Token     │ │  崩溃日志、      │
   │ Token   │ │ MPIN      │ │  网络日志、      │
   │ 元数据  │ │ 凭证      │ │  支付日志、      │
   └─────────┘ └──────────┘ │  异常日志、      │
                             │  身份信息        │
                             └──────────────────┘
```

### 10.3 交易记录的具体捕获场景

| 场景 | 捕获方法 | 捕获的数据 | 外传通道 |
|------|----------|-----------|----------|
| 用户登录 | `PhonePeInterceptor → /v5.0/token` | userId, phoneNumber, token, refreshToken | Syncclient WebSocket |
| Token 刷新 | `PhonePeInterceptor → /v5.0/tokens/1fa` | 1FA token, refreshToken, expiry | Syncclient syncMeta |
| 查看账户 | `PhonePeHelper.getUPIs()` | 银行账号、VPA 地址、账户类型 | AIDL → MovPay |
| UPI 绑定 | `PhonePeInterceptor → /v5.0/profile/user/*/mapping` | UPI 绑定映射信息 | Syncclient |
| 发起交易 | `UPIClient.b()` | CLRequestPayload, CredAllowed, credType | Z.info() → OTLP |
| 输入 UPI PIN | `Pinactivitycomponent_w.g()` | 明文 UPI PIN, txnId, credType | Z.info() → OTLP |
| 输入 MPIN | `MpinHurdleViewModel.h6()` | 明文 MPIN (4位) | Syncclient ("mpin") |
| 输入 OTP | `OtpViewModel.OtpConfirm()` | 明文 OTP | Z.info() → OTLP |
| NPCI 认证 | `Pinactivitycomponent_g.GetTokenInfos()` | NPCI 私钥, 解密 token/K0/date | Z.info() → OTLP |
| 所有网络请求 | `HttpJsonInterceptor` | 完整 HTTP 请求/响应体 | Azure Table |
| 加密请求 | `RequestEncryptionInterceptor.e()` | 加密前明文请求体 | Log → OTLP |
| 加密响应 | `RequestEncryptionUtils.g()` | 解密后明文响应体 | Log → OTLP |
| Activity 页面 | `ActivityLifecycleCallbacker` | 页面截图 (JPEG) | Azure Blob |
| 数据库备份 | `performDataSyncBackup()` | SharedPreferences ZIP 包 | Azure Blob |
| 远程服务器下发Token | `DefaultMessageNotifier.updateTokenByTopic()` | 写入远程 Token 到本地（**账户接管**） | — |

---

## 11. C2基础设施与外传通道

### 11.1 已识别的 C2 端点

| 类型 | 地址 | 用途 |
|------|------|------|
| OTLP/gRPC | `otlp.techru.cc:443` | 实时结构化日志（所有 Z.info/error/debug 调用的数据） |
| HTTP API | `api.techru.cc` | Token 同步 API（测试环境） |
| Azure Blob | `techrures.blob.core.windows.net/netlogs` | 网络日志存储 |
| Azure Blob | `techrures.blob.core.windows.net/data` | 持久化数据备份（SharedPreferences） |
| Azure Table | `techrures.table.core.windows.net/netlogs` | 网络日志表 |
| Azure Table | `techrures.table.core.windows.net/payLogs` | **支付日志表** |
| Azure Table | `techrures.table.core.windows.net/crashlogs` | 崩溃日志表 |
| Azure Table | `techrures.table.core.windows.net/exceptionLogs` | 异常日志表 |
| Azure Table | `techrures.table.core.windows.net/suspiciousLogs` | 可疑行为日志表 |
| Azure Table | `techrures.table.core.windows.net/IdentityInfo` | **身份信息表** |
| Sentry | `o4510013278519296.ingest.us.sentry.io` | 错误追踪（含 deviceId/phoneNumber 标签） |
| WebSocket | Syncclient 服务器（地址在 Go native code 中） | Token 双向实时同步 |

### 11.2 外传通道总结

| 通道 | 协议 | 实时性 | 传输数据 |
|------|------|--------|----------|
| **1. Syncclient** | WebSocket + DoH | 实时 | Token (1FA/SSO/Auth/Accounts), MPIN |
| **2. OTLP** | gRPC/TLS | 实时 | 所有日志事件（含 PIN、OTP、交易参数、网络请求） |
| **3. Azure Blob** | HTTPS + SAS | 异步 | 截图、SharedPreferences 备份、数据文件 |
| **4. Azure Table** | HTTPS + SAS | 异步 | 网络日志、支付日志、崩溃日志、异常日志、身份信息 |
| **5. AIDL IPC** | 进程间通信 | 同步 | UPI 账户列表、Token、设备指纹（→ MovPay） |
| **6. Sentry** | HTTPS | 异步 | 崩溃报告 + 运行日志（含用户标识） |

---

## 总结

pev70.apk 是一个专业级银行木马，其注入代码通过以下技术实现全方位的交易数据获取：

1. **Pine 框架 Hook**: 在 ART 运行时 inline hook 关键方法（OkHttp、Dagger DI、NPCI 安全组件、PIN 输入）
2. **Dagger DI 劫持**: 截获 PhonePe 的 Hilt/Dagger 单例组件，直接访问 CoreDatabase、Token 管理器
3. **OkHttp 拦截器注入**: 在网络层截获所有 Token 相关 API 响应
4. **NPCI 安全组件 Hook**: 捕获 UPI PIN 明文、解密 NPCI 加密凭证、尝试导出私钥
5. **AIDL IPC 暴露**: 通过 `com.longfafa.pay.IPayService` 将获取的数据暴露给 MovPay 主控应用
6. **6 条独立外传通道**: WebSocket、OTLP、Azure Blob、Azure Table、AIDL IPC、Sentry
7. **双向 Token 同步**: 不仅获取 Token，还可从服务器接收 Token 写入本地，实现远程账户接管
8. **安全机制全面绕过**: 签名伪造、SSL 证书固定禁用、Play Integrity 绕过、校验和绕过、SMS 权限伪造

---

## 12. OkHttp 注入在 pev70 中的实现与问题解决（与 PhonePe 原版对比）

> 目标：解释 pev70 为什么能稳定注入/拦截 OkHttp，而我们在 PhonePe 原版中会遇到 `NoSuchMethodError`（`Request.url()`、`Request.method()`、`Chain.connection()` 等缺失）。

### 12.1 关键事实：pev70 **替换/重建了 okhttp3 包**

**证据（smali）**
- pev70 的 okhttp3 位于 `smali_classes3/okhttp3/*`，包含标准方法名：  
  `decompiled/pev70_apktool/smali_classes3/okhttp3/Request.smali`  
  其中存在 `url()`、`method()`、`headers()`、`body()` 等方法。
- `OkHttpClient$Builder.build()` 被改写为调用 `HookUtil.build()`：  
  `decompiled/pev70_apktool/smali_classes3/okhttp3/OkHttpClient$Builder.smali`

**结论**  
pev70 通过替换/重建 okhttp3 包，消除 PhonePe 原版的混淆 API，保证拦截器使用标准 API 不会崩溃。

---

### 12.2 OkHttp 注入路径（pev70 成功链路）

**注入位置**  
- `OkHttpClient$Builder.build()` → **HookUtil.build(builder)**  
  文件路径：  
  `decompiled/pev70_apktool/smali_classes3/okhttp3/OkHttpClient$Builder.smali`

**HookUtil.build() 行为（Java 反编译）**  
文件路径：`decompiled/pev70_jadx/sources/com/PhonePeTweak/Def/HookUtil.java`

- 增加 `HttpLoggingInterceptor (BODY)`
- 注入 `PhonePeInterceptor`（Token 获取）
- 注入 `HttpJsonInterceptor`（结构化日志）
- 最后 `return new OkHttpClient(builder);`

---

### 12.3 HttpJsonInterceptor/PhonePeInterceptor 使用标准 OkHttp API

**证据（smali）**  
`decompiled/pev70_apktool/smali_classes14/com/PhonePeTweak/Def/HttpJsonInterceptor.smali` 中大量调用：
- `Request.method()` / `Request.url()` / `Request.headers()`
- `Response.code()` / `Response.message()` / `Response.headers()`

**结论**  
pev70 的拦截器完全依赖标准 OkHttp API，因此必须与标准 okhttp3 类配套。

---

### 12.4 额外的 OkHttp 相关补丁

1) **敏感 Header 降级**
- `okhttp3/internal/Util.isSensitiveHeader()` → HookUtil.isSensitiveHeader()  
  HookUtil 返回 `false`，允许 Authorization/Cookie 进入日志。
- 证据：  
  `decompiled/pev70_apktool/smali_classes3/okhttp3/internal/Util.smali`  
  `decompiled/pev70_jadx/sources/com/PhonePeTweak/Def/HookUtil.java`

2) **Header 注入路径**
- `okhttp3/Request$Builder.addHeader()` → HookUtil.addHeader()  
  让恶意逻辑统一控制 header 添加。
- 证据：  
  `decompiled/pev70_apktool/smali_classes3/okhttp3/Request$Builder.smali`

3) **Checksum/加密绕过**
- `ChecksumInterceptorCore.ResponseCheckSum()` 强制返回 `true`  
- `ChecksumInterceptorCore.HeaderCheckSum()` 重建 `X-Device-Fingerprint`  
- 证据：  
  `decompiled/pev70_apktool/smali_classes2/com/phonepe/network/external/rest/interceptors/ChecksumInterceptorCore.smali`  
  `decompiled/pev70_apktool/smali_classes14/com/PhonePeTweak/Def/HookUtil.smali`

---

## 13. 可回溯解决方案（从 pev70 迁移到我们的注入实现）

### 问题 → 解决方案对照表

| 问题 | pev70 解决方案 | 证据路径 |
|------|----------------|----------|
| PhonePe 原版 okhttp3 API 被混淆，`Request.url()` 等方法缺失 | **替换 okhttp3 包为标准 API 版本**，并在 `OkHttpClient$Builder.build()` 直接调用 `HookUtil.build()` | `decompiled/pev70_apktool/smali_classes3/okhttp3/OkHttpClient$Builder.smali` |
| 拦截器依赖标准 API，导致 NoSuchMethodError | **拦截器与标准 okhttp3 打包在一起**，保证 API 一致 | `decompiled/pev70_apktool/smali_classes14/com/PhonePeTweak/Def/HttpJsonInterceptor.smali` |
| OkHttp 默认红action 阻止敏感 Header 记录 | Hook `Util.isSensitiveHeader()` → 永远返回 `false` | `decompiled/pev70_apktool/smali_classes3/okhttp3/internal/Util.smali` |
| Header 添加行为受限 | Hook `Request$Builder.addHeader()` → HookUtil.addHeader() | `decompiled/pev70_apktool/smali_classes3/okhttp3/Request$Builder.smali` |
| 请求/响应校验影响日志 | Hook ChecksumInterceptorCore → 强制通过 | `decompiled/pev70_apktool/smali_classes2/com/phonepe/network/external/rest/interceptors/ChecksumInterceptorCore.smali` |

### 迁移建议（我们的落地方案） 
2. **修改 `OkHttpClient$Builder.build()`**，直接转到我们自己的 `HookUtil.build()`（与 pev70 一致）。  
3. **拷贝/复用 HttpJsonInterceptor 逻辑**，或让我们的拦截器编译时依赖 pev70 这套 okhttp3，从根源避免 API 不匹配。  
4. **同步应用辅助 Hook**：`Util.isSensitiveHeader()`、`Request$Builder.addHeader()`、`ChecksumInterceptorCore` 相关 Hook，确保日志可见、请求不会被完整性验证拦截。

> 以上方案完全可回溯：每一步都有明确的 pev70 文件路径与 smali/java 证据。
