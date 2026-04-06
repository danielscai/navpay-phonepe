# PhonePe Base APK Distribution Verification Design

日期：2026-04-06  
状态：已评审通过（用户确认）  
范围：在不改现有编排代码的前提下，设计并执行“base.apk + required split 同会话安装”验证流程；验证通过后再集成到 `yarn apk / yarn test`。

## 1. 背景与目标

当前流程历史上依赖 `cache/phonepe/from_device` 的多 APK 输入并做 merged 产物，导致分发包体积偏大。  
本次目标是将分发策略简化为“以 base.apk 为核心”，但在安装链路上保持 split 依赖完整性。

本次确认的核心约束：

- 构建输入只使用 `cache/phonepe/from_device/base.apk`。
- 不允许对 base.apk 做任何 split 相关改造（不移除、不绕过、不内联 split 依赖）。
- 安装验证必须采用 `base.apk + required split` 同一安装会话提交（统一策略）。
- 验收标准：安装成功 + 首次启动成功（进入目标 Activity 且进程不崩溃）。

## 2. 方案选择结论

采用方案：外置验证脚本（先验证，后集成）。

原因：

- 满足“验证成功前不改编排”的强约束。
- 可以快速迭代验证逻辑与错误分类，降低对主链路影响。
- 验证通过后可直接迁移为 orchestrator 内部同构逻辑，减少二次设计成本。

不采用方案：

- 直接修改 orchestrator 主流程（与当前约束冲突）。
- 纯手工命令流程（可重复性和可审计性不足）。

## 3. 架构与边界

验证阶段新增一个独立验证工具（脚本），不接入默认 `yarn apk` / `yarn test`。

输入：

- `cache/phonepe/from_device/base.apk`
- `cache/phonepe/from_device/` 下可用 split 集合
- 当前 `yarn apk` 产物（待验证安装对象）

输出：

- 结构化验证结果（成功/失败、失败阶段、设备参数、安装与启动关键信息）
- 验证报告文档，作为后续集成门禁依据

## 4. 组件与数据流

组件：

1. 验证驱动：协调全流程执行与阶段状态落盘。
2. split 选择器：基于设备 ABI/density 在 `from_device` 目录做动态匹配。
3. 安装执行器：单次会话提交三包安装（`install-multiple` 语义）。
4. 启动校验器：检查目标 Activity 可见与进程存活，捕获崩溃日志。
5. 结果记录器：输出机器可读结果 + 人类可读摘要。

数据流：

1. 采集设备参数（`SUPPORTED_ABIS`、density、SDK）。
2. 扫描可用 split 清单。
3. 选出 `base.apk + abi split + density split`。
4. 执行同会话安装。
5. 拉起应用并执行首启稳定性检查。
6. 输出 `PASS/FAIL` 及失败阶段。

## 5. 错误处理策略

按阶段 fail-fast，统一错误码语义：

1. `SELECT_SPLIT_FAILED`
- ABI 或 density 对应 split 缺失。
- 输出设备参数与可用 split 列表。

2. `INSTALL_MULTIPLE_FAILED`
- 三包同会话安装失败。
- 保留系统错误码（例如 `INSTALL_FAILED_NO_MATCHING_ABIS`）。

3. `LAUNCH_FAILED`
- 安装成功但 `am start` 拉起失败。

4. `RUNTIME_CRASHED`
- 首启进程退出或捕获到应用相关 crash 关键日志。

5. `ACTIVITY_TIMEOUT`
- 在超时窗口内未进入目标 Activity（或约定的登录页 fallback Activity）。

## 6. 验证矩阵（最小可行门禁）

1. Fresh Install 主路径（强制门禁）
- 前置卸载目标包，确保“全新未安装”状态。
- 同会话安装三包。
- 首次启动成功。

2. Replay Stability
- 连续重复执行 2 次同流程，验证可重复性。

3. Negative Case（缺失 required split）
- 人为移除一个必需 split，必须失败且错误分类正确。

4. 当前环境优先验证
- 首批以当前模拟器组合（`arm64_v8a + xxhdpi`）为基准通过。

## 7. 两阶段落地计划

### Phase A：验证阶段（不改编排）

- 新增独立验证脚本。
- 运行最小可行门禁用例与负例。
- 产出 `docs/verification/` 验证报告。

### Phase B：集成阶段（仅在 Phase A 通过后）

- 将验证流程迁移到 orchestrator `test` 链路。
- 默认安装策略切换为三包同会话安装。
- 保留短期回滚开关，便于发布初期故障兜底。
- 更新 README/操作文档，统一团队执行口径。

## 8. 风险与缓解

主要风险：

- 设备维度 split 选择覆盖不足导致安装失败。
- ADB 安装过程偶发失败影响验证稳定性。
- 首启成功但短时内崩溃导致误判。

缓解措施：

- 报告中强制记录设备参数与选包结果，便于复盘。
- 安装步骤允许有限次可观测重试。
- 启动校验窗口内做进程存活与 crash 双重判定。

## 9. 最终结论

在现有约束下，最稳妥路径是：

- 先用外置验证脚本证明“base + required split 同会话安装”在全新设备可稳定通过；
- 通过后再并入现有编排流程，替换默认安装策略。

该结论已获用户确认，可进入实现计划拆解阶段。
