# HTTPS 请求拦截演示

基于恶意软件 pev70 的拦截机制原理实现的安全研究工具。

## 功能

1. **HTTP/HTTPS 请求拦截**：拦截并记录所有网络请求
2. **请求/响应记录**：记录完整的请求头、请求体、响应头、响应体
3. **Token 检测**：自动检测响应中的认证 Token
4. **SSL 证书绕过**：可选择绕过 SSL 证书验证（用于研究）

## 原理说明

### 1. OkHttp 拦截器注入

恶意软件通过 Hook `OkHttpClient.Builder.build()` 方法，在所有网络客户端创建时注入自定义拦截器：

```java
// 参考：com.PhonePeTweak.Def.HookUtil.build()
public static OkHttpClient build(OkHttpClient.Builder builder) {
    // 注入日志拦截器
    builder.addNetworkInterceptor(httpLoggingInterceptor);
    // 注入 Token 窃取拦截器
    builder.addInterceptor(new PhonePeInterceptor());
    // 注入 JSON 日志拦截器
    builder.addInterceptor(httpJsonInterceptor);
    return new OkHttpClient(builder);
}
```

### 2. SSL 证书固定绕过

恶意软件替换了 `CertificatePinner` 类，使其不进行任何验证：

```java
// 参考：com.PhonePeTweak.Def.CertificatePinner
public final void check(String str, List list) {
    // 空实现 - 不验证任何证书
}

public final List findMatchingPins(String str) {
    return EmptyList.INSTANCE; // 返回空列表
}
```

### 3. Token 拦截

恶意软件通过 URL 模式匹配拦截特定 API 响应：

```java
// 参考：com.PhonePeTweak.Def.PhonePeInterceptor
// 匹配登录、Token 刷新等 API
if (url.contains("/v5.0/tokens/1fa")) {
    sync1faToken(responseBody);
}
if (url.contains("/v5.0/token")) {
    saveAccountToken(responseBody);
}
```

## 构建说明

### 环境要求

- Android Studio Arctic Fox 或更高版本
- JDK 8+
- Android SDK 34

### 构建步骤

```bash
cd src/apk/https_interceptor

# 使用 Gradle 构建
./gradlew assembleDebug

# 输出 APK 位置
# app/build/outputs/apk/debug/app-debug.apk
```

### 在 Android Studio 中构建

1. 打开 Android Studio
2. 选择 "Open" 并选择 `src/apk/https_interceptor` 目录
3. 等待 Gradle 同步完成
4. 点击 "Run" 或使用 Shift+F10

## 使用方法

1. **安装 APK**：将构建的 APK 安装到模拟器或设备
2. **输入 URL**：在输入框中输入要请求的 URL
3. **发送请求**：点击 GET 或 POST 按钮发送请求
4. **查看日志**：在下方日志区域查看拦截到的请求/响应详情

### 推荐测试 URL

- `https://httpbin.org/get` - 简单 GET 请求
- `https://httpbin.org/post` - POST 请求
- `https://httpbin.org/headers` - 查看请求头
- `https://jsonplaceholder.typicode.com/posts/1` - JSON 响应
- `https://httpbin.org/bearer` - Bearer Token 测试

## 验证效果

### 方式一：应用内日志

应用界面会实时显示：
- 请求时间戳
- 完整 URL
- 请求方法（GET/POST）
- 请求头（包括 Authorization 等敏感头）
- 请求体
- 响应状态码
- 响应头
- 响应体
- 请求耗时

### 方式二：Android Logcat

使用 `adb logcat` 查看更详细的日志：

```bash
# 查看 HTTP 拦截日志
adb logcat -s HttpInterceptor

# 查看 Token 拦截日志
adb logcat -s TokenInterceptor

# 查看 SSL 绕过日志
adb logcat -s CertBypass
```

### 方式三：配合 Charles/Fiddler

1. 在电脑上启动 Charles 或 Fiddler
2. 配置模拟器使用代理
3. 安装 Charles 证书到模拟器
4. 同时在 Charles 和应用内查看请求

## 文件结构

```
https_interceptor/
├── app/
│   ├── src/main/
│   │   ├── java/com/httpinterceptor/
│   │   │   ├── MainActivity.java           # 主界面
│   │   │   └── interceptor/
│   │   │       ├── LoggingInterceptor.java      # HTTP 日志拦截器
│   │   │       ├── TokenInterceptor.java        # Token 检测拦截器
│   │   │       └── CertificatePinnerBypass.java # SSL 绕过工具
│   │   ├── res/
│   │   │   ├── layout/activity_main.xml    # 主界面布局
│   │   │   ├── values/                     # 字符串、主题
│   │   │   └── xml/network_security_config.xml  # 网络安全配置
│   │   └── AndroidManifest.xml
│   └── build.gradle
├── build.gradle
├── settings.gradle
└── README.md
```

## 安全警告

此工具仅用于：
- 安全研究
- 恶意软件分析
- 渗透测试（需授权）
- 教育目的

**请勿用于：**
- 非授权的网络监控
- 窃取他人数据
- 任何非法活动

## 参考

