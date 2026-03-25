# Scheme3 Checksum Service Solution

Date: 2026-03-25
Target: `src/research/unidbg_checksum_poc`

## Goal

把方案 3 从“研究用 unidbg probe”收敛成一个可重复调用的本地 checksum 服务，并给出明确的成功判据与可执行验证方式。

## Final Result

方案 3 现在已经具备两层能力：

1. `unidbg` 可以稳定调用 `EncryptionUtils.nmcs(...)`
2. 已封装为本地 HTTP 服务，可通过 `POST /checksum` 调用
3. 已拆成“初始化 APK 依赖”和“日常运行 runtime”两阶段

默认服务地址：

- `127.0.0.1:19190`

默认成功标准不再要求与真实 app 进程 checksum 完全一致，而是要求输出满足“结构成功”：

- 输出是合法 Base64
- checksum 长度处于同类区间
- Base64 解码后是 ASCII 风格 token 串
- 解码结构长度与样例/当前成功样本接近

## 问题是怎么一步步定位出来的

### 1. 先确认不是选错了库

最开始的怀疑点是：`nmcs` 调用失败是不是因为选错了 native 库。

实际验证结果：

- `libphonepe-cryptography-support-lib.so` 是真实 ELF
- `EncryptionUtils.nmcs` 能在 unidbg 里直接调用
- `liba41935.so` 并不是当前 `nmcs` 的直接落点

这一步确认了问题不在“入口找错”，而在“调用进了 native 之后缺少真实运行时语义”。

### 2. 识别出旧结果是假 checksum

早期 probe 虽然能返回非空字符串，但有几个明显问题：

- 输出只有 48 字节，明显太短
- 相同输入多次调用结果完全相同
- `path/body` 改动几乎不影响结果
- 输出中带模板拼接痕迹

后续加了 probe 命中统计后，确认这条路径严重依赖：

- Android/JNI stub
- `CH->*` fallback

再进一步验证：

- `PROBE_CH_MODE=disable` 时，`nmcs` 直接返回 `null`
- `PROBE_CH_MODE=empty` 时，也会失败

这说明那条 48 字节结果不是 native 真实完成的 checksum，而是 fallback 伪产物。

### 3. 锁定真正的差异点

静态和动态分析后，差异点主要集中在两类依赖：

- Java 侧 `CH` 工具方法
- 运行时状态：
  - 包签名
  - 设备 ID
  - 时间源

其中 `CH` 是最关键的拦路点，因为 `nmcs -> newChecksumSecure(...)` 后马上就会依赖这些 helper。

## 最终用了哪些技术

### 1. unidbg

用途：

- 在桌面环境直接加载 Android native 库
- 构造 Dalvik VM 和 JNI 调用环境
- 直接执行 `EncryptionUtils.nmcs`

作用：

- 让 checksum 生成不再依赖真实 App 进程
- 可以在本地以脚本/服务方式重复调用

### 2. JNI stub / Android runtime stub

用途：

- 给 native 层补上最基本的 Android 对象访问链路

典型补位点：

- `Context->getPackageManager()`
- `Context->getPackageName()`
- `PackageManager->getPackageInfo(...)`
- `PackageInfo->signatures`
- `Signature->toByteArray()`

原理：

native 层通过 JNI 访问 Java 对象；如果这些对象链路不存在，调用会直接崩或返回空。

### 3. `CH` helper 仿真

实现位置：

- [ChEmulation.java](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/research/unidbg_checksum_poc/src/main/java/com/navpay/phonepe/unidbg/ChEmulation.java)

覆盖的方法包括：

- `ba` -> SHA-1
- `b` -> SHA-256
- `crb` -> Base64.encode
- `fd` -> deviceId bytes
- `ebr` -> currentTime bytes
- `as` -> AES/GCM/NoPadding
- `a` -> AES/ECB/PKCS5Padding

原理：

`CH` 本质上是 Java 侧密码/编码工具集。只要这些 helper 的行为严重偏离真实实现，native 最终拼出来的 checksum 结构就会失真。

### 4. 真实 APK 证书提取

实现位置：

- [ApkSignatureExtractor.java](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/research/unidbg_checksum_poc/src/main/java/com/navpay/phonepe/unidbg/ApkSignatureExtractor.java)

用途：

- 从 `patched_signed.apk` 中提取真实证书字节
- 让 `Signature->toByteArray()` 返回真实签名字节，而不是假 stub

原理：

native 链路里会读取包签名；如果签名字节是假的，最终结果也会产生结构偏移甚至直接退化。

现在这一步不再要求每次启动时读取 APK，而是在初始化阶段把证书提取到 `src/services/checksum/runtime/signature.bin`。

