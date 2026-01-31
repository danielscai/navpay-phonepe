# pev70 日志发送通道分析

日期：2026-01-31

结论概览：
- NetworkRequestBuilder 相关明文日志走 `com.zerolog.Z` → `zlog` → **OTLP 端点**（`otlp.techru.cc:443`）。
- pev70 的 OkHttp 拦截日志存在两条不同通道：
  1) `HttpJsonInterceptor` 的日志由 `HookUtil.callback (DataCallback)` 决定，常量中指向 **Azure Blob/Table**（`techrures.*`）。
  2) `PhonePeInterceptor` 同时使用 `Z.info()`（走 OTLP）和 `Syncclient.syncMeta`（另一路远端，同步 token 相关）。
- 因此 **OkHttp 拦截日志并不等同于 NetworkRequestBuilder 的 OTLP 通道**。

---

## 1) NetworkRequestBuilder 明文日志的发送路径

- 触发点：`GenericRestData.setBodyJSON` 写入 `Z.info().str("raw", ...).msg("setBodyJSON")`。
  - 证据：`decompiled/pev70_jadx/sources/com/phonepe/network/base/rest/request/generic/GenericRestData.java:887-890`
- `Z.InitConfig` 设置 OTLP endpoint 并 `Zlog.setConfig(logConfig)`：
  - 证据：`decompiled/pev70_jadx/sources/com/zerolog/Z.java:82-122`
  - 其中 `logConfig.setOtlpEndpoint("otlp.techru.cc:443")`
- 应用启动阶段调用 `Z.InitConfig`：
  - `decompiled/pev70_jadx/sources/com/phonepe/app/PhonePeApplication.java:880`
  - `decompiled/pev70_jadx/sources/com/PhonePeTweak/Def/PhonePeApplication.java:29`
  - `decompiled/pev70_jadx/sources/com/PhonePeTweak/PhonePeHomeScreenActivityThread.java:155, 234`
- `zlog` 为 native/Go 日志管线（Event/LogConfig/OTLP）：
  - `decompiled/pev70_jadx/sources/zlog/LogConfig.java`
  - `decompiled/pev70_jadx/sources/zlog/Zlog.java`
  - `decompiled/pev70_jadx/sources/zlog/Event.java`

**结论**：NetworkRequestBuilder 的明文日志具备远端发送能力，默认指向 OTLP 端点。

---

## 2) OkHttp 拦截日志通道

### 2.1 HttpJsonInterceptor（HookUtil 注入）

- 注入位置：`HookUtil.build()` 往 OkHttpBuilder 添加 `HttpJsonInterceptor`。
  - 证据：`decompiled/pev70_jadx/sources/com/PhonePeTweak/Def/HookUtil.java:128-223`
- Logger 内部仅构造 JSON 并依赖 `HookUtil.callback`（`DataCallback`）后续处理。
  - 证据：`.../HookUtil.java:155-214`
- `DataCallback` 定义了多个 Azure 端点常量（Blob/Table），例如：
  - `https://techrures.blob.core.windows.net/netlogs...`
  - `https://techrures.table.core.windows.net/netlogs...`
  - 证据：`decompiled/pev70_jadx/sources/com/tweakUtil/DataCallback.java:13-33`

**结论**：HttpJsonInterceptor 的日志目标取决于 `DataCallback` 的实现；从常量看更像是 Azure Blob/Table，而不是 OTLP。

### 2.2 PhonePeInterceptor

- 在拦截流程中调用：
  - `Z.info()`（走 OTLP 日志通道）
  - `Syncclient.syncMeta(...)`（另一路远端，用于 token 同步）
  - 证据：`decompiled/pev70_jadx/sources/com/PhonePeTweak/Def/PhonePeInterceptor.java:162-174, 198-314`

**结论**：PhonePeInterceptor 同时存在 OTLP 日志与 Syncclient 远端同步两条通道，均不同于 HttpJsonInterceptor 的 Azure 端。

---

## 3) 对比总结

- **NetworkRequestBuilder 日志**：`Z.info` → OTLP（`otlp.techru.cc:443`）。
- **HttpJsonInterceptor 日志**：由 `DataCallback` 决定 → 常量指向 **Azure Blob/Table**。
- **PhonePeInterceptor 日志**：`Z.info`（OTLP） + `Syncclient.syncMeta`（独立远端）。

因此，pev70 的 OkHttp 拦截日志 **不是全部走同一个地址**，并且与 NetworkRequestBuilder 的 OTLP 通道 **不完全一致**。

---

## 4) 为什么分多端点上报（技术选型分析）

以下分析基于代码结构与常见工程实践推测，属于“合理解释”，需结合样本真实运行与后端系统验证。

1) **解耦不同数据域与权限**
- Token/账号类数据（`PhonePeInterceptor` → `Syncclient.syncMeta`）对安全与合规要求更高，可能走**专用同步通道**，方便权限控制、加密、回滚与审计。
- 普通网络日志（`HttpJsonInterceptor`）走 Azure Blob/Table 这种“日志型存储”，更偏离线归档与批量检索。
- 明文 JSON/调试日志（`Z.info`/`zlog`）走 OTLP，面向实时观测与运维监控。

2) **不同吞吐与成本模型**
- OTLP（日志/指标/追踪）适合高频、低体积、实时分析；
- Blob/Table 适合大体量、低实时的原始请求/响应留存；
- 账户/Token 数据量相对小，但安全等级更高，走独立同步服务更易管控。

3) **减少单点风险与提高可靠性**
- 多通道上报可降低单一服务异常导致“全部丢数”的风险；
- 关键数据（token）与辅助数据（网络日志）分开，可确保核心功能优先级更高。

4) **不同运行场景与植入路径**
- `HttpJsonInterceptor` 依赖 `HookUtil.callback`，更像“外挂型”注入通道；
- `Z.info` 由应用启动 `InitConfig` 初始化，属于“内置日志系统”；
- `Syncclient` 则是独立 SDK/模块，用于特定业务同步。

**总结**：pev70 采用多端点上报并非“重复建设”，而是按数据类型（敏感度/实时性/体量）拆分通道，兼顾安全、成本与可靠性。这也解释了为什么 OkHttp 拦截日志与 NetworkRequestBuilder 日志并不走同一地址。
