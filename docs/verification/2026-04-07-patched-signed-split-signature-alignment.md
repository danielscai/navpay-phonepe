# 2026-04-07 patched_signed 发布签名一致性验证

## 目标
- 发布主包切换到 `cache/profiles/full/build/patched_signed.apk`。
- abi/density split 与该主包签名保持一致。
- 在模拟器上完成 split-session 安装与启动验证。

## 根因
- 旧默认链路在测试时直接使用设备拉包目录中的 `base.apk` 作为 split-session base。
- 该路径与 `patched_signed.apk` 签名不同，导致安装阶段可能出现 `INSTALL_FAILED_UPDATE_INCOMPATIBLE` 或 `signatures are inconsistent`。

## 固化后流程
1. 构建：`yarn apk`
2. 签名对齐：`orchestrator profile_apk()` 自动把 `cache/phonepe/snapshot_seed` 中的 required split 准备到 `cache/profiles/full/build/`，并校验与 `patched_signed.apk` 同签名。
3. 测试安装：`yarn test --serial emulator-5554`（默认 split-session）
4. 发布：admin 发布脚本以 `patched_signed.apk` 为 base，默认读取 `cache/phonepe/snapshot_seed` 中的 split（`split_config.arm64_v8a.apk`、`split_config.xxhdpi.apk`）。

## 验证命令与结果

### 1) 构建
- 命令：`yarn apk`
- 结果：PASS，日志包含 `release split signatures aligned with base APK`

### 2) 签名摘要
- 命令：
  - `apksigner verify --print-certs cache/profiles/full/build/patched_signed.apk`
  - `apksigner verify --print-certs cache/profiles/full/build/split_config.arm64_v8a.apk`
  - `apksigner verify --print-certs cache/profiles/full/build/split_config.xxhdpi.apk`
- 结果：三者 `Signer #1 certificate SHA-256 digest` 均为
  - `c57335d96ae6aa589ecf2e2aa5724a826c9f867af9bc93dfeefd0368a2a0f08e`

### 3) split-session 验证脚本
- 命令：`adb -s emulator-5554 uninstall com.phonepe.app || true && yarn verify:phasea`
- 结果：PASS（3 次正例安装成功 + 1 次缺失 density split 负例失败）

### 4) 编排器测试
- 命令：`yarn test --smoke --serial emulator-5554`
- 结果：PASS（`install-multiple --no-incremental` + 启动成功）
- 命令：`yarn test --serial emulator-5554`
- 结果：PASS（`install-multiple --no-incremental` + 启动成功）
