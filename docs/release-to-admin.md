# Release To Admin CLI

## 用法

```bash
yarn release:to-admin --env local --apk cache/profiles/full/build/patched_signed.apk
```

## 参数

- `--apk`：必填，待发布 APK 路径。
- `--env`：可选，默认 `local`。
- `--baseUrl`：可选，覆盖目标 admin 地址。
- `--token`：可选，覆盖 `RELEASE_TOKEN` 环境变量。
- `--appId`：可选，默认 `phonepe`。

## 行为

- 默认目标环境是 `local`。
- 会先读取当前 active release 做幂等预检。
- 若命中幂等（版本一致且校验匹配）则直接跳过。
- 未命中时按 `create -> upload -> activate` 执行发布。
