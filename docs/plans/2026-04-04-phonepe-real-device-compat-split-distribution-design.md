# PhonePe 真机兼容方案设计（网页分发 + Split 安装）

日期：2026-04-04
状态：已评审通过（用户确认）
范围：`yarn apk` 产物的真机兼容分发方案，不包含本次代码实现。

## 1. 背景与目标

当前流程主要在模拟器验证，且历史流程对 split 依赖存在设备绑定倾向（示例：固定 `arm64_v8a + xxhdpi`）。
目标是升级为准生产覆盖方案：

- 通过网页分发，不依赖 Google Play。
- 支持多 ABI / 多 density 真机自动适配。
- 用户侧尽量维持“单入口安装”体验。
- 安装失败可诊断、可回溯、可修复。

## 2. 方案选择结论

已确认采用：

- 分发形态：`Installer APK + Release Manifest + Split APK 集合`
- 安装方式：Installer 端使用 `PackageInstaller.Session` 一次性提交多 APK
- 目标路径：网页上对用户仍提供单入口（下载/打开 installer），由 installer 在后台完成 split 选择与安装。

未采用路径：

- 单 APK fat merge（体积、冲突和维护成本高）
- 继续硬编码单设备 split（兼容范围不足）

## 3. 总体架构

发布物：

1. `installer.apk`：固定下载入口，负责设备识别、下载、校验、安装。
2. `release-manifest.json`：版本索引与策略中心。
3. `apks/*.apk`：`base.apk` + 各 ABI/density split。

安装流程：

1. 用户安装并打开 installer。
2. installer 拉取 `release-manifest.json`。
3. 读取设备参数（ABI、density、SDK）。
4. 基于规则选出本机所需 splits。
5. 下载并校验 hash。
6. 通过 `PackageInstaller.Session` 一次提交安装。
7. 上报安装结果与错误码。

## 4. 发布目录与 Manifest 规范

建议目录：

- `/releases/phonepe/<version>/installer.apk`
- `/releases/phonepe/<version>/release-manifest.json`
- `/releases/phonepe/<version>/apks/base.apk`
- `/releases/phonepe/<version>/apks/split_config.<abi>.apk`
- `/releases/phonepe/<version>/apks/split_config.<density>.apk`

`release-manifest.json` 最小字段：

- `packageName`
- `versionName`
- `versionCode`
- `minSdk`
- `targetSdk`
- `installerMinVersion`
- `files[]`：`name,url,sha256,type,abi,density`
- `rules.required`：`base=true, abi=true, density=true`
- `fallbackPolicy`：`abiFallbackOrder,densityFallbackOrder,blockOnMissingRequired`

## 5. 客户端选包算法

1. 读取设备参数：
- ABI：`Build.SUPPORTED_ABIS`
- Density：由 `DisplayMetrics.densityDpi` 映射到标准 density 档
- SDK：`Build.VERSION.SDK_INT`

2. 硬门禁：
- `SDK < minSdk` 直接拒绝。
- `packageName` 不匹配直接拒绝。

3. 选包：
- 必选 `base.apk`
- ABI split 按 `SUPPORTED_ABIS` 顺序匹配
- density split 优先精确匹配，缺失时按配置 fallback

4. 安装前校验：
- 所有 required split 必须存在
- 每个文件必须通过 `sha256` 校验

5. 安装提交：
- 单次 `PackageInstaller.Session` 提交全部 split

## 6. 失败处理策略

- `DOWNLOAD_OR_HASH_FAIL`：重试 1 次，仍失败则返回完整性错误
- `NO_MATCHING_ABI / NO_MATCHING_DENSITY`：返回设备参数与缺失项
- `INSTALL_FAILED_UPDATE_INCOMPATIBLE`：提示卸载冲突签名版本
- `INSTALL_FAILED_NO_MATCHING_ABIS`：提示服务端补齐对应 ABI split

要求：任何 required split 缺失必须 fail-fast，不允许“带病安装”。

## 7. 验证矩阵与上线门禁

### 7.1 构建门禁

发布前自动校验：

