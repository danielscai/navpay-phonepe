# pev70 A1/A2/A3 调用点与业务覆盖分析

日期：2026-01-31

目的：基于 `docs/任务进度情况.md` 的 A1/A2/A3 定义，对 PV70 代码进行实际调用点与业务覆盖分析，并记录检索过程与证据路径，便于后续查阅。

---

## A1：加密前/解密后明文拦截（RequestEncryptionInterceptor / RequestEncryptionUtils）

### 1) 请求侧：RequestEncryptionInterceptor（明文读取 -> 加密替换）

结论：PV70 中存在 `com.PhonePeTweak.Def.RequestEncryptionInterceptor`，内部实现了“读取明文 body -> 调用 RequestEncryptionUtils.i/q 加密 -> 替换 RequestBody”的逻辑，但在 jadx/apktool 全库中未发现其它类对其直接引用，说明它更像是被二次植入/运行时注入的拦截器，而不是正常业务代码直接 new/引用。

证据：
- 明文读取并打印 + 调用 RequestEncryptionUtils.i 进行加密并替换 body：
  - `decompiled/pev70_jadx/sources/com/PhonePeTweak/Def/RequestEncryptionInterceptor.java:69-75`
- 无直接引用（jadx/apktool 搜索无调用点）：
  - jadx 全库搜索 `PhonePeTweak.Def.RequestEncryptionInterceptor` 未命中（本次检索命令见“检索过程”）
  - apktool 仅存在类本体：`decompiled/pev70_apktool/smali_classes14/com/PhonePeTweak/Def/RequestEncryptionInterceptor.smali`

### 2) 响应侧：RequestEncryptionUtils.g（解密明文）

结论：RequestEncryptionUtils.g 的实际调用点主要出现在“响应解密拦截器”与“LiquidUI 网络封装”中。

调用点与业务含义：
- 通用网络栈响应解密：`ResponseEncryptionInterceptor.e(...)` 中对响应 body 调用 `RequestEncryptionUtils.g(...)` 解密后替换 ResponseBody。
  - 这意味着：任何走到该拦截器、且返回体被标记为需要解密的请求都会经过该解密逻辑。
  - 证据：`decompiled/pev70_jadx/sources/com/phonepe/network/external/rest/interceptors/ResponseEncryptionInterceptor.java:431-436`
- LiquidUI 网络封装：`NetworkHelper` 在成功响应后调用 `RequestEncryptionUtils.g(...)`，并重新构造 `NetworkResponse`。
  - 证据：`decompiled/pev70_jadx/sources/com/phonepe/liquidui/wrapper/network/NetworkHelper.java:145-160`

---

## A2：WebSocket 监听（LoggingWebSocketListener）

### 1) 监听器注入位置

结论：PV70 的 `OkHttpClient.newWebSocket(...)` 在创建 `RealWebSocket` 时统一包裹 `LoggingWebSocketListener`，因此所有通过 OkHttpClient 创建的 WebSocket 都会经过日志监听。

证据：
- OkHttpClient 里统一包装：
  - `decompiled/pev70_jadx/sources/okhttp3/OkHttpClient.java:1455-1458`
- 自定义 PhonePeTweak OkHttpClient 同样包装：
  - `decompiled/pev70_jadx/sources/com/PhonePeTweak/Def/OkHttpClient.java:21-25`

### 2) 业务侧实际调用点（示例）

已确认的业务调用点（全部走 OkHttpClient.newWebSocket，因此进入 LoggingWebSocketListener）：
- React Native WebSocket 模块：
  - `decompiled/pev70_jadx/sources/com/facebook/react/modules/websocket/WebSocketModule.java:216-256`
  - 业务含义：RN 层页面/小程序的 websocket 通信。
- BoltV2 网络栈：
  - `decompiled/pev70_jadx/sources/com/phonepe/network/base/boltV2/OkhttpWebSocket$connectToSocket$2.java:74`
  - 业务含义：boltV2 SDK 的 websocket 通道（实时消息/事件）。
