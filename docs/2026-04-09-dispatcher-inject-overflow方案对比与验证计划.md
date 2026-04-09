# Dispatcher 注入溢出问题：旧方案/新方案对比与验证计划（2026-04-09）

## 1. 问题背景

在执行 `orch build phonepe` 时，`apktool b` 失败，核心报错为：

- `Unsigned short value out of range: 65536`
- 出现在 `smali`（主 dex）回编阶段，日志位置指向 `MaximusDBDataSource->n(...)` 附近。

该报错表面出现在某个业务方法，但根因并非该方法逻辑本身，而是主 dex 引用索引越界（`method_ids` 达到上限）。

## 2. 为什么 `cache/phonepe1/from_device/base.apk` 之前可工作

对比两个基线 APK 的主 dex 头部：

- 旧基线：`cache/phonepe1/from_device/base.apk`
  - `classes.dex method_ids_size = 65521`
- 新基线：`cache/apps/phonepe/snapshot_seed/base.apk`
  - `classes.dex method_ids_size = 65536`

结论：

- 旧基线主 dex 仍有 15 个 method id 空间，所以“Application 入口再加一条 Dispatcher 调用”仍可打包通过。
- 新基线主 dex 已达到上限（65536），再增加主 dex 对新方法/类型的引用就会触发 apktool/smali 写入失败。

补充观测：

- 旧基线 dex 数量：17（`classes.dex` 到 `classes17.dex`）
- 新基线 dex 数量：13（`classes.dex` 到 `classes13.dex`）
- 新基线更“密集”，主 dex 压力更高。

## 3. 旧方案（本次修复前）

### 3.1 启动路径

- `signature_bypass` 和 `phonepehelper` 的 merge 脚本都会尝试向 `PhonePeApplication.attachBaseContext()` 注入：
  - `Lcom/indipay/inject/Dispatcher;->init(Landroid/content/Context;)V`
- `Dispatcher` 再分发调用：
  - `HookEntry.init(...)`
  - `ModuleInit.init(...)`

### 3.2 优点

- 启动时机早（Application attachBaseContext）。
- 单一入口，易于理解。

### 3.3 缺点

- 强依赖主 dex 可继续承载新引用。
- 对“主 dex 已满”的新版本基线不稳定，可能直接导致回编失败。

## 4. 新方案（本次修复后）

### 4.1 启动路径调整

- 在 full profile（包含 `phonepe_phonepehelper`）下：
  - 跳过向 `PhonePeApplication` 注入 Dispatcher 调用。
  - 改为由 `NavpayBridgeProvider.onCreate()` 反射触发 `Dispatcher.init(context)`。
- `Dispatcher` 分发逻辑本身保持不变，仍负责调用模块入口。

### 4.2 关键改动

- `src/pipeline/orch/orchestrator.py`
  - `merge()` 支持按模块传入 `merge_env`。
  - 新增 `profile_module_merge_env(...)`，在 full profile 给 `sigbypass/phonepehelper` 传 `NAVPAY_SKIP_APP_DISPATCHER_INJECT=1`。
  - `verify_profile_injection(...)` 调整为：
    - 对包含 phonepehelper 的场景，允许“Application 注入”或“Provider 启动 Dispatcher”二选一通过。
- `src/apk/signature_bypass/scripts/merge.sh`
  - 支持 `NAVPAY_SKIP_APP_DISPATCHER_INJECT=1` 时跳过 Application 注入。
- `src/apk/phonepehelper/scripts/merge.sh`
  - 支持同一环境变量跳过 Application 注入。
  - 校验逻辑新增 Provider 启动 Dispatcher 的通过条件。
- `src/apk/phonepehelper/src/main/java/com/phonepehelper/NavpayBridgeProvider.java`
  - `onCreate()` 中新增反射调用 `com.indipay.inject.Dispatcher.init(Context)`。

## 5. 对比结论

- 旧方案：依赖主 dex 冗余空间，在旧基线可用，但对新基线（method_ids=65536）不鲁棒。
- 新方案：避免在主 dex 再注入 Dispatcher 引用，绕开主 dex method id 上限触发点，已可完成 `orch build phonepe`。

## 6. 当前状态与验证结论

已完成验证：

- `orch build phonepe` 可成功构建并签名，不再出现 `Unsigned short value out of range: 65536`。
- 编排相关单测（注入校验契约）通过。

明确声明（按当前状态）：

- 本次改动主要验证了“可构建性”和“静态注入契约”。
- 运行时行为尚未做完整回归，当前方案**未经完整端到端测试**，需要进一步验证。

## 7. 后续验证计划（必须执行）

1. 启动链路验证  
   在 `yarn test` 或 `orch test phonepe` 下确认应用可稳定启动，且 `Dispatcher` 仅初始化一次。

2. 模块初始化验证  
   校验以下入口实际被调用：
   - `HookEntry.init(...)`
   - `ModuleInit.init(...)`

3. 功能回归验证  
   重点检查：
   - HTTPS 拦截链路是否仍可用
   - phonepehelper checksum/provider 相关能力是否正常
   - heartbeat_bridge 是否无回归

4. 时序风险验证  
   Provider 触发时机晚于 Application attach，需确认不会影响依赖“超早期初始化”的行为。

5. 多设备/多版本验证  
   至少在当前主用模拟器与一台真机完成回归，避免仅在单环境通过。

## 8. 风险说明

- Provider 触发 Dispatcher 的时机和 Application attachBaseContext 不同，可能影响部分早期 hook 覆盖率。
- 若未来某版本不触发该 Provider，可能导致模块未初始化（需在测试中覆盖）。
- 目前未引入自动 dex 负载重平衡机制，后续仍建议补充“主 dex 容量阈值检查与自动降级策略”。