- `base.apk` 存在
- 覆盖声明支持的 ABI 集（至少 `arm64-v8a`，可选 `armeabi-v7a`）
- 覆盖声明支持的 density 集（建议 `xhdpi/xxhdpi/xxxhdpi`）
- `sha256` 可复算一致

### 7.2 安装门禁

至少覆盖三类测试：

- 设备参数 -> 选包结果正确
- required split 缺失 -> 必须失败
- 常见错误码 -> 文案清晰可操作

### 7.3 回归门禁

- 安装器与 manifest 的版本兼容策略明确
- 新版本发布不破坏历史安装路径

### 7.4 线上可观测

最少埋点：

- `deviceAbi/deviceDensity/sdk`
- `selectedSplits`
- 失败阶段（下载/校验/commit）
- 系统安装错误码

## 8. 设备覆盖策略（资源受限场景）

不要求“所有手机”实测。采用分层覆盖：

- 真机代表集：2~3 台（覆盖主 ABI + 不同 density）
- 组合补齐：模拟器覆盖剩余 density/系统版本
- 发布声明：明确“已验证矩阵”，不是“全设备兼容”

## 9. 与当前仓库改造的边界

本设计明确如下改造方向（后续实施阶段执行）：

1. 移除 `arm64_v8a + xxhdpi` 硬编码依赖，改为设备感知动态匹配。
2. 增加发布物生成：`release-manifest.json` 与 split 文件清单。
3. 新增 installer 端安装链路（下载、hash 校验、session 安装、错误上报）。
4. 保留现有 `yarn apk` 作为研究构建入口，但将“准生产分发”切到 split 方案。

## 10. 风险与缓解

主要风险：

- installer 兼容性与权限流程复杂
- split 组合遗漏导致安装失败
- 签名冲突导致升级失败

缓解措施：

- 严格 manifest + 预发布门禁
- fail-fast 错误码与用户可执行提示
- 发布流程中增加签名一致性检查

## 11. 最终结论

该方案在“网页分发前提下”兼顾了兼容覆盖、可维护性和用户体验，优于继续推进单 APK 合并路径。建议进入实施计划阶段，按模块拆分开发与验证任务。

## 12. 实施约束补充（2026-04-04 二次确认）

基于后续评审，本设计补充以下约束，作为实施阶段强制条件：

1. 数据模型策略：一次性替换旧模型（不保留双轨兼容）
- 旧 `payment_apps` 单表“单版本 + downloadUrl”语义下线。
- 新模型统一采用 `app -> release -> artifact` 分层：
  - `payment_apps`（应用主档）
  - `payment_app_releases`（版本与发布状态）
  - `payment_app_release_artifacts`（base/abi/density/installer 文件）
  - `payment_app_release_events`（发布/回滚/配置变更历史）

2. 文件存储策略：本地磁盘优先
- 首版使用本地文件存储（如 `public/uploads/payment-apps/...`）。
- 数据库仅保存文件相对路径、SHA-256、大小、类型等元信息。
- 不在本阶段引入对象存储，后续如需迁移再抽象存储层。

3. API 约束：统一走 `/api/personal`
- 保留 `GET /api/personal/payment-apps` 作为客户端应用列表入口，但返回“应用 + active release 摘要 + manifest 入口”。
- 新增 manifest 与 artifact 下载接口用于 installer 安装链路：
  - `GET /api/personal/payment-apps/:appId/releases/:releaseId/manifest`
  - `GET /api/personal/payment-apps/:appId/releases/:releaseId/artifacts/:artifactId/download`
- 新增安装事件上报：
  - `POST /api/personal/payment-apps/install-events`

4. Android 安装流程约束
- `Install Payment App` 入口改为 manifest 驱动，不再直接跳转 `downloadUrl`。
- 强制流程：拉取 manifest -> 设备选包 -> 下载 + hash 校验 -> `PackageInstaller.Session` 一次提交。
- required split 缺失必须 fail-fast。

5. 管理台能力约束
- `admin/ops/settings?tab=payment_apps` 需支持：
  - 版本列表（含状态）
  - 每版本 manifest 配置可视化
  - artifacts 文件明细
  - 发布历史事件追溯
- 激活 release 前必须通过发布门禁校验（base、ABI、density、sha256、包名一致性）。
