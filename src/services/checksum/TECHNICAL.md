# Technical Notes

这个模块来自方案 3 的 research 收敛结果，但现在作为正式服务代码使用。

## Core Pieces

### `UnidbgChecksumProbe`

负责：

- 建立 unidbg Android 环境
- 加载 `libphonepe-cryptography-support-lib.so`
- 调用 `EncryptionUtils.nmcs`
- 输出结构化 probe report

### `ChEmulation`

负责模拟 Java 侧 `CH` helper：

- SHA-1
- SHA-256
- Base64.encode
- device id bytes
- time bytes
- AES/GCM
- AES/ECB

### `ApkSignatureExtractor`

负责从 `patched_signed.apk` 中提取真实包签名证书字节，避免 `Signature->toByteArray()` 继续返回假数据。

### `ChecksumHttpService`

对外暴露：

- `GET /health`
- `POST /checksum`
- `POST /validate`

内部实现上不重复造轮子，而是直接复用 `scripts/run_probe.sh`，统一走正式服务模块下的 Maven 编译和 probe 调用路径。

## Why It Works

之前失败的根因不是找不到 `nmcs`，而是 native 运行时依赖的 Java 语义不完整。

修复后的关键点：

1. 默认改成 `CH emulate`
2. 包签名改成真实 APK 证书字节
3. 设备 ID 优先从 `adb settings get secure android_id` 注入
4. HTTP 服务层只做封装，不改 checksum 核心生成逻辑

## Current Guarantee

这个正式服务当前保证的是“结构成功”：

- checksum 是合法 Base64
- 长度落入成功样本区间
- Base64 解码后是 ASCII 风格 token

它当前不保证：

- 与真实 Android app 进程生成结果完全同值
- 与 PhonePe 线上环境逐位一致

## Operational Notes

- 默认端口：`19190`
- 默认目标 APK：`cache/profiles/full/build/patched_signed.apk`
- `yarn checksum:test` 会在服务未启动时自动拉起服务，再做健康检查和结构校验
