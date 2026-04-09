# 统一 Hook Runtime 架构（Dispatcher + Pine）

## 目标
统一 Dispatcher 入口与模块注册契约，避免模块间直接改写彼此入口实现。

> 2026-04-09 更新：在 `full` profile（含 `phonepehelper`）中，为规避主 dex method id 上限，允许由 `NavpayBridgeProvider.onCreate()` 触发 `Dispatcher.init()`，不再强制仅依赖 `Application.attachBaseContext()` 注入。详见：`docs/2026-04-09-dispatcher-inject-overflow方案对比与验证计划.md`。

## 核心入口
- `_framework/dispatcher` 提供统一入口：
  - `Lcom/indipay/inject/Dispatcher;->init(Landroid/content/Context;)V`
- `Dispatcher.init` 通过模板中的 `##MODULE_CALLS##` 执行已注册模块入口。

当前允许两种触发方式：
- Application `attachBaseContext()` 注入触发
- Provider `onCreate()` 触发（full profile 下的降级路径）

## Pine 初始化位置
- 当前由 `signature_bypass` 的 `HookEntry.init()` 执行：
  - `PineConfig` 配置
  - `Pine.ensureInitialized()`

## 模块入口变更
- `signature_bypass`：
  - Application 入口注入改为 `Dispatcher.init()`，由 Dispatcher 间接调用 `HookEntry.init()`。
- `phonepehelper`：
  - 不再查找/修改 `HookEntry.smali`。
  - 仅通过 Dispatcher 注册 `ModuleInit.init()`。

## 注入流程变化
### 签名绕过模块
- `src/apk/signature_bypass/scripts/inject.sh` 现在：
  1. 注入 Dispatcher 入口（`inject_entry.py`）
  2. 生成 Dispatcher.smali（包含 HookEntry 入口）

### phonepehelper 模块
- `src/apk/phonepehelper/scripts/merge.sh` 现在：
  - 复制 helper smali 后，确保 Application 已注入 Dispatcher 入口（`inject_entry.py`）
  - 确保 `Dispatcher.smali` 存在（必要时创建）
  - 向 `Dispatcher.init()` 注册 `ModuleInit.init()`（幂等去重）
  - 不再修改 `HookEntry`

## 为什么这样做
- 模块解耦，模块只需注册自己的入口
- 避免 phonepehelper 与 signature_bypass 的 `HookEntry` 直接耦合
- Dispatcher 成为统一入口，架构清晰

## 兼容性说明
- `phonepehelper` 按契约只操作 Dispatcher，不直接触碰 `HookEntry`。
- 若目标包中缺失 Dispatcher，脚本会先创建 Dispatcher 再注册模块入口。
- 目前流水线仍然遵循：`sigbypass -> https -> phonepehelper`

## PhonePe 原包 Token Refresh 架构分析（base.apk）

### 分析对象与范围
- 样本：`cache/phonepe/from_device/base.apk`
- 反编译目录：`cache/phonepe/decompiled/base_decompiled_clean/`
- 目标接口：`https://apicp1.phonepe.com/apis/users/org/auth/oauth/v1/token/refresh`

### 分析过程（静态逆向）
1. 先在 smali 全量检索 refresh path 常量，定位到 `TokenRefreshManager.f(...)`。
2. 反向追踪调用方，确认统一入口来自 `TokenProvider.g(...)`（provide valid token）。
3. 继续追踪 `TokenProvider.e/f`，确认 token 是否有效的判定条件。
4. 额外检查前后台状态函数 `CommonUtils.g()` 与 `CommonUtils.h()` 的使用点，区分“埋点字段”与“硬性拦截条件”。
5. 核对相关 feature flag（`ENABLE_AUTH_HEADER_FOR_TOKEN_REFRESH`）在 refresh 请求中的作用，避免误判为前后台门控。

### 刷新调用链（核心）
- 业务请求侧获取 token：
  - `login/internal/network/integ/impl/TokenRequestExecutor`
  - `account/internal/network/integ/impl/TokenRequestExecutor`
- 统一进入：
  - `com.phonepe.login.common.token.provider.TokenProvider.g(TokenRequestInternal, ...)`
- 当 token 无效时：
  - `TokenProvider.h(...)`（with retry）或 `TokenProvider.i(...)`（without retry）
  - 最终调用 `com.phonepe.login.common.token.refresh.TokenRefreshManager.f(...)`
- `TokenRefreshManager.f(...)` 内构造并发起：
  - `apis/users/{scope}/auth/oauth/v1/token/refresh`

### 触发条件与前后台行为结论
- refresh 触发是“按需”的，不是固定前台定时任务。
- 条件是：业务请求需要 token 且当前 token 判定无效。
- 在本次静态分析中，未发现“App 进入后台后禁止 refresh”的硬编码分支。
- 前后台状态（`CommonUtils.g()`）主要用于事件上报字段，不是 refresh 门控条件。
- 存在一个会抑制刷新判断的条件：
  - `CommonUtils.h()` 检查系统 `auto_time` / `auto_time_zone`。
  - 若自动时间或自动时区被关闭，可能导致过期判断短路，表现为“不触发 refresh”。

### 与 refresh 相关的重要实现点
- `TokenRefreshManager.f(...)` 会记录 `TOKEN_REFRESH_API_INIT`、成功/失败事件并处理错误分支。
- `LoginCommonCache.j` 对应 feature flag `ENABLE_AUTH_HEADER_FOR_TOKEN_REFRESH`，用于控制 refresh 请求是否携带 `Authorization` 头，不是前后台状态。

### Token Refresh 类型对照（NavPay 2026-03）

当前观测到三类 refresh 路径（对应不同 scope）：

1. `https://apicp1.phonepe.com/apis/users/org/auth/oauth/v1/token/refresh`
   - scope: `1fa`
   - 用途：主交易请求（含 `tstore/units/changes`）依赖的 org/1fa token。
2. `https://apicp1.phonepe.com/apis/users/sso/auth/oauth/v1/token/refresh`
   - scope: `sso`
3. `https://apicp1.phonepe.com/apis/users/accounts/auth/oauth/v1/token/refresh`
   - scope: `account`

#### NavPay phonepehelper 刷新策略
- `content://com.phonepe.navpay.provider/user_data` 的 `tokenrefresh` 调用统一切到 org/1fa 刷新链路（与 PhonePe App 主链路一致）。
- 不再以 `sso/account` 刷新作为主刷新入口，避免“refresh 成功但 1fa 未更新”导致后续历史请求 `401`。

### 手动触发 refresh（研究环境）
目标：在不改包的前提下，强制走 refresh 分支验证调用。

可行方案（Frida）：
1. Hook `TokenProvider.e(...)` 并返回 `false`，强制“当前 token 无效”。
2. 触发任意需要鉴权 token 的业务请求（建议前台操作）。
3. 观察 `TokenRefreshManager.f(...)` 命中与抓包中的 `.../oauth/v1/token/refresh` 请求。

注意：
- 设备需开启自动时间/自动时区，避免过期判断被短路。
- 后台阶段可能因系统调度/请求减少而看起来“不刷新”，应以前台可复现链路为准。