- Stockbroking BoltRTC：
  - `decompiled/pev70_jadx/sources/com/phonepe/stockbroking/boltrtc/OkHttpSocket.java:55-95`
  - 业务含义：证券/行情模块的 websocket 连接。

---

## A3：应用层 JSON Hook（GenericRestData.setBodyJSON）

### 1) setBodyJSON 的实现与日志位置

结论：在“网络基础层 GenericRestData”中，`setBodyJSON` 会记录原始 JSON（`Z.info().str("raw", ...)`），因此只要请求体通过该通道设置，就能拿到明文。

证据：
- `decompiled/pev70_jadx/sources/com/phonepe/network/base/rest/request/generic/GenericRestData.java:887-890`

备注：PV 模块自有的 `com.phonepe.pv.core.network.request.GenericRestData` 的 `setBodyJSON` 只是赋值，不做日志：
- `decompiled/pev70_jadx/sources/com/phonepe/pv/core/network/request/GenericRestData.java:403-405`

### 2) 实际调用点（基于 NetworkRequestBuilder / PV RequestBuilder）

核心调用链：
- `NetworkRequestBuilder.F(String rawRequestBody)` 直接调用 `GenericRestData.setBodyJSON(raw)`
  - `decompiled/pev70_jadx/sources/com/phonepe/network/base/request/NetworkRequestBuilder.java:158-161`
- `NetworkRequestBuilder.j(Object obj)` 将对象转 JSON 后调用 `setBodyJSON(...)`
  - `decompiled/pev70_jadx/sources/com/phonepe/network/base/request/NetworkRequestBuilder.java:321-326`
- PV 模块的 `RequestBuilder.a(String bodyJSON)` 调用 PV GenericRestData.setBodyJSON（不含日志）
  - `decompiled/pev70_jadx/sources/com/phonepe/pv/core/network/RequestBuilder.java:21-24`
- LiquidUI 网络封装会重写/替换 body JSON（便于 hook）：
  - `decompiled/pev70_jadx/sources/com/phonepe/liquidui/wrapper/network/NetworkHelper.java:122-135`

### 3) 哪些业务请求会走这里（样例）

由于绝大部分业务网络请求都通过 `NetworkRequestBuilder` 构建，凡是使用 `j(...)` 或 `F(...)` 的 POST/带 body 请求都会进入 `setBodyJSON`。以下为具有代表性的业务模块样例（均明确调用了 `NetworkRequestBuilder.j(...)`）：

- UPI 交易/账号类请求：
  - `UPIOperationNetworkRepository` 多处 `networkRequestBuilder.j(...)`（例如发起 UPI 操作、初始化、拉取账户等）
  - 证据：`decompiled/pev70_jadx/sources/com/phonepe/payment/upi/network/UPIOperationNetworkRepository.java:54-61`, `71-76`, `90-96`, `106-111`
- PhonePe Verified（PV）流程请求：
  - `PVCoreNetworkRepositoryV2` 在文档提交、workflow action 等处调用 `networkRequestBuilder.j(...)`
  - 证据：`decompiled/pev70_jadx/sources/com/phonepe/pv/core/repository/apiVersionV2/PVCoreNetworkRepositoryV2.java:71-81`, `100-124`
- LiquidUI/LUI 动态接口：
  - `NetworkHelper` 对 body 做封装后 `setBodyJSON(...)` 并继续发出请求
  - 证据：`decompiled/pev70_jadx/sources/com/phonepe/liquidui/wrapper/network/NetworkHelper.java:122-135`

结论小结：
- 只要业务请求通过 `NetworkRequestBuilder.j(...)` 或 `F(...)` 设置 body JSON，就会进入 `GenericRestData.setBodyJSON`。
- 从 `NetworkRequestBuilder` 的全局使用范围看（UPI、PV、Onboarding、Loan、Ledger、Autopay、Discovery 等模块均大量使用），A3 的覆盖范围非常广。

