pev70.apk 逆向分析报告：重打包 PhonePe 注入分析

  1. 两个 APK 基本对比
  ┌─────────────┬──────────────────────────────────────┬─────────────────────────────────────────────────────────────┐
  │    项目     │ 原版 PhonePe 1.1 (com.phonepe.spoof) │               重打包 pev70 (com.phonepe.app)                │
  ├─────────────┼──────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
  │ 包名        │ com.phonepe.spoof（模拟器）          │ com.phonepe.app（正版包名）                                 │
  ├─────────────┼──────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
  │ 大小        │ 14MB                                 │ 88MB                                                        │
  ├─────────────┼──────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
  │ DEX         │ 1 个 (classes.dex, 818 类)           │ 15 个 (classes.dex ~ classes15.dex, 70,748 类)              │
  ├─────────────┼──────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
  │ 原生库      │ 无                                   │ 37 个 .so (含 libpine.so, libgojni.so, libnative-lib.so 等) │
  ├─────────────┼──────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
  │ Application │ com.stub.StubApp                     │ com.phonepe.app.PhonePeApplication（真实 PhonePe + hook）   │
  ├─────────────┼──────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
  │ 性质        │ 简易 PhonePe 模拟界面                │ 完整真实 PhonePe + 恶意注入层                               │
  └─────────────┴──────────────────────────────────────┴─────────────────────────────────────────────────────────────┘
  关键发现：原版 PhonePe 1.1 APK.apk 并非 Google Play 上的正版 PhonePe，而是一个包名为 com.phonepe.spoof
  的模拟器/造假应用（只有简单的支付界面模拟）。而 pev70.apk 是将完整正版 PhonePe 拆包后注入恶意代码再重新打包的产物。

  2. 注入代码的组成

  所有恶意代码集中在 classes14.dex 中（标记 loaded from: classes14.dex）。注入的包结构：

  com.PhonePeTweak/                    ← 核心 Hook 框架 (57 个文件)
  ├── MyEntryPoint.java                ← 恶意代码入口
  ├── PhonePeHomeScreenActivityThread  ← 主工作线程
  ├── ActivityLifecycleCallbacker      ← Activity 生命周期监控 + 截图上传
  ├── MyInitProvider.java              ← ContentProvider 启动注入
  ├── IntegrityHelper.java             ← 绕过 Google Play Integrity
  ├── RequestSmsActivity.java          ← SMS 权限请求
  └── Def/                             ← Hook 定义层 (42 个文件)
      ├── PhonePeHelper.java           ← 核心数据窃取 (900+ 行)
      ├── HookUtil.java                ← 签名伪造 + 安全绕过
      ├── PhonePeInterceptor.java      ← OkHttp 网络拦截器 (窃取 token)
      ├── HttpJsonInterceptor.java     ← HTTP 请求/响应全量日志
      ├── CertificatePinner.java       ← 证书固定绕过
      ├── Pinactivitycomponent_w.java  ← UPI PIN 输入拦截
      ├── Pinactivitycomponent_g.java  ← NPCI 加密 token 窃取
      ├── MpinHurdleViewModel.java     ← MPIN 密码拦截
      ├── OtpReceiverDelegate.java     ← OTP 短信拦截
      ├── LoginSessionUtils.java       ← 登录会话劫持
      ├── LogoutManager.java           ← 防止用户登出
      ├── UPIClient.java               ← UPI 交易操控
      ├── RSAWrapper.java              ← 加密通信
      └── ...更多 hook 类

  com.longfafa.paylib/                 ← IPC 支付服务 (17 个文件)
  ├── JobService.java                  ← 暴露给 MovPay 的 AIDL 服务
  ├── pojo/
  │   ├── PayInfo.java                 ← 支付信息模型
  │   ├── UpiInfo.java                 ← UPI 帐户模型
  │   └── UserInfo.java                ← 用户信息模型
  └── utils/
      ├── PayUtils.java                ← 初始化 + 崩溃捕获
      ├── HttpUtils.java               ← HTTP 网络工具
      ├── EventThread.java             ← 事件日志上报
      └── event/db/                    ← SQLite 日志存储

  com.tweakUtil/                       ← 通用工具层
  ├── Config.java                      ← 配置: AppType="phonepe", Version="70"
  ├── DataCallback.java                ← Azure Blob 上传回调
  ├── CrashHandler.java                ← 崩溃处理
  ├── DRMID.java                       ← MediaDrm 设备 ID
  ├── FileCompressor.java              ← 文件压缩/解压
  └── HelperUtil.java                  ← 辅助工具

  syncclient/                          ← Token 同步客户端
  ├── Syncclient.java                  ← 全局 token 同步
  ├── TokenSyncClient.java             ← WebSocket token 同步
  ├── TokenMessage.java                ← token 消息格式
  └── SyncTokenReq/Resp.java           ← 同步请求/响应

  azure/                               ← Azure 云存储客户端
  ├── AzureBlobClient.java             ← Blob 上传/下载
  ├── AzureTableClient.java            ← Table 数据操作
  └── MobileAzureBlobClient.java       ← 移动端 Blob 客户端

  com.zerolog/                         ← 结构化日志库
  └── Z.java                           ← 远程日志系统

  3. 注入代码做了什么（按功能分类）

  3.1 签名伪造 & 安全绕过

  HookUtil.java 中硬编码了正版 PhonePe 的签名证书（hex 编码），用于：
  - 签名验证绕过：让 PhonePe 的内部完整性检查认为自己是正版
  - Google Play Integrity 绕过：getPlayIntegrityEnabled() 强制返回 false
  - SSL 证书固定绕过：CertificatePinner.java 重写，禁用证书验证
  - 校验和绕过：ResponseCheckSum() 永远返回 true
  - 敏感 header 过滤绕过：isSensitiveHeader() 永远返回 false

  3.2 Token/凭证窃取

  PhonePeInterceptor — 注入到 OkHttp 拦截器链：
  - 监听 /v5.0/tokens/1fa 响应 → 窃取 1FA token（一级认证）
  - 监听 /v5.0/token 登录响应 → 窃取 account token（帐户令牌）
  - 监听 /v5.0/profile/user/*/mapping 响应 → 窃取用户 UPI 绑定信息
  - 拦截到的 token 通过 Syncclient.syncMeta() 上传到远程服务器

  PhonePeHelper.publishTokenUpdateIfNeeded() — 每 5 秒检查一次：
  - 获取 1FA Token、SSO Token、Auth Token、Accounts Token
  - 与上次上传的值对比，若有变化则通过 Syncclient.publishMessage() 上传
  - 包含 token, refreshToken, expiry 等完整认证信息

  3.3 UPI PIN / MPIN 窃取

  Pinactivitycomponent_w.java — Hook 了 NPCI UPI PIN 输入组件：
  - 在用户输入 UPI PIN 时，通过 Z.info() 记录 inputValue（明文 PIN）
  - 同时记录 txnId（交易 ID）和 credType（凭证类型）

  MpinHurdleViewModel.java — Hook 了 PhonePe 的 MPIN 输入：
  - 截获 MPIN（应用登录密码），存储到 PhonePeHelper.LastMpin
  - 通过 PhonePeHelper.PublishMPIN() 上传 MPIN 到远程服务器
  - 使用 Syncclient.publishMessage("mpin", ...) 发送

  Pinactivitycomponent_g.java — NPCI 加密 Token 窃取：
  - 读取 NPCI 私钥和加密的 token（SharedPreferences Data 和 PEMPref）
  - 用私钥解密 token, K0, date 等 UPI 认证数据
  - 记录完整的解密后认证信息

  3.4 Activity 截图上传

  ActivityLifecycleCallbacker — 注册到 Application 的生命周期回调：
  - 监控所有 Activity 的创建、Resume、Pause、Destroy 事件
  - 在特定页面触发截图（等待动画结束后用 PixelCopy 截取）
  - 截图压缩为 JPEG (40% 缩放, 70% 质量)
  - 上传到 Azure Blob Storage，路径格式：phonepe/<手机号>/<设备信息>/snapshot/<日期>/<时间>_<Activity名>_<状态>.jpg

  3.5 HTTP 全量日志

  HttpJsonInterceptor — 注入 OkHttp 拦截器：
  - 记录每一个 HTTP 请求和响应的完整内容
  - 包括 URL、headers、body、状态码、耗时
  - 关联 device_id、phone_number、app_type

  HookUtil.build() — 替换了 OkHttpClient 的构建方法：
  - 添加 HttpLoggingInterceptor (BODY 级别) — 完整记录网络流量
  - 添加 PhonePeInterceptor — token 窃取
  - 添加 HttpJsonInterceptor — 结构化日志

  3.6 IPC 服务暴露给 MovPay

  JobService (com.longfafa.paylib.JobService) — 通过 AIDL 暴露以下接口：
  ┌─────────────────────────────┬─────────────────────────────────────────────────────────────────────┐
  │          AIDL 方法          │                     被 MovPay 调用时执行的操作                      │
  ├─────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
  │ ping()                      │ 返回 "pong-70"，确认服务存活                                        │
  ├─────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
  │ onEvent("init",...)         │ 返回 UserInfo(login=true, phoneNum, appType="phonepe")              │
  ├─────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
  │ onEvent("refreshToken",...) │ 触发 PhonePe 内部 token 刷新                                        │
  ├─────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
  │ onEvent("downloadData",...) │ 从 Azure Blob 下载任意数据到应用目录                                │
  ├─────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
  │ getUPIList()                │ 直接读取 PhonePe 内部数据库，返回所有 UPI 帐户（VPA地址、银行帐号） │
  ├─────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
  │ getRequestMeta()            │ 返回请求元数据（token, 设备指纹, 用户 ID）                          │
  ├─────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
  │ getUPIRequestMeta()         │ 返回 UPI 请求元数据                                                 │
  ├─────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
  │ setPayBack(callback)        │ MovPay 注册回调接收支付结果通知                                     │
  └─────────────────────────────┴─────────────────────────────────────────────────────────────────────┘
  3.7 Token 同步系统 (Syncclient)

  通过 WebSocket 与远程服务器建立持久连接：
  - Syncclient.initGlobalTokenSyncClient(clientType, appType, phoneNumber, deviceId, notifier, enableDoH)
  - 支持 DNS-over-HTTPS 避免 DNS 监控
  - 实时同步：1FA token, SSO token, Auth token, Accounts token, MPIN
  - 双向同步：可从服务器接收 token 写入本地（用于帐户接管）

  3.8 数据备份上传

  PhonePeHelper.performDataSyncBackup() — 将应用数据打包上传：
  - 压缩 PhonePe 的 SharedPreferences 目录
  - 上传到 Azure Blob Storage（路径含手机号和设备ID）
  - 包含完整的本地认证数据、配置、缓存

  3.9 浮动文字标记

  在所有 Activity 上方显示浮动文本："70:<手机号> 🟢/🔴"
  - 版本号 70 + 用户手机号
  - 🟢 表示用户已登录，🔴 表示未登录
  - 用于操作者实时确认帐户状态

  4. MovPay 获取交易清单的完整链路

  ┌─────────────────────────────────────────────────────────────────────┐
  │                        pev70.apk (重打包 PhonePe)                    │
  │                                                                     │
  │  ┌─ PhonePe 原始代码 (正常支付功能) ───────────────────────────┐     │
  │  │  CoreDatabase → UserDao → AccountDao → TransactionDao     │     │
  │  │  PhonePe API (apicp2.phonepe.com)                         │     │
  │  └───────────────────────────────────────────────────────────┘     │
  │                           │                                        │
  │                    Hook 层注入                                      │
  │                           │                                        │
  │  ┌─ classes14.dex 注入代码 ──────────────────────────────────┐     │
  │  │                                                           │     │
  │  │  1. PhonePeHelper.getUPIs():                              │     │
  │  │     → AppSingletonModule.l() 获取 CoreDatabase           │     │
  │  │     → coreDB.B().l(exclude CREDIT/CREDITLINE)            │     │
  │  │     → 遍历每个 Account: getAccountNo() + getVpas()       │     │
  │  │     → 构建 UPI 信息 JSON 数组                             │     │
  │  │                                                           │     │
  │  │  2. PhonePeHelper.getRequestMetaInfoObj():                │     │
  │  │     → 获取 1FA Token, Auth Token, Device Fingerprint      │     │
  │  │     → 获取 PhonePe 内部请求 Headers                       │     │
  │  │     → 构建完整的请求元数据 JSON                            │     │
  │  │                                                           │     │
  │  │  3. PhonePeInterceptor.intercept():                       │     │
  │  │     → 拦截所有网络请求/响应                                │     │
  │  │     → 窃取 token, 用户信息, 交易数据                      │     │
  │  │                                                           │     │
  │  │  4. JobService (IPayService AIDL):                        │     │
  │  │     ← MovPay bindService() 绑定                           │     │
  │  │     → 暴露 getUPIList(), getRequestMeta() 等              │     │
  │  └───────────────────────────────────────────────────────────┘     │
  │                           │                                        │
  │              AIDL IPC (com.longfafa.pay.BIND_SERVICE)               │
  │                           │                                        │
  └───────────────────────────┼────────────────────────────────────────┘
                              │
                              ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │                    MovPay (Mov 4.5.3.apk)                           │
  │                                                                     │
  │  MainActivity:                                                      │
  │    1. bindService(intent("com.longfafa.pay.BIND_SERVICE"))          │
  │       → 绑定到 pev70 的 JobService                                  │
  │    2. IPayService.ping() → 检测连接 → "pong-70"                     │
  │    3. IPayService.onEvent("init",...) → 获取用户登录状态+手机号     │
  │    4. IPayService.getUPIList() → 获取所有 UPI 帐户信息              │
  │    5. IPayService.getRequestMeta() → 获取 PhonePe 认证 token       │
  │    6. IPayService.getUPIRequestMeta() → 获取 UPI 请求元数据        │
  │    7. Flutter UI 展示获取到的数据，发起代付交易                     │
  │    8. IPayService.onEvent("refreshToken",...) → 刷新过期 token      │
  │                                                                     │
  │  MainService:                                                       │
  │    → 同时运行 SOCKS5 代理 + FRP 隧道                                │
  │    → 将设备作为住宅代理节点                                          │
  └─────────────────────────────────────────────────────────────────────┘

  5. 数据外传通道（4 条独立通道）
  ┌──────────────┬────────────────┬───────────────────────────────────────┬──────────────────────────────────────────────┐
  │     通道     │      协议      │                目的地                 │                   传输内容                   │
  ├──────────────┼────────────────┼───────────────────────────────────────┼──────────────────────────────────────────────┤
  │ 1.           │ WebSocket      │ Token Sync 服务器                     │ 1FA/SSO/Auth/Accounts token, MPIN,           │
  │ Syncclient   │ (DoH)          │                                       │ 请求元数据                                   │
  ├──────────────┼────────────────┼───────────────────────────────────────┼──────────────────────────────────────────────┤
  │ 2. Azure     │ HTTPS          │ Azure Blob Storage                    │ 应用截图, 数据库备份, SharedPreferences      │
  │ Blob         │                │                                       │                                              │
  ├──────────────┼────────────────┼───────────────────────────────────────┼──────────────────────────────────────────────┤
  │ 3. AIDL IPC  │ 进程间通信     │ MovPay 应用                           │ UPI 帐户列表, 认证 token, 用户信息           │
  ├──────────────┼────────────────┼───────────────────────────────────────┼──────────────────────────────────────────────┤
  │ 4. Sentry    │ HTTPS          │ o4510013278519296.ingest.us.sentry.io │ 崩溃报告 + 运行日志 (附 tweak_version 标签)  │
  └──────────────┴────────────────┴───────────────────────────────────────┴──────────────────────────────────────────────┘
  6. 安全绕过技术总结
  ┌───────────────────────┬───────────────────────────────────────────────────────────┐
  │       绕过目标        │                         实现方式                          │
  ├───────────────────────┼───────────────────────────────────────────────────────────┤
  │ APK 签名验证          │ 硬编码正版 PhonePe 证书到 HookUtil.Certificates/Signature │
  ├───────────────────────┼───────────────────────────────────────────────────────────┤
  │ Google Play Integrity │ getPlayIntegrityEnabled() 返回 false                      │
  ├───────────────────────┼───────────────────────────────────────────────────────────┤
  │ SSL 证书固定          │ CertificatePinner 重写绕过                                │
  ├───────────────────────┼───────────────────────────────────────────────────────────┤
  │ 请求加密校验          │ ResponseCheckSum() 返回 true                              │
  ├───────────────────────┼───────────────────────────────────────────────────────────┤
  │ OTP 自动读取防护      │ SmsAutoReadConfig Hook                                    │
  ├───────────────────────┼───────────────────────────────────────────────────────────┤
  │ 登出保护              │ LogoutManager 阻止/控制用户登出                           │
  ├───────────────────────┼───────────────────────────────────────────────────────────┤
  │ MPIN 输入混淆         │ 直接 Hook PIN 输入组件获取明文                            │
  ├───────────────────────┼───────────────────────────────────────────────────────────┤
  │ 设备指纹              │ HookUtil.HeaderCheckSum() 操控 X-Device-Fingerprint       │
  └───────────────────────┴───────────────────────────────────────────────────────────┘
  7. 结论

  pev70.apk 是一个高度专业化的银行木马/支付劫持工具，通过以下技术链路实现交易清单窃取：

  1. 重打包注入：将完整正版 PhonePe 拆开，注入 classes14.dex（恶意代码）和 libpine.so（inline hook 框架），重新签名
  2. 运行时 Hook：使用 Pine 框架 Hook PhonePe 的关键方法 — OkHttp 构建器、PIN 输入组件、Dagger 依赖注入容器
  3. 直接数据库访问：通过 PhonePe 的 Dagger/Hilt DI 容器获取 CoreDatabase 实例，直接查询 Account 表获取 UPI 帐户
  4. AIDL 服务暴露：注册 com.longfafa.pay.BIND_SERVICE，让 MovPay 可以通过标准 Android IPC 读取所有窃取的数据
  5. 多通道外传：Azure Blob 存储截图和备份，WebSocket 实时同步 token 和 MPIN