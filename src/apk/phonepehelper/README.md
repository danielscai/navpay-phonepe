# PhonePeHelper (Research Stub)

该模块用于复现 pev70 的 `PhonePeHelper` 行为链路，但以“安全可控”的方式实现（本地日志 + 本地存储），便于在原版 PhonePe 中注入验证。
本模块不负责 Application 注入与 Pine 初始化，统一由主注入模块（例如 signature_bypass）完成。
因此请先完成主入口注入，再执行本模块注入。

## 能力范围（简化复现）

- Token 存取与对比（1fa/sso/auth/accounts）
- 设备指纹与手机号缓存
- UPI / 请求元数据 JSON 组装
- MPIN 记录（仅长度日志）
- 5 秒定时器触发同步逻辑（本地日志）
- 固定周期强制上传 snapshot（默认 1 小时，避免“仅变更触发”导致后台长期不更新）
- Activity 生命周期日志（用于确认注入生效）

## 目录结构

```
phonepehelper/
├── README.md
├── scripts/
│   ├── compile.sh
│   └── merge.sh
└── src/main/java/
    ├── com/phonepehelper/ModuleInit.java
    ├── com/phonepehelper/LifecycleLogger.java
    └── com/PhonePeTweak/Def/PhonePeHelper.java
```

## 构建 artifact

```bash
cd src/apk/phonepehelper
./scripts/compile.sh
```

输出：
- `build/classes.dex`
- `build/smali/` (PhonePeHelper smali)

## 注入与测试

```bash
yarn test
```

按仓库既定流程，`yarn test` 会执行编译、合并、打包、安装与拉起验证；不删除原 APK 包。

## 验证

```bash
adb logcat -s PPHelper
```

预期日志：
- `PhonePeHelper.init ok`
- `Lifecycle logger registered`
- `token snapshot: 1fa=...`
- `request-meta built: ...`
- `monitor tick: ...`
- `PhonePeHelper initialized`
- Activity 生命周期日志（created/started/resumed...）

## Snapshot Upload

- 上传地址（自动选择）：
  - 模拟器优先：`http://10.0.2.2:3000/api/intercept/phonepe/snapshot`
  - 真机优先：`http://127.0.0.1:3000/api/intercept/phonepe/snapshot`（配合 `adb reverse tcp:3000 tcp:3000`）
- 可通过 JVM 属性覆盖地址：`-Dnavpay.snapshot.endpoint=<url>`
- 可通过 JVM 属性覆盖强制上传频率（毫秒）：`-Dnavpay.snapshot.force_interval_ms=<ms>`
  - 默认：`3600000`
  - 最小：`5000`（低于该值会自动钳制）
- 上传内容：`{ androidId, payload }`
- `payload` 由 `PhonePeHelper.buildSnapshotForNavpay()` 构建，包含请求元数据和本地采集快照

## 推荐入口

```bash
yarn test
```
