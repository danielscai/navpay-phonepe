# X-REQUEST-CHECKSUM-V4 生成分析

## 结论概览
- **checksum 不依赖 query 参数**（如 `fromTimestamp`、`size`）。
- checksum 由 **encodedPath + body + UUID + native 内部状态** 生成。
- 具体算法在 native 库 `phonepe-cryptography-support-lib` 中，**可能包含时间窗/设备密钥**，导致旧 checksum 过期。

## 关键代码位置
### 1) 请求拦截器生成 checksum
路径：
`decompiled/phonepe_original_jadx/sources/com/phonepe/network/external/rest/interceptors/c.java`

关键逻辑（简化）：
- `encodedPath = request.url().encodedPath()`（注意：不含 query）
- `bodyBytes = requestBody`（此接口为空）
- `uuid = UUID.randomUUID().toString()`
- `EncryptionUtils.jnmcs(context, pathBytes, bodyBytes, uuidBytes, context)`
- 返回值写入 `X-REQUEST-CHECKSUM-V4`

### 2) Native 入口
路径：
`decompiled/phonepe_original_jadx/sources/com/phonepe/networkclient/rest/EncryptionUtils.java`

- `jnmcs(...)` -> `nmcs(...)`（native 方法）
- native 库：`phonepe-cryptography-support-lib`

## 推断
- 由于 **encodedPath 不含 query**，所以 `fromTimestamp`/`size` 变化不会影响 checksum。
- 旧 checksum 失效说明 native 层可能引入：
  - **时间窗**（内部时间戳校验）
  - **设备指纹/密钥**（与运行时环境绑定）
  - **随机挑战值**（不可见参数）

## 推荐验证方式（动态 hook）
目标：抓取 `nmcs` 输入与输出，确认是否包含时间/设备因子。

建议使用 Frida hook：
- 入口类：`com.phonepe.networkclient.rest.EncryptionUtils`
- 目标方法：`nmcs(byte[] a, byte[] b, byte[] c, Object obj)`

模板脚本见：
- `tools/frida_hook_checksum.js`

## 相关文件
- `decompiled/phonepe_original_jadx/sources/com/phonepe/network/external/rest/interceptors/c.java`
- `decompiled/phonepe_original_jadx/sources/com/phonepe/networkclient/rest/EncryptionUtils.java`
