# Release To Admin CLI

## 用法

```bash
yarn release:to-admin \
  --env local \
  --apk cache/phonepe/snapshot_seed/base.apk \
  --abi-apk cache/phonepe/snapshot_seed/split_config.arm64_v8a.apk \
  --density-apk cache/phonepe/snapshot_seed/split_config.xxhdpi.apk \
  --version-name 26.01.02.2 \
  --version-code 2601022
```

## 参数

- `--apk`：可选，`--base-apk` 的兼容别名。
- `--base-apk`：可选，显式指定 `base.apk` 路径（默认等于 `--apk`）。
- `--abi-apk`：可选，指定 ABI split 路径（默认 `${baseDir}/split_config.arm64_v8a.apk`）。
- `--density-apk`：可选，指定 density split 路径（默认 `${baseDir}/split_config.xxhdpi.apk`）。
- `--env`：可选，默认 `local`。
- `--baseUrl`：可选，覆盖目标 admin 地址。
- `--token`：可选，覆盖 `RELEASE_TOKEN` 环境变量。
- `--appId`：可选，发布目标应用引用（推荐使用稳定名称，如 `phonepe`）；未设置时会尝试 `RELEASE_APP_ID`，再回退到 `phonepe`。
- `--version-name`：可选，覆盖从 APK 读取的版本名。
- `--version-code`：可选，覆盖从 APK 读取的版本码。
- `--installer-min-version`：可选，覆盖安装器最低版本。

## 行为

- 默认目标环境是 `local`。
- 默认输入应来自 `cache/phonepe/snapshot_seed`，该目录由版本化 snapshot 快照生成，不再直接读取旧的 `from_device` 目录。
- 若未传 `--version-name`，CLI 会查询服务端最新 release（按 `versionCode` 最大值）并自动生成版本号，格式固定为 `YY.MM.DD.N`：
  - 若最新版本日期等于当天：`N + 1`（如 `26.01.02.1` 后自动变为 `26.01.02.2`）。
  - 若最新版本不是当天：从当天 `.0` 开始（如 `26.01.02.0`）。
- 若未传 `--version-code` 且版本名符合 `YY.MM.DD.N`，CLI 会自动推导 `versionCode = YYMMDDN`（例如 `26.01.02.0 -> 2601020`）。
- CLI 会强校验：`versionName` 去掉 `.` 后必须等于 `versionCode`，不一致会直接失败。
- 默认发布会先构建最新代码，再把新版本号注入 `base/abi/density` 三个 APK 后上传。
- 若默认 `phonepe` 返回 `create_failed_404`，通常表示服务端 `payment_apps` 中不存在可解析为 `phonepe` 的应用记录（名称不存在或被禁用）。
- 上传前会执行签名一致性预检（`apksigner verify --print-certs`）：
  - `base/abi/density` 三个 APK 的签名 digest 必须完全一致。
  - 不一致时会直接失败并抛出 `apk_signatures_inconsistent`，不会创建/上传 release。
- 会先读取当前 active release 做幂等预检。
- 若命中幂等（版本一致且校验匹配）则直接跳过。
- 未命中时按 `create -> upload(base/abi/density) -> activate` 执行发布。

## 依赖

- 需要系统可执行 `apksigner`（Android build-tools 自带），用于读取 APK 签名摘要。