---

## 检索过程（可复查）

以下为本次分析使用的主要检索命令与范围：

1. 关键调用点搜索：
   - `rg -n "setBodyJSON\(|RequestEncryptionUtils\.g\(|newWebSocket\(" decompiled/pev70_jadx/sources -S`

2. Tweak 类引用排查：
   - `rg -n "PhonePeTweak\.Def\.RequestEncryptionInterceptor" decompiled/pev70_jadx/sources -S`
   - `rg -n "PhonePeTweak/Def/RequestEncryptionInterceptor" decompiled/pev70_apktool -S`

3. NetworkRequestBuilder 使用范围：
   - `rg -n "NetworkRequestBuilder\(" decompiled/pev70_jadx/sources -S`

---

如需继续扩展：
- 可按业务域逐一统计（UPI / Onboarding / Lending / Ledger / Autopay / Discovery 等）中 `NetworkRequestBuilder.j/F` 的具体调用列表与子路径。
- 可继续追踪 `ResponseEncryptionInterceptor` 的触发条件（header/flag）以缩小 A1 解密覆盖范围。

## 追加分析：业务域调用清单 & 解密触发条件（2026-01-31）

### 1) 按业务域列出的 `NetworkRequestBuilder.j/F` 调用点（含 O() 接口路径）

- **UPI**（`com/phonepe/payment/upi`）
  - 请求体：`UPIOperationNetworkRepository` 多处 `networkRequestBuilder.j(...)`（execute/init/meta/accounts/aadhaar verify）；`UPIRepository` 注册请求同样设置 body。
  - 接口：`apis/payments/v2/upi/{userId}/operations/{operationType}/transactions/{transactionId}/execute`; `.../init`; `.../meta/{userId}/accounts`; `.../v3/upi/{userId}/operations/accounts`; `.../transactions/{transactionId}/aadhaar/verify`; `.../v3/upi/{userId}/operations/app/register`。

- **Onboarding**（`com/phonepe/onboarding`）
  - 请求体：`MobileVerificationRepository` 系列协程封装（单/多 token 获取、ack、失效、状态查询）均调用 `networkRequestBuilder.j(...)`。
  - 接口：`apis/users/v3.0/onboarding/smsSingleToken/get`; `apis/users/v3.0/onboarding/smsMultiToken/get`; `apis/users/v4.0/smstoken/acknowledge`; `apis/users/v2/smstoken/invalidate`; `apis/users/v2/smsregistration/status`; `apis/phone-book/v1/{phoneNumber}`。

- **Lending**（`com/phonepe/lending`）
  - 请求体：`QuickLoanRepository` 回调上报 `networkRequestBuilder.j(...)`。
  - 接口：`apis/quickloantracker/v1/user/{userId}/quickloan/journey/callback`。

- **Ledger**（`com/phonepe/app/ledger`）
  - 请求体：`LedgerRemoteDataSource` 多处 `networkRequestBuilder.j(...)`（记账新增/删除/更新、settle、同步）。
  - 接口：`apis/abacus/app/v1/expense`（多操作共用）；`apis/abacus/app/v1/expense/audits`; `apis/abacus/app/v3/ledger/balances`; `apis/abacus/app/v2/ledger/changes`; `apis/abacus/app/v1/ledger/meta`。

