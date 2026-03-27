# 19190 Checksum 独立链路问题分析与多方案修复实验

Date: 2026-03-27
Scope: `src/services/checksum`

## 1. 目标与验收标准

按最新约束：

- `19090` 与 `19190` 是替换关系，`19190` 不能依赖 `19090` 或任何外部 checksum 服务。
- 验收标准是端到端 replay：
  1. 用目标端口生成 checksum
  2. 注入重放请求头
  3. 请求真实目标服务器
  4. 返回 `HTTP 200` 才算通过

该标准已同步到：

- `docs/checksum_service_integration.md` -> `## 端到端验收标准（Replay）`

## 2. 当前代码路径（19190）

关键路径：

1. `ChecksumHttpService` 接收 `POST /checksum`
2. `parseJsonBody` 解析 `path/body/uuid`
3. `runProbe` 调 `UnidbgChecksumProbe.execute(...)`
4. `UnidbgChecksumProbe.probeChecksum` 调 JNI 签名：
   - `EncryptionUtils.nmcs([B[B[BLjava/lang/Object;)[B`
5. 返回 checksum 给调用方

关键文件：

- `src/services/checksum/src/main/java/com/navpay/phonepe/unidbg/ChecksumHttpService.java`
- `src/services/checksum/src/main/java/com/navpay/phonepe/unidbg/UnidbgChecksumProbe.java`
- `src/services/checksum/src/main/java/com/navpay/phonepe/unidbg/ChEmulation.java`

## 3. 发现的问题

早期在 logId=654 的真实样本上：

- 使用 `19090` 生成 checksum replay => `HTTP 200`
- 使用 `19190`（独立 emulate）生成 checksum replay => `HTTP 400`

说明：

- `19190` 的 checksum 结构是“看起来正常”的（Base64、长度区间等）
- 但业务语义不被目标服务接受（语义错配）

2026-03-27 对真实 V4 样本 `id=1226` 做端到端 replay 验证，最终确认：

- 请求：`POST /apis/tstore/v2/units/changes?...`
- 头：`X-REQUEST-CHECKSUM-V4`
- 以真实目标服务器返回码为验收标准

关键结果分两阶段：

1. 修复前：
   - 原始旧 checksum replay：`HTTP 400`
   - `19090` 新 checksum replay：`HTTP 200`
   - `19190` 新 checksum replay：`HTTP 400`
2. 修复后：
   - `19090` 新 checksum replay：`HTTP 200`
   - `19190` 新 checksum replay：`HTTP 200`

确认结论：

1. 这条当前 V4 链路的有效 `path` 输入应是不带 query 的 `encodedPath`
2. `19190` 的最终根因不是 query 规则，也不是 `nmcs` 主调用链缺失
3. 最终根因是 runtime 初始化把 `signature.bin` 错误地取自 merged debug APK

## 4. 已尝试的修复方案与结果

### 方案 A：修复 HTTP JSON 反转义

改动：

- `ChecksumHttpService.unescapeJson` 支持标准 JSON 转义：`\uXXXX`、`\/`、`\t`、`\b`、`\f` 等。
- 新增回归测试 `ChecksumHttpServiceJsonParsingTest`。

结果：

- 单测通过。
- 解决了输入解析偏差问题。
- 但独立 `19190` replay 仍 `400`。

结论：

- 这是必要修复，但不是最终根因。

### 方案 B：legacy 兼容回退（已撤销）

改动（已回滚）：

- `19190` 优先调用 `19090` 取 checksum，失败再回退 unidbg。

结果：

- replay 可到 `200`。
- 但违反“独立服务、不可依赖外部服务”的要求。

结论：

- 该方案技术上有效，但不符合架构约束，已撤销。

### 方案 C：调整 unidbg 运行参数

尝试矩阵：

- `PROBE_LOAD_ORDER`: `e755b7-first` / `libcxx-first`
- `PROBE_LOAD_LIBCXX`: `true` / `false`

结果：

- 全部组合 replay 仍 `400`。

结论：

- 不是 library load order 问题。

### 方案 D：注入设备/时间参数

尝试矩阵：

- `PROBE_DEVICE_ID` = `sourceClientDeviceId`
- `PROBE_DEVICE_ID` = `appContext.deviceId`
- `PROBE_FIXED_TIME_MS` = `X-REQUEST-START-TIME`
- 以上组合交叉

结果：

- 全部组合 replay 仍 `400`。

结论：

- 不是简单 deviceId/time 取值问题。

补充更新（按原包语义修正后）：

- `19190` 已移除基于 `adb settings secure android_id` 的默认 deviceId 注入。
- 新增 `runtime_snapshot.json` 读取：
  - `deviceId` 来自原始 app `/debug/runtime`
  - 时间按 `System.currentTimeMillis() + serverTimeOffsetMs` 计算
- 新增 `runtime manifest -> sourceApk` 读取，DalvikVM 优先载入真实 `com.phonepe.app_merged_signed.apk`

