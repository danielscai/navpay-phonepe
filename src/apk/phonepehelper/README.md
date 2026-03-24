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
python3 src/pipeline/orch/orchestrator.py test --profile phonepehelper-only --smoke --serial emulator-5554
```

`scripts/merge.sh` 现在只消费 `--artifact-dir`，由 orchestrator 在构建阶段提前准备产物。

## 验证

```bash
adb logcat -s PPHelper
```

预期日志：
- `PhonePeHelper.init ok`
- `Lifecycle logger registered`
- `PhonePeHelper initialized`
- Activity 生命周期日志（created/started/resumed...）

## 推荐入口

```bash
yarn flow:test:phonepehelper
```
