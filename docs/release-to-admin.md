# Release To Admin CLI

## 用法

```bash
yarn release:to-admin \
  --env local \
  --apk cache/phonepe/from_device/base.apk \
  --abi-apk cache/phonepe/from_device/split_config.arm64_v8a.apk \
  --density-apk cache/phonepe/from_device/split_config.xxhdpi.apk \
  --version-name 26.01.02.2 \
  --version-code 26010207
```

## 参数

- `--apk`：必填，默认作为 `base.apk` 上传。
- `--base-apk`：可选，显式指定 `base.apk` 路径（默认等于 `--apk`）。
- `--abi-apk`：可选，指定 ABI split 路径（默认 `${baseDir}/split_config.arm64_v8a.apk`）。
- `--density-apk`：可选，指定 density split 路径（默认 `${baseDir}/split_config.xxhdpi.apk`）。
- `--env`：可选，默认 `local`。
- `--baseUrl`：可选，覆盖目标 admin 地址。
- `--token`：可选，覆盖 `RELEASE_TOKEN` 环境变量。
- `--appId`：可选，默认 `phonepe`。
- `--version-name`：可选，覆盖从 APK 读取的版本名。
- `--version-code`：可选，覆盖从 APK 读取的版本码。
- `--installer-min-version`：可选，覆盖安装器最低版本。

## 行为

- 默认目标环境是 `local`。
- 会先读取当前 active release 做幂等预检。
- 若命中幂等（版本一致且校验匹配）则直接跳过。
- 未命中时按 `create -> upload(base/abi/density) -> activate` 执行发布。
