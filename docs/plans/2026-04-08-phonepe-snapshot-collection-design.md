# PhonePe 同版本多 ABI/Density 采集归档设计（2026-04-08）

## 1. 背景与目标

基于《真机与模拟器适配策略（2026-04-08）》的现实约束，需要建立一个可执行、可持续的采集机制，满足以下目标：

1. 采集同一 PhonePe 版本在不同 ABI 与 density 组合下的可复用 APK 快照。
2. 采集结果按稳定主键归档，避免跨版本、跨签名混用。
3. 在本机资源有限条件下，严格串行执行，不并发模拟器。
4. 自动完成“安装/升级 -> 采集 -> 校验 -> 归档 -> 报告”流水线。
5. 当 Google Play 未登录等阻塞条件出现时，明确报告并可断点续跑。
6. 产出 AI 友好的索引与文档，支持后续检索与复用。

## 2. 设计原则

1. 设备矩阵驱动：采集目标由配置清单定义，不做隐式推断。
2. 串行优先：一次只处理一个目标设备，控制资源占用。
3. 版本锚点机制：先在指定 bootstrap 设备完成升级，再锚定版本。
4. 强一致门禁：仅允许 `packageName + versionCode + signingCertDigest` 一致的文件入库。
5. 报告优先：对缺口与阻塞显式建档，便于人工接力与自动恢复。

## 3. 命令与入口

### 3.1 Orchestrator 主入口（推荐）

- 命令：`python3 src/pipeline/orch/orchestrator.py collect`
- 关键参数：
  - `--matrix src/pipeline/orch/device_matrix.json`
  - `--package com.phonepe.app`
  - `--resume <run_id>`（可选）

### 3.2 顶层别名（薄封装）

- `yarn collect:phonepe` -> 调用 `yarn orch collect --matrix ... --package ...`

### 3.3 安全约束

- 采集链路禁止使用 `yarn orch apk --fresh`。
- 默认仅使用可复用路径与非 fresh 打包方式。

## 4. 目标矩阵配置

新增：`src/pipeline/orch/device_matrix.json`

建议结构：

```json
{
  "bootstrap_target_id": "emu_arm64_xxhdpi",
  "package": "com.phonepe.app",
  "targets": [
    {
      "target_id": "emu_arm64_xxhdpi",
      "serial_alias": "emulator-5554",
      "expected_abi": "arm64-v8a",
      "expected_density": "xxhdpi",
      "required": true
    }
  ]
}
```

说明：

1. `bootstrap_target_id` 为版本锚点设备，必须在 `targets` 中存在。
2. `serial_alias` 使用既有 alias 规范（复用 orchestrator 的设备别名解析）。
3. `required=true` 的目标若失败或缺失，会进入 gap/blocker 报告。

## 5. 串行采集状态机

状态：`pending -> preparing_device -> ensure_phonepe_version -> collect_apks -> validate -> archived -> done/failed/blocked`

执行规则：

1. 按 `targets` 顺序逐个执行，严格串行。
2. 当前目标未结束前，不启动下一个目标。
3. 任一目标若触发阻塞（例如 Play 未登录），整个 run 进入 `blocked` 并退出。

## 6. 版本锚点机制

用户约束：升级前无法预知目标 `versionCode/signingDigest`。

落地策略：

1. 首先在 `bootstrap_target_id` 设备上执行安装/升级流程。
2. 升级完成后拉取并解析 `base.apk`，获得：
   - `packageName`
   - `versionCode`
   - `signingCertDigest`
3. 将三者作为本次 run 的 `version_anchor`。
4. 后续所有目标采集结果必须与该 anchor 一致。

## 7. 安装/升级自动化

每个目标的前置步骤：

1. 检查设备在线与目标包安装状态。
2. 执行安装或升级流程（非 fresh）。
3. 复检可启动性与包信息，进入采集阶段。

Google Play 登录门禁：

1. 如果升级路径依赖 Play，先执行登录可用性检测。
2. 检测到未登录/不可用时：
   - 生成 blocker 报告；
   - 运行状态置为 `blocked`；
   - 退出并等待人工处理。
3. 人工处理后使用 `--resume <run_id>` 继续。

## 8. 采集与校验

采集：

1. `adb shell pm path com.phonepe.app` 获取 APK 路径。
2. 拉取所有路径到目标临时目录。
3. 按目标 ABI/density 选取：
   - `base.apk`
   - `split_config.<abi>.apk`
   - `split_config.<density>.apk`

入库校验：

1. `base/split` 的 `packageName` 必须一致。
2. `base/split` 的 `versionCode` 必须一致。
3. `base/split` 的 `signingCertDigest` 必须一致。
4. 文件名与目标 ABI/density 匹配。
5. 任一校验失败则目标标记 `failed`，不写入快照索引。

## 9. 归档与索引

归档根目录：`cache/phonepe/snapshots/`

主键目录：

`cache/phonepe/snapshots/<packageName>/<versionCode>/<signingDigest>/`

目标采集目录：

`.../captures/<target_id>/`

每个 target 存储：

1. `base.apk`
2. `split_config.<abi>.apk`
3. `split_config.<density>.apk`
4. `device_meta.json`
5. `capture_meta.json`

快照级索引：

1. `index.json`（机器可读）
2. `README.md`（人类/AI 快速理解）

全局索引：

1. `cache/phonepe/snapshots/index.json`（按主键汇总）

## 10. 报告与断点续跑

运行目录：`cache/phonepe/snapshots/runs/<run_id>/`

文件：

1. `run_state.json`：当前状态、anchor、已完成/失败/阻塞目标。
2. `summary.json` / `summary.md`：总体统计与路径。
3. `gap-report.json` / `gap-report.md`：目标矩阵缺口。
4. `blocker-report.json` / `blocker-report.md`：阻塞原因与恢复指令。

退出码建议：

1. 成功：`0`
2. 普通失败：`1`
3. 阻塞（如 Play 未登录）：`20`

## 11. 文档组织（AI 可检索）

新增文档：`docs/phonepe_snapshot_collection.md`

包含：

1. 机制概览与术语解释。
2. 配置文件说明（matrix 字段）。
3. 命令示例（collect / resume / 报告查看）。
4. 常见阻塞处理（Play 登录、设备离线、版本不一致）。
5. 快照复用边界与禁忌（禁止跨主键复用）。

## 12. 风险与边界

1. Play 登录检测可能因 UI 变化产生漏判，需要保留显式失败提示。
2. 部分设备 `pm path` 返回 split 集不完整，需在报告中明确指示缺失项。
3. 真机路径（如 ARM32）受设备可用性影响，只能按矩阵现状采集并报告缺口。
4. 本设计不做“自动补齐不存在设备组合”，只对矩阵目标负责。

## 13. 验收标准

1. 可通过一条 `collect` 命令完成串行采集全流程。
2. 首台 bootstrap 设备成功建立版本锚点。
3. 后续目标只入库与锚点一致的 APK 组合。
4. 运行结束必有 `summary + gap + blocker/run_state` 报告。
5. 失败可 `--resume` 从断点继续。
6. 不使用 `yarn orch apk --fresh`。