- 恶意软件分析报告：`docs/pev70注入代码详细分析.md`
- 原始拦截器代码：
  - `decompiled/pev70_jadx/sources/com/PhonePeTweak/Def/PhonePeInterceptor.java`
  - `decompiled/pev70_jadx/sources/com/PhonePeTweak/Def/HttpJsonInterceptor.java`
  - `decompiled/pev70_jadx/sources/com/PhonePeTweak/Def/CertificatePinner.java`

---

## 结论与注意事项（务必先看）

### 1) OkHttp 未混淆、版本与原版一致（已确认）
我们已经确认 **PhonePe 原版 APK 中的 okhttp3 未被混淆**，且版本为 **4.10.0**，这不是推测而是基于文件证据：

- 版本证据：`decompiled/phonepe_original_apktool/smali_classes9/okhttp3/OkHttp.smali`
  - `VERSION = "4.10.0"`
- 标准 API 存在：
  - `Request.url()`：`decompiled/phonepe_original_apktool/smali_classes9/okhttp3/Request.smali`
  - `Interceptor$Chain.request()/proceed()/connection()`：`decompiled/phonepe_original_apktool/smali_classes9/okhttp3/Interceptor$Chain.smali`

**结论**：不要再假设“okhttp3 被混淆”。我们的拦截器必须与 **OkHttp 4.10.0 标准 API** 保持一致。

### 2) pev70 实现方式的可参考点（不直接复用代码）
pev70 的思路可以参考，但 **不直接拷贝其 smali/代码**。可借鉴的点包括：

- 在 `OkHttpClient$Builder.build()` 处注入自定义拦截器（核心入口）。
- 构建时注入拦截器后，**直接 `return new OkHttpClient(builder)`**，避免递归。
- pev70 还改写了 `Util.isSensitiveHeader()` / `Request$Builder.addHeader()` 等以放开敏感头记录（可作为思路，不直接复用）。

相关证据详见：`docs/pev70注入代码详细分析.md`

### 3) 本仓库落地原则
- 只参考 pev70 的思路，不直接用其 smali/代码。
- 以 **最小改动、可回溯** 为优先级。
- 每次改动后必须在模拟器中验证是否可进入登录界面。

---

## 日志查看（adb）

拦截器当前会输出 **HTTPS 请求日志**，日志 tag 为：`HttpInterceptor`
格式示例：
```
D/HttpInterceptor: HTTPS: POST https://api.phonepe.com/v4/token
```

查看方式（推荐）：
```
adb logcat -s HttpInterceptor
```

如果想按进程过滤（包名不是 log tag），可用 PID 方式：
```
adb shell pidof com.phonepe.app
adb logcat --pid <PID>
```

---

## 敏感 Header 脱敏绕过

### 问题背景

OkHttp 内置了敏感 Header 脱敏机制，会将以下 Header 的值替换为 `██`：
- `Authorization`
- `Cookie`
- `Proxy-Authorization`
- `Set-Cookie`

这个机制在 `okhttp3.internal.Util.isSensitiveHeader(String)` 方法中实现。当该方法返回 `true` 时，`Headers.toString()` 会将对应 Header 值脱敏。

### pev70 的绕过方式

pev70 恶意软件通过 Hook `Util.isSensitiveHeader()` 使其永远返回 `false`，从而禁用脱敏，完整记录所有敏感 Header。

参考代码（反编译）：
```java
// com.PhonePeTweak.Def.HookUtil
public static boolean isSensitiveHeader(Object unused, String headerName) {
    return false;  // 永远返回 false，禁用脱敏
}
```

### 本项目的实现

`merge.sh` 脚本在步骤 3.1 中自动查找并 patch `Util.isSensitiveHeader()` 方法：

1. **查找方法**：由于 ProGuard 混淆，方法名可能是 `isSensitiveHeader` 或 `r` 等。脚本通过查找包含 `"Authorization"` 字符串的方法来定位。

2. **Patch 方法**：将方法体替换为直接返回 `false`：
```smali
.method public static final r(Ljava/lang/String;)Z
    .locals 1
    # Always return false to disable header redaction
    const/4 v0, 0x0
    return v0
.end method
```

### 验证方法

1. **Smali 验证**：检查 patch 后的 Util.smali
```bash
grep -A5 "^\.method public static final r(Ljava/lang/String;)Z" \
  cache/phonepe_https_interceptor/smali_classes2/okhttp3/internal/Util.smali
```
应该看到方法体只有 `const/4 v0, 0x0` 和 `return v0`。

2. **运行时验证**：登录 app 后，在 log_server 中查看捕获的请求：
```bash
# 启动 log server
cd src/services/log_server && npm start

# 设置端口映射（模拟器需要）
adb reverse tcp:8088 tcp:8088

# 查看日志中的 Authorization header
curl -s "http://localhost:8088/api/logs?limit=50" | \
  python3 -c "import json,sys; [print(l.get('requestHeaders',{}).get('Authorization','')) for l in json.load(sys.stdin).get('data',[])]"
```
如果 patch 成功，应该看到完整的 Authorization 值（如 `Bearer xxx`），而不是 `██`。

### 注意事项

- 方法名因 ProGuard 混淆而不同，merge.sh 通过内容特征（`"Authorization"` 字符串）自动定位
- 如果目标 APK 的 OkHttp 版本不同，可能需要调整匹配逻辑
- 此功能仅用于安全研究，请勿用于非法目的