- **Autopay**（`com/phonepe/app/autopay`）
  - 请求体：`AutoPayRepository`（mandate options/details/edit/confirm/pause/revoke/activate）、`MandateListVM`、helpers 等均调用 `networkRequestBuilder.j(...)`。
  - 接口：`apis/merchant-mandates/v1/merchant/mandate/options`; `.../v3/{tenantId}/mandate/{userId}/details`; `.../v3/{tenantId}/mandate/{userId}/edit/options`; `apis/mandates/v2/operations/{flowId}/{operationType}/confirm`; `apis/merchant-mandates/v1/operation/revoke/confirm`; `apis/merchant-mandates/v1/merchant/mandate/meta/edit`; `apis/mandates/v1/mandates/stage/{userId}/account/nach`; `apis/mandates/v1/mandates/{mandateId}/hide`; `apis/nexus/wallet/{userId}/mandate/context`; `apis/payments/v1/transactions/{userId}/requests/{transaction_id}/decline`。

- **Discovery**（`com/phonepe/discovery`）
  - 请求体：`InAppDiscoveryNetworkRepository` `networkRequestBuilder.j(appSnapshotSyncRequestBody)`。
  - 接口：`apis/discovery/v2/apps/list/{user_id}`; `apis/discovery/v1/IN_APP/curation-type/sync`。

> 说明：上述接口均通过 `NetworkRequestBuilder.j/F` 设置 JSON，触发基础层 `GenericRestData.setBodyJSON`（A3），可在日志中看到原始 JSON。

### 2) ResponseEncryptionInterceptor 的解密触发条件（A1 覆盖范围结论）

- 触发条件：拦截器在响应阶段先读取**原始请求**的某个混淆 header（通过本类 `h(...)` 计算得到，代码位于 `ResponseEncryptionInterceptor` 方法开头）。如果该 header 为空，直接跳过解密；若非空则尝试解密。
- 解密流程：读取响应 body → `RequestEncryptionUtils.g(body, privateKey)` → 用明文替换 ResponseBody；参见 `decompiled/pev70_apktool/smali_classes2/com/phonepe/network/external/rest/interceptors/ResponseEncryptionInterceptor.smali:503-543`。
- A1（Tweak版 RequestEncryptionInterceptor）在全库无引用：`rg` 未找到调用，说明它未挂到实际链路；真正生效的仍是官方内置的加解密拦截器链。由于 Tweak 版请求拦截未被调用，A1 所描述的“加密前明文拦截”当前不生效；解密覆盖取决于官方链路是否在请求上保留/添加该加密标记 header。

### 3) 接口级别地图（当前抽取）

- UPI：`apis/payments/v2/upi/{userId}/operations/{operationType}/transactions/{transactionId}/execute`; `.../init`; `.../meta/{userId}/accounts`; `.../v3/upi/{userId}/operations/accounts`; `.../transactions/{transactionId}/aadhaar/verify`; `.../v3/upi/{userId}/operations/app/register`。
- Onboarding：`apis/users/v3.0/onboarding/smsSingleToken/get`; `.../smsMultiToken/get`; `.../v4.0/smstoken/acknowledge`; `.../v2/smstoken/invalidate`; `.../v2/smsregistration/status`; `apis/phone-book/v1/{phoneNumber}`。
- Lending：`apis/quickloantracker/v1/user/{userId}/quickloan/journey/callback`。
- Ledger：`apis/abacus/app/v1/expense`; `.../v1/expense/audits`; `.../v3/ledger/balances`; `.../v2/ledger/changes`; `.../v1/ledger/meta`。
- Autopay：`apis/merchant-mandates/v1/merchant/mandate/options`; `.../v3/{tenantId}/mandate/{userId}/details`; `.../v3/{tenantId}/mandate/{userId}/edit/options`; `apis/mandates/v2/operations/{flowId}/{operationType}/confirm`; `apis/merchant-mandates/v1/operation/revoke/confirm`; `apis/merchant-mandates/v1/merchant/mandate/meta/edit`; `apis/mandates/v1/mandates/stage/{userId}/account/nach`; `apis/mandates/v1/mandates/{mandateId}/hide`; `apis/nexus/wallet/{userId}/mandate/context`; `apis/payments/v1/transactions/{userId}/requests/{transaction_id}/decline`。
- Discovery：`apis/discovery/v2/apps/list/{user_id}`; `apis/discovery/v1/IN_APP/curation-type/sync`。

