# orch release phonepe Repack Mode 对比报告（2026-04-10）

## 背景

问题：`orch release phonepe` 在仅修改 bridge 版本参数时，仍触发模块重构建与全量 merge，发布耗时过高。

目标：让发版默认走“轻量重打包”路径，仅更新 bridge 元数据并重新签名，不重跑 module 构建与 merge。

---

## 本次改造

1. `release` 默认模式改为 `repack`（保留 `full` 兜底模式）。  
2. 新增 `profile_apk_release_repack(...)`：  
   - 复用已有 profile workspace  
   - 仅改 `AndroidManifest.xml` 中 bridge provider 的 3 个 meta-data  
   - 仅执行 `sigbypass_compile` + split 对齐签名校验步骤  
3. `phonepe_phonepehelper` 的 `builder.fingerprint_env` 去掉 `BRIDGE_*`，避免 bridge 参数变动触发 module artifact 重建。  
4. 删除 Yarn 发版入口（`yarn release` / `release:publish`），统一走 `orch release`。

---

## 关键流程对比

### 旧流程（bridge 参数变化时）

- `cmd_release` -> `profile_apk(...)`
- `profile_prepare`（可能刷新 workspace）
- `profile_merge`（逐模块 merge）
- `ensure_module_artifact(phonepe_phonepehelper)` 因 `BRIDGE_*` 指纹变化触发重编译
- `sigbypass_compile`

### 新流程（默认 `repack`）

- `cmd_release --mode repack`（默认）
- `profile_apk_release_repack(...)`
- 直接修改 workspace `AndroidManifest.xml` bridge 元数据
- `sigbypass_compile`

只有 workspace 缺失时才一次性回退到 `profile_merge` 建立基线。

---

## 复杂度/耗时影响（结构化对比）

在“仅 bridge 参数变化”场景：

- Module artifact rebuild：`旧=1`，`新=0`
- 模块 merge 次数：`旧=全部模块`，`新=0`
- 必需 APK 打包签名：`旧=1`，`新=1`（不可省）

结论：新流程把可避免的重构建和 merge 全部移除，只保留 APK 内容变更后的最小必要重打包签名。

---

## 实测时间对比（同机同仓，2026-04-10）

测试条件：

- 仓库：`navpay-phonepe`
- 命令入口：`cmd_release(...)`
- 网络上传链路已替换为本地 stub（避免网络抖动干扰），仅对比本地构建链路耗时
- 版本参数一致：`26.04.10.9`

结果：

- `repack`：`26.358s`
- `full`：`235.245s`
- 加速比：`8.92x`（`full / repack`）

解释：

- `repack` 主要耗时在一次 `apktool build + zipalign + apksigner`
- `full` 额外包含多模块 merge、多 dex smali 重组与更重的回编阶段

---

## 测试验证

执行：

```bash
python3 -m pytest \
  src/pipeline/orch/tests/test_module_artifact_planning.py \
  src/pipeline/orch/tests/test_module_artifact_cache.py \
  src/pipeline/orch/tests/test_profile_injection_verification.py \
  src/pipeline/orch/tests/test_entry_contract.py \
  src/pipeline/orch/tests/test_phonepehelper_bridge_manifest_injection.py \
  src/pipeline/orch/tests/test_cli_contract.py \
  src/pipeline/orch/tests/test_package_scripts_contract.py \
  src/pipeline/orch/tests/test_release_repack_mode.py -q
```

结果：`46 passed`。

新增关键回归点：

- `release` 默认路由到 `repack`
- `--full` 明确路由到 full build
- `repack` 模式下优先走 `profile_apk_release_repack`
- Manifest bridge 元数据 upsert 正确

---

## 使用方式（新）

默认轻量模式（推荐）：

```bash
python3 src/pipeline/orch/orchestrator.py release phonepe \
  --version 26.04.10.3 \
  --bridge-version 26.04.10.3 \
  --bridge-schema-version 1 \
  --bridge-built-at-ms $(date +%s000) \
  --dev
```

强制全量模式（仅在模块代码/注入链路变更时）：

```bash
python3 src/pipeline/orch/orchestrator.py release phonepe --full --dev
```
