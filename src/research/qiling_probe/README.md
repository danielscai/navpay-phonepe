# qiling probe

目标：验证当前机器+当前仓库下，Qiling 是否能替代方案 3，至少跑到 `nmcs` 相关调用链的可观测点。

## 结论

- Qiling 本体可以安装并导入。
- 但当前 macOS arm64 环境下，Qiling 1.4.6 没有 Android 运行时枚举，实际只能走 `QL_OS.LINUX + QL_ARCH.ARM64` 的 ELF 装载路径。
- 目标 `libe755b7.so` 能被 Qiling 加载，`JNI_OnLoad` 也能进入。
- 目前没有 `nmcs` 直接导出符号，也没有在这条最小链路里拿到 `nmcs` 已进入的直接证据。
- 所以结论是：**暂不可行**，原因不是 Qiling 完全不可用，而是它在当前环境里只能推进到 obfuscated `JNI_OnLoad`/内部 helper loop，无法直接确认 `nmcs` 链路。

## 我跑过的命令

### 1) 依赖和环境检查

```bash
python3 - <<'PY'
import sys, platform
print('python', sys.version)
print('platform', platform.platform())
try:
    import qiling
    print('qiling_import=OK')
except Exception as e:
    print('qiling_import=FAIL', type(e).__name__, e)
PY
```

```bash
python3 - <<'PY'
for m in ['unicorn', 'capstone', 'keystone']:
    try:
        mod = __import__(m)
        print(m, 'OK', mod.__file__)
    except Exception as e:
        print(m, 'FAIL', type(e).__name__, e)
PY
```

### 2) keystone 原生依赖修复

我额外验证了 `keystone-engine` 的源码构建，发现它默认构建会被旧 CMake 选项卡住。
通过临时源码树补齐：

- `cmake`
- `PYTHON_EXECUTABLE`
- `CMP0051`

之后才产出了 `libkeystone.dylib`，Qiling 的 `ARM64` 后端才可以初始化。

### 3) Qiling 最小载入

```bash
PYTHONPATH=/tmp/keystone_build/keystone-engine-0.9.2/build/lib \
python3 src/research/qiling_probe/probe.py \
  --apk samples/pev70.apk \
  --keystone-path /tmp/keystone_build/keystone-engine-0.9.2/build/lib
```

## 观察到的关键事实

- `lib/arm64-v8a/libe755b7.so` 是有效的 aarch64 ELF，导出了 `JNI_OnLoad`。
- `lib/arm64-v8a/libphonepe-cryptography-support-lib.so` 从 APK 中直接抽出来是 `data`，不能当 ELF 直接加载。
- Qiling 1.4.6 的 `QL_OS` 枚举里没有 `ANDROID`。
- 在 Qiling 中，`libe755b7.so` 可以初始化，`JNI_OnLoad` 的执行也能推进到内部 helper loop。
- 但 `nmcs` 没有直接符号可见，且当前最小执行链路没有把 `nmcs` 作为可观测结果暴露出来。

## 判定标准

- `qiling_import=OK` 且 `qiling_init=OK`：Qiling 环境可用。
- `jni_hits > 0`：成功进入 `JNI_OnLoad` 调用链。
- `dynsym_has_nmcs=FALSE` 且执行结果里没有直接 `nmcs` 证据：**不能确认已进入 `nmcs` 调用链**。