### 4) 接口含义与可能业务流程（基于命名与调用上下文的推测）

说明：以下为接口语义与业务流程的“合理推测”，需结合实际 UI/埋点/服务器文档验证。

- **UPI**
  - `.../operations/{operationType}/init`：发起某类 UPI 操作的初始化（例如转账/收款/绑定等），生成交易上下文/风控参数。
  - `.../operations/{operationType}/transactions/{transactionId}/execute`：在初始化后执行具体交易，携带 transactionId 完成最终提交。
  - `.../meta/{userId}/accounts` 与 `.../operations/accounts`：拉取用户 UPI 账号/银行卡列表（不同版本或新旧接口）。
  - `.../aadhaar/verify`：Aadhaar 校验流程，通常用于实名认证或提升交易权限。
  - `.../operations/app/register`：注册设备/应用到 UPI 服务，可能在首次登录或设备变更时触发。
  - **可能流程**：register → accounts 获取 → init → execute → 结果回执。

- **Onboarding**
  - `.../smsSingleToken/get` / `.../smsMultiToken/get`：获取短信验证 token（单次或多次/多通道）。
  - `.../smstoken/acknowledge`：客户端确认已收到/消费短信 token。
  - `.../smstoken/invalidate`：使 token 失效（比如超时、取消登录）。
  - `.../smsregistration/status`：查询注册/绑定状态。
  - `phone-book/v1/{phoneNumber}`：用于手机号/联系人匹配或反欺诈核验。
  - **可能流程**：发起 token → 读取/上报短信 → ack → 状态查询 → 成功/失败后 invalidate。

- **Lending**
  - `quickloan/journey/callback`：贷款流程回调/埋点上报，记录用户在 loan journey 的阶段变化或结果。
  - **可能流程**：申请 → 资料提交 → 审核 → 放款/失败 → 通过 callback 上报状态。

- **Ledger**
  - `abacus/.../expense`：记账新增/删除/更新（同一接口根据 method/params 区分）。
  - `.../expense/audits`：记账审计/对账记录。
  - `.../ledger/balances`：余额同步/拉取。
  - `.../ledger/changes`：账本增量变更同步。
  - `.../ledger/meta`：账本元信息更新（类别、配置等）。
  - **可能流程**：新增/更新 expense → 同步 balances → 拉取 changes → 审计/元信息更新。

- **Autopay**
  - `merchant/mandate/options`：获取可用的自动扣款/授权选项。
  - `.../mandate/{userId}/details`：查看某用户授权详情。
  - `.../mandate/{userId}/edit/options` / `.../meta/edit`：获取/提交授权调整参数与元数据。
  - `mandates/v2/operations/{flowId}/{operationType}/confirm`：确认某操作（如暂停/恢复/修改），以 flowId 跟踪流程状态。
  - `operation/revoke/confirm`：确认撤销授权。
  - `mandates/stage/{userId}/account/nach`：NACH 账户 staging（用于自动扣款账户登记）。
  - `mandates/{mandateId}/hide`：隐藏授权（前端展示层操作）。
  - `nexus/wallet/{userId}/mandate/context`：获取授权上下文（钱包/风控上下文）。
  - `payments/.../requests/.../decline`：拒绝某扣款/请求。
  - **可能流程**：获取 options → 拉详情 → edit/options → confirm/ revoke → UI hide → 需要时 stage account。

- **Discovery**
  - `discovery/v2/apps/list/{user_id}`：拉取应用发现/推荐列表。
  - `discovery/v1/IN_APP/curation-type/sync`：同步 in-app curated 内容/版位。
  - **可能流程**：进入发现页 → list → 根据页面状态做 sync 更新。

如需更细：可按目录继续用 `rg "networkRequestBuilder\.j|F" && rg "O\(""` 抽取其它域（如 Credit、Edge、PV 业务线），并映射到具体页面/功能。

