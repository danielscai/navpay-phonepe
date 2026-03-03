# 统一 Hook Runtime 架构（Dispatcher + Pine）

## 目标
统一 Application 注入入口，所有模块通过 Dispatcher 注册，避免模块间直接改写彼此入口实现。

## 核心入口
- `_framework/dispatcher` 提供统一入口：
  - `Lcom/indipay/inject/Dispatcher;->init(Landroid/content/Context;)V`
- `Dispatcher.init` 通过模板中的 `##MODULE_CALLS##` 执行已注册模块入口。

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
- `src/signature_bypass/scripts/inject.sh` 现在：
  1. 注入 Dispatcher 入口（`inject_entry.py`）
  2. 生成 Dispatcher.smali（包含 HookEntry 入口）

### phonepehelper 模块
- `src/phonepehelper/scripts/merge.sh` 现在：
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
