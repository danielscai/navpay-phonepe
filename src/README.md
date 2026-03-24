# src 模块注入原则

适用范围：`src/` 下除 `log_server` 外的所有模块都会注入到同一个 PhonePe APK。

统一标准文档：[`docs/编排统一规范.md`](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/docs/编排统一规范.md)。

## 目录分层

- `src/apk/`：APK 模块与注入框架
- `src/pipeline/`：编排与工具脚本
- `src/services/`：日志接收服务、业务服务、管理端

## 统一要求

- **统一编排入口是 `src/pipeline/orch/orchestrator.py`**。模块目录只保留 orchestrator 直接消费的最小 `compile/merge` 脚本；`src/pipeline/tools/` 只保留薄包装 smoke/full 验证脚本与行为采样工具。
- **参考 pev70 的行为逻辑，不复用 pev70 代码或 smali**。所有注入代码必须是本仓库自行实现的 Java/Smali。
- **只允许一个“主入口”修改 Application**（`attachBaseContext()` 或 Manifest）。
  - 其他模块必须通过主入口调用自身的 `ModuleInit.init(Context)` 进行初始化。
- **Pine 只注入一次**。主入口负责 Pine 初始化与 `libpine.so` 复制；其他模块不得重复复制或初始化 Pine。
- **避免重复类与重复注入**：
  - 每个模块注入到新的 `smali_classesN` 目录。
  - 若发现已有同名包/类，必须先清理或跳过并提示。
  - 注入脚本需可重复执行（幂等）。
- **运行验证必须可见日志**：每个模块需要独立日志 tag，便于 `adb logcat -s <TAG>` 验证注入生效。
- **默认测试模拟器**：`emulator-5554`（后续测试默认使用该串号，除非在脚本参数中显式覆盖）。
- **Android SDK 依赖**：测试脚本默认在 `$ANDROID_HOME` 或 `~/Library/Android/sdk` 下寻找 build-tools，优先 `35.0.0`；若缺失会自动搜索其他版本的 `zipalign/apksigner`，找不到则报错并提示安装 build-tools。
- **Java 运行时**：`apksigner` 需要 Java，可用 `JAVA_HOME=/opt/homebrew/opt/openjdk`（macOS Homebrew 默认路径）。测试脚本会自动设置该默认值。
- **测试 APK 基线**：统一从 `cache/phonepe/decompiled/base_decompiled_clean` 复制到工作目录，避免污染缓存；缓存由 `python3 src/pipeline/orch/orchestrator.py rebuild` 生成。
- **统一编排入口**：`src/pipeline/orch/orchestrator.py`（依赖关系配置见 `src/pipeline/orch/cache_manifest.json`）。
- **ADB 守护进程异常**：若出现 `could not install *smartsocket* listener: Operation not permitted`，优先使用 SDK 自带 adb（`$ANDROID_HOME/platform-tools/adb`），并执行 `adb kill-server && adb start-server` 后再重试。

## 推荐组织方式

- 主入口模块（目前建议 `signature_bypass`）：
  - 负责 Application 注入
  - 负责 Pine 初始化
  - 负责调用其他模块的 `ModuleInit.init(Context)`

- 其他模块（例如 `phonepehelper`、`https_interceptor`）：
  - 只提供 `ModuleInit.init(Context)`
  - 不修改 Application
  - 不复制 Pine

## 添加新模块时的检查清单

1) 新模块是否只实现 Java 源码，不包含 pev70 smali 复用？
2) 是否提供 `ModuleInit.init(Context)`？
3) 注入脚本是否只保留 orchestrator 所需的最小入口，且具备幂等性？
3.1) 是否在 `package.json` 添加了对应的 yarn alias？
4) 是否避免重复注入 Pine？
5) 是否能通过 `adb logcat -s <TAG>` 验证？

## Step6 原则（先跑通，再增强）

- 先用**最小化代码**完成注入与启动验证，确保应用可运行（集成测试通过）。
- 通过后再逐步增加功能，避免一次性引入过多逻辑导致不可控崩溃。
- Step6 是累加流程：必须先完成 Step3（signature_bypass）和 Step4（https_interceptor）补丁，再叠加 phonepehelper。

> 注：如果确实需要新的 Application 注入点，必须先评估与主入口冲突的风险并在 `src/README.md` 更新方案。

## 当前推荐命令

- 推荐主流程（profile，主契约）：
  - `python3 src/pipeline/orch/orchestrator.py plan`
  - `python3 src/pipeline/orch/orchestrator.py pre-cache`
  - `python3 src/pipeline/orch/orchestrator.py compile-modules`
  - `python3 src/pipeline/orch/orchestrator.py merge`
  - `python3 src/pipeline/orch/orchestrator.py compile`
  - `python3 src/pipeline/orch/orchestrator.py test --serial emulator-5554`（需要 adb/模拟器）
  - 默认 profile 为 `full`，如需切换可追加 `--profile <name>`。

- 已移除旧模块别名命令，统一走上述 profile 主流程。
