# orch 标准化设计文档（多软件采集/构建/安装/测试）

## 目标

通过 `yarn install:orch` 安装 `orch` CLI 后，直接以 `orch <subcommand>` 作为主入口，将其升级为标准化、多软件可扩展（首批 `phonepe`、`paytm`）的统一编排入口，覆盖帮助输出、采集、反编译、构建、安装、测试、信息查询。`yarn info`、`yarn install` 属于 Yarn 保留命令，文档中涉及对应动作时统一建议使用 `orch info` / `orch install`。

## 软件模型

引入统一软件标识（`app_id`）：
- `phonepe`
- `paytm`
- 后续可扩展

统一配置建议：`src/pipeline/orch/apps_manifest.json`
- 每个软件定义：`package_name`、`default_profile`、`collect_matrix`、`snapshot_root`、`decompiled_root`、`default_activity`、`required_log_tags`。

## 命令标准

### 1) 默认帮助

`yarn orch` 不带参数时打印帮助：
- 支持子命令列表
- 每个子命令示例
- 支持软件列表（来自 apps manifest）

### 2) 顶层快捷命令

安装后直接使用 `orch <subcommand>`；若通过 Yarn 触发，则保留对应脚本包装：
- `yarn plan/prepare/smali/merge/build/install/test/collect/info/decompile/device/status/graph/reset/rebuild`

标准示例（必须保持一致）：
- `orch collect`
- `orch collect phonepe`
- `orch info`
- `orch decompile phonepe 26022705`

### 3) collect（多软件）

- `orch collect`：按软件顺序采集所有受支持软件。
- `orch collect phonepe`：仅采集单软件。
- 串行规则（关键）：
1. 在单个模拟器会话中，按软件顺序采集全部软件。
2. 完成后切换下一个模拟器，再按同顺序采集全部软件。
- 采集结果写入软件隔离的 snapshot 目录，维持版本锚点与签名一致性。

### 4) info

- `orch info`
- 展示：已采集软件、版本列表、signing digest、更新时间、可用 captures 数量。
- 注：`yarn info` 由 Yarn 保留，文档和脚本建议统一写作 `orch info`。

### 5) decompile

- `orch decompile phonepe`
- `orch decompile phonepe 26022705`
- 行为：基于最新或指定版本，复用现有 `snapshot -> merged -> base_decompiled_clean` 逻辑，生成对应软件 decompiled 目录。

### 6) build

- `yarn orch build phonepe`
- 语义等价于当前 `orch apk`，但按软件维度执行。
- `apk` 作为兼容别名保留一个版本周期。

### 7) install

- `orch install phonepe`
- 默认安装到当前已开启模拟器（若无模拟器，明确报错）。
- 支持 `--serial` 指定设备：`orch install phonepe --serial emulator-5554`
- 注：`yarn install` 由 Yarn 保留，文档和脚本建议统一写作 `orch install`。

### 8) test

- `yarn orch test phonepe`
- 验证安装后应用启动、日志标签、异常界面检测（非预期页面）。
- 支持 `--serial` 指定设备。

## 目录与产物

建议按软件隔离：
- `cache/<app_id>/snapshots/...`
- `cache/<app_id>/snapshot_seed/...`
- `cache/<app_id>/decompiled/base_decompiled_clean`
- `cache/<app_id>/profiles/<profile>/build/...`

## 兼容与迁移

- 第一期保留旧命令：`apk/collect --package`。
- 新命令可直接走新接口，旧命令映射到 `app_id=phonepe`。
- 文档与 package scripts 同步切换到新命名。

## 非目标

- 本期不并发多模拟器。
- 本期不支持跨软件共享 snapshot seed。
- 本期不改动各软件注入模块业务逻辑。