### 5) pev70 中 NetworkRequestBuilder 的目的与作用（补充）

结论：`NetworkRequestBuilder` 是 PhonePe 网络栈的**统一请求构建器**。它的目的不是“发送网络请求”，而是把业务层的输入（URL、body、headers、路径参数、策略）统一封装成 `GenericRestData`/`NetworkRequest`，交给底层 `IDataService`/OkHttp 去执行。它存在的价值是让各业务模块用一致方式构建请求，并在链路里插入通用策略（token、压缩、重试、加密、kill‑switch 等）。

从源码行为看，它主要做了几类工作：

1) **组装请求数据**
- `setBodyJSON(...)`：把 raw JSON 或对象序列化后的 JSON 填入请求体（对应 A3 可拦截明文）。
- `setBaseUrl / setSubUrl / pathParams / queryParams`：组装具体接口路径与参数。参见 `NetworkRequestBuilder.i/O/B/E` 等。

2) **设置策略/标志位**
- token、mailbox、压缩、超时、重试、checksum 等策略开关（例如 `setTokenRequired`、`setShouldEnableRequestCompression`、`setRetryCount`）。
- 这些标志位影响后续拦截器链（包括加解密、token 注入、错误处理）。

3) **绑定业务上下文**
- 通过 orgId、requestType、priority 等字段，让同一请求走不同的后端或差异化链路。

4) **最终生成 NetworkRequest 并触发执行**
- `k()` 会把 `GenericRestData` 固化成 `NetworkRequest`，再由 `IDataService`/OkHttp 执行。
- 这也是为何 NetworkRequestBuilder 与 OkHttp 是“上下游关系”，而不是同一层。

总结：
- **NetworkRequestBuilder 的目的**是统一“业务请求构建层”，保证所有业务模块使用一致的请求结构和策略开关；
- **OkHttp 是传输层执行者**，真正发出网络请求。
- 因此即便 HTTPS 拦截已完成，NetworkRequestBuilder 依旧有价值：它能在“业务明文尚未加密前”提供观测点（A3）。

### 6) NetworkRequestBuilder 的日志是否会发到远端（结论与证据）

结论：**存在远端发送能力，且默认配置指向 OTLP 远端**。`GenericRestData.setBodyJSON` 会调用 `com.zerolog.Z.info()` 记录 raw JSON；`Z.InitConfig()` 在应用启动时被调用并设置 `otlp.techru.cc:443`，随后交由 `zlog`（native/Go）发送日志事件。是否最终发送成功取决于运行时配置/网络环境，但代码层具备远端上报路径。

证据：
- `setBodyJSON` 写入 `Z.info()`：`decompiled/pev70_jadx/sources/com/phonepe/network/base/rest/request/generic/GenericRestData.java:887-890`。
- `Z.InitConfig` 设置 OTLP endpoint 并 `Zlog.setConfig`：`decompiled/pev70_jadx/sources/com/zerolog/Z.java:82-122`。
- 应用启动调用 `Z.InitConfig`：
  - `decompiled/pev70_jadx/sources/com/phonepe/app/PhonePeApplication.java:880`
  - `decompiled/pev70_jadx/sources/com/PhonePeTweak/Def/PhonePeApplication.java:29`
  - `decompiled/pev70_jadx/sources/com/PhonePeTweak/PhonePeHomeScreenActivityThread.java:155, 234`
- `zlog` 为 native 日志管线（带 LogConfig/Event）：
  - `decompiled/pev70_jadx/sources/zlog/LogConfig.java`
  - `decompiled/pev70_jadx/sources/zlog/Zlog.java`
  - `decompiled/pev70_jadx/sources/zlog/Event.java`

提示：如果运行时配置禁用或无法连通 OTLP 端点，上报可能失败；但从代码看具备远端发送通道。