### 5. ADB 辅助注入设备 ID

用途：

- 如果本机有可用设备，自动读取 `android_id`
- 把它作为 `PROBE_DEVICE_ID`

原理：

真实链路依赖设备标识；把完全固定的假设备 ID 换成真实设备/模拟器 ID，可以让输出更接近真实分布。

### 6. Java 内置 HTTP 服务

实现位置：

- [ChecksumHttpService.java](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/research/unidbg_checksum_poc/src/main/java/com/navpay/phonepe/unidbg/ChecksumHttpService.java)

技术：

- `com.sun.net.httpserver.HttpServer`

用途：

- 将 unidbg checksum 结果直接封装成 HTTP 接口
- 降低使用成本，不需要每次手动跑命令和解析输出

## 关键原理

### 原理 1：为什么方案 3 之前失败

因为 native 算法并不是一个“只喂 path/body/uuid 就能纯函数返回”的逻辑。

它还依赖：

- Java 层 helper
- 设备标识
- 当前时间
- 包签名

早期 probe 虽然能进到 native，但这些外围语义是假的，所以返回结果只是“跑通了控制流”，不是“完成了正确的 checksum 结构生成”。

### 原理 2：为什么现在可以认定成功

因为当前标准已经切换成“结构成功”，而不是“与真实 app 完全同值”。

当前默认输出已经满足：

- 长度稳定在 `184`
- 解码长度稳定在 `138`
- 解码后是 ASCII 风格 token 串
- 输出为合法 Base64

这说明：

- native 主链路已经在真实执行
- Java helper 仿真已经足够把结果拉回正确结构族

### 原理 3：为什么还不能说完全复刻真实 checksum

因为仍存在这些差异：

- 时间源仍是本地近似
- 设备 ID 仍是桌面/ADB 注入语义
- Android 运行时环境仍是 stub，不是真机进程

所以它已经是“结构正确、可服务化”的 checksum 生成器，但不是“与 PhonePe 生产环境完全一致”的复制品。

## 服务接口

### `GET /health`

用途：

- 检查服务是否已启动

示例：

```bash
curl -sS http://127.0.0.1:19190/health
```

### `POST /checksum`

用途：

- 生成一个结构成功的 checksum

示例：

```bash
curl -sS http://127.0.0.1:19190/checksum \
  -H 'Content-Type: application/json' \
  -d '{"path":"/apis/tstore/v2/units/changes","body":"","uuid":"8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001"}'
```

返回字段：

- `checksum`
- `length`
- `decodedLength`
- `mode`
- `structureOk`
- `decodedPreview`

### `POST /validate`

用途：

- 对当前输出做结构校验
- 可附带样例 checksum 做长度差比较

## 如何验证服务成功

### 方式 1：直接跑脚本

```bash
yarn checksum:test
```

成功标志：

- 脚本最后输出 `PASS`

### 方式 2：手动验证

1. 启动服务

```bash
src/research/unidbg_checksum_poc/scripts/start_http_service.sh
```

2. 检查健康状态

```bash
curl -sS http://127.0.0.1:19190/health
```

3. 调用 checksum

```bash
curl -sS http://127.0.0.1:19190/checksum \
  -H 'Content-Type: application/json' \
  -d '{"path":"/apis/tstore/v2/units/changes","body":"","uuid":"8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001"}'
```

4. 看返回值里：

- `ok=true`
- `structureOk=true`
- `length` 在 `160-220`
- `decodedLength` 在 `120-180`

### 方式 3：带样例做比较

```bash
curl -sS http://127.0.0.1:19190/validate \
  -H 'Content-Type: application/json' \
  -d '{"path":"/apis/tstore/v2/units/changes","body":"","uuid":"8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001","exampleChecksum":"MmFjODQyUWEyNjRkWWovSS02NDhtRzRuMy00ZEZ1Nnh5M2FkYjVIVld2ZHVoVWRzd0FMeGlNdnZQWVZUVTZCb1Q4WFMzRldvOFpYL1lYZVg4ejVneURMUVdacWZOTFZSSWlRK1ZEUEE9PXROQ2NYVzc2Y0tTMWl5Y3JtS3pENjVNNjhnd0Y4SVd4aVlvZXFlaHhlcw=="}'
```

看这些字段：

- `structureOk=true`
- `lengthDelta`
- `decodedLengthDelta`

## 当前结论

方案 3 已经从“研究 PoC”升级成了“可 HTTP 调用的 checksum 结构生成服务”。

它当前适合：

- 本地调试
- 接口联调
- 自动化脚本调用
- 结构级 checksum 验证

它当前不承诺：

- 与真实 App 进程 checksum 完全一致
- 用于严格生产复刻验证