验证结果：

- probe 报告确认：
  - `probe_device_id_source=runtime-snapshot`
  - `probe_time_ms_source=runtime-snapshot-offset`
  - `probe_vm_apk_source=<real apk path>`
- 但真实 V4 replay 仍是 `HTTP 400`

结论：

- 现在可以排除“business deviceId 未接入”“时间源仍是固定快照”“VM 未载入真实 APK”这几类问题。

### 方案 D2：补齐原始 `NativeLibraryLoader.h2()` 初始化

依据：

- 原包 `EncryptionUtils.jnmcs(...)` 在调用 `nmcs(...)` 之前，会执行
  `NativeLibraryLoader.Companion.a(context).b()`
- `b()` 内部会在装载 `phonepe-cryptography-support-lib` 后调用 native `h2()`
- 当前 runtime 库导出了 `Java_com_phonepe_util_NativeLibraryLoader_h2`

改动：

- 在 `UnidbgChecksumProbe` 里显式调用 `NativeLibraryLoader.h2()`
- 新增回归测试：`realFixtureInvokesNativeLoaderInitialization`

结果：

- 回归测试通过，确认 `19190` 现在已执行这段原始初始化链路
- 但对真实 V4 replay，`19190` 仍返回 `HTTP 400`

结论：

- `h2()` 初始化缺失确实是原链路偏差，已修正
- 但它不是唯一根因

### 方案 D3：恢复原始 `EncryptionUtils.jnmcs(context, ...)` 包装链

依据：

- `19090` helper 实际反射调用的是：
  - `com.phonepe.networkclient.rest.EncryptionUtils.jnmcs(Context, byte[], byte[], byte[], Object)`
- 这比 direct native `nmcs(...)` 更接近原包真实入口。

改动：

- `19190` probe 现在先尝试 `jnmcs(...)`，失败后再回退 direct `nmcs(...)`

验证结果：

- probe 报告：
  - `com.phonepe.networkclient.rest.EncryptionUtils.call_jnmcs=PASS`
  - `checksum_source=com/phonepe/networkclient/rest/EncryptionUtils#jnmcs`

结论：

- `19190` 已经可以走到原始 `jnmcs(context, ...)` 包装链
- 剩余问题应继续往 runtime 语义里收敛，而不是回到 direct native 入口猜测

### 方案 D4：核对 `Signature->toByteArray()` 的真实来源

观察到的矛盾：

- `19190 runtime/signature.bin` 的 SHA-256 是 `c57335...`
- 设备 `dumpsys package` 看到的 debug/repacked APK 证书也是 `c57335...`
- 但 `19090 /debug/runtime` 暴露的 `signatureSha256` 却是 `5335bc...`

进一步核对发现：

- `samples/PhonePe APK v24.08.23.apk` 的证书指纹正是 `5335bc...`

这说明：

- `19190` 之前把 merged debug APK 的签名身份喂给了 native
- 但原始业务语义要求的是原始 PhonePe APK 的签名身份

修复：

- runtime 初始化显式区分：
  - `sourceApk`：供 DalvikVM 载入 merged/repacked APK
  - `signatureSourceApk`：供 `signature.bin` 提取原始 PhonePe APK 证书
- 默认 `signatureSourceApk` 改为 `samples/PhonePe APK v24.08.23.apk`

修复后验证：

- `src/services/checksum/runtime/signature.bin` SHA-256 = `5335bc4961580b2e39cfe661355386636840686ad00b8dc16061d22236aa7d13`
- 真实 V4 replay：
  - `19090` => `HTTP 200`
  - `19190` => `HTTP 200`

### 方案 E：切换 native 调用签名（实验后回滚）

尝试：

- 将 `nmcs` 暂时替换为同参 `nmc` 进行对照。

结果：

- replay 仍 `400`。

结论：

- 不是单一签名选择错误。

## 5. 最终根因

最终根因是：

- `19190` runtime 初始化阶段把 `signature.bin` 错误地提取自 merged debug APK
- 导致 `PackageInfo.signatures[0].toByteArray()` 这条 JNI 语义返回了调试签名对应字节
- native `nmcs/jnmcs` 依赖该签名参与 checksum 计算
- 因此虽然 checksum 的结构正常，但业务语义不被服务器接受

## 6. 修复结论

独立 `19190` 现在已经满足验收标准：

- 不依赖 `19090`
- 走原始 `EncryptionUtils.jnmcs(context, ...)` 包装链
- 使用原始 PhonePe APK 证书字节作为 `signature.bin`
- 对真实 V4 replay 返回 `HTTP 200`

- `19190` 已恢复为独立实现（无 external checksum 依赖）。
- 结构级测试通过，但端到端 replay 验收未通过（`HTTP 400`）。
- 多个修复方向已验证并排除，根因高概率在 CH 仿真语义层。
