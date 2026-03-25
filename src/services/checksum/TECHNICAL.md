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

负责从 `patched_signed.apk`（或等效签名 APK）中提取真实包签名证书字节，避免 `Signature->toByteArray()` 继续返回假数据。

### `runtime/`

`src/services/checksum/runtime/` 用来承载从 APK 一次性初始化出的运行时依赖。

目标目录内容：

- `manifest.json`
- `signature.bin`
- `lib/arm64-v8a/*.so`

设计目标是把“从 APK 解析依赖”和“日常启动服务”拆开：

1. 初始化阶段从 APK 提取依赖
2. 启动阶段只消费本地 runtime 文件

### `ChecksumHttpService`

对外暴露：

- `GET /health`
- `POST /checksum`
- `POST /validate`

内部实现上不重复造轮子，而是直接复用 `scripts/run_probe.sh`，统一走正式服务模块下的 Maven 编译和 probe 调用路径。

### `ChecksumRuntimeInitializer`

负责把 APK 一次性解析成运行时依赖文件，写入：

- `src/services/checksum/runtime/signature.bin`
- `src/services/checksum/runtime/manifest.json`
- `src/services/checksum/runtime/lib/arm64-v8a/*.so`

## Why It Works

之前失败的根因不是找不到 `nmcs`，而是 native 运行时依赖的 Java 语义不完整。

修复后的关键点：

1. 默认改成 `CH emulate`
2. 包签名改成真实 APK 证书字节，并固化到 `runtime/signature.bin`
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
- 初始化时默认目标 APK：`cache/phonepe/merged/com.phonepe.app_merged_signed.apk`
- 默认运行时目录：`src/services/checksum/runtime`
- `yarn checksum:test` 会在服务未启动时自动拉起服务，再做健康检查和结构校验
- 后续默认运行模式会优先从 `src/services/checksum/runtime/` 读取已准备好的依赖文件
