# 统一 Hook Runtime 架构（Dispatcher + Pine）

## 目标
将 Pine 初始化从业务模块中抽离，统一由 `_framework/dispatcher` 入口负责，避免多个模块重复初始化 Pine 导致耦合与冲突。

## 核心入口
- `_framework/dispatcher` 提供统一入口：
  - `Lcom/indipay/inject/Dispatcher;->init(Landroid/content/Context;)V`
- `Dispatcher.init` 现在会先调用：
  - `Lcom/indipay/inject/RuntimeInit;->init(Landroid/content/Context;)V`（统一初始化 Pine）
- 然后再执行模块入口（通过 `##MODULE_CALLS##` 注入）

## Pine 初始化位置
- 代码实现位于：
  - `src/signature_bypass/src/main/java/com/indipay/inject/RuntimeInit.java`
- 统一执行：
  - `PineConfig` 配置
  - `Pine.ensureInitialized()`

## 模块入口变更
- `signature_bypass`：
  - `HookEntry.init()` 不再初始化 Pine，仅负责安装签名 Hook。
- `phonepehelper`：
  - 不再注入 `HookEntry`，而是向 `Dispatcher.init()` 注入 `ModuleInit.init()` 调用。

## 注入流程变化
### 签名绕过模块
- `src/signature_bypass/scripts/inject.sh` 现在：
  1. 注入 Dispatcher 入口（`inject_entry.py`）
  2. 生成 Dispatcher.smali（包含 HookEntry 入口）

### phonepehelper 模块
- `src/phonepehelper/scripts/merge.sh` 现在：
  - 直接向 `Dispatcher.smali` 注入 `ModuleInit.init()`
  - 不再修改 `HookEntry`

## 为什么这样做
- Pine 只初始化一次，避免重复初始化造成不稳定
- 模块解耦，任何模块只需要注册自己的 Hook/服务逻辑
- Dispatcher 成为统一入口，架构清晰

## 兼容性说明
- 该方案依赖 `Dispatcher.smali` 存在，因此必须先注入 `signature_bypass`（用于创建 Dispatcher）。
- 目前流水线仍然遵循：`sigbypass -> https -> phonepehelper`
