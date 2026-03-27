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

负责从原始 PhonePe APK 提取包签名证书字节。

这里必须区分两类 APK：

- VM 载入 APK：merged/repacked 后可供 DalvikVM 使用
- 签名源 APK：原始 PhonePe APK，用来还原 `PackageInfo.signatures[0].toByteArray()`

如果错误地从 debug/repacked APK 提取签名，`19190` 会生成结构正常但业务不被服务器接受的 checksum。

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
2. 包签名改成原始 PhonePe APK 证书字节，并固化到 `runtime/signature.bin`
3. 设备 ID 和时间优先从 runtime snapshot 注入
4. HTTP 服务层只做封装，不改 checksum 核心生成逻辑
5. runtime 初始化显式区分 `sourceApk` 和 `signatureSourceApk`

## Current Guarantee

这个正式服务当前在本地会校验“结构成功”：

- checksum 是合法 Base64
- 长度落入成功样本区间
- Base64 解码后是 ASCII 风格 token

它不保证：

- 与 `19090` checksum 字符串完全同值
- 与真实 App 逐位一致

它当前真正保证的正式验收标准是：

- 用 `19190` 生成 checksum
- 注入真实 replay 请求
- 目标服务器返回 `HTTP 200`

## 为什么不建议纯 Node.js 重写核心 nmcs 计算

当前 checksum 核心并不是普通的“Node crypto 组合算法”，而是依赖 `unidbg + Android JNI + ARM64 native so` 的执行链路。

不建议纯 Node.js 重写的主要原因：

1. `nmcs` 的真实实现位于 `libphonepe-cryptography-support-lib.so`，需要按 Android native 语义执行，不是公开 JS 算法。
2. 现有实现依赖 `unidbg` 提供 Dalvik/JNI 环境与 native 函数绑定，Node.js 本身不具备等价运行时。
3. 当前成功依赖大量 Java 侧 stub/fallback（`Context`/`PackageManager`/`Signature`/`CH` 等）；这些语义在 Node 中需要重新实现一套 Android 行为模拟，成本高且脆弱。
4. `CH` helper 不只是 SHA/Base64，还包含设备 ID、时间字节、AES-GCM/AES-ECB 等调用约束，重写后极易出现细节偏差导致结果失真。
5. 运行稳定性依赖当前单线程执行模型（unidbg/unicorn 并发稳定性有限）；Node 重写不能自然消除该约束。
6. 该能力与 APK 版本和 native 依赖强耦合，后续升级仍需围绕 so/JNI 逆向与适配，而不是语言层简单替换。

结论：可用 Node.js 承载 HTTP/API 与编排层，但核心 `nmcs` 计算应继续由 Java + unidbg 执行。

## Operational Notes

- 默认端口：`19190`
- 初始化时默认目标 APK：`cache/phonepe/merged/com.phonepe.app_merged_signed.apk`
- 初始化时默认签名源 APK：`samples/PhonePe APK v24.08.23.apk`
- 默认运行时目录：`src/services/checksum/runtime`
- `yarn checksum:test` 会在服务未启动时自动拉起服务，再做健康检查和结构校验
- 后续默认运行模式会优先从 `src/services/checksum/runtime/` 读取已准备好的依赖文件
