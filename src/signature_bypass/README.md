# Android APK 签名绕过模块 (Java 源码版)

这是一个用于绕过 Android APK 签名校验的模块，完全使用 **Java 源码** 编写，当前由 orchestrator 负责构建、注入和整包测试。

## 特点

- **纯 Java 实现** - 所有代码都是 Java 源码，不依赖任何预编译的 smali 文件
- **自动化编译** - 构建本地 artifact 供 orchestrator 复用
- **依赖 Pine 框架** - 直接使用仓库内固定依赖

## 目录结构

```
signature_bypass_src/
├── README.md                           # 本文档
├── build.gradle                        # Gradle 构建配置（可选）
├── src/main/java/com/sigbypass/
│   ├── SignatureConfig.java           # 签名配置（修改签名在这里）
│   ├── ReflectUtils.java              # 反射工具类
│   ├── SignatureHook.java             # 签名 Hook 核心逻辑
│   └── HookEntry.java                 # 入口类
├── tools/
│   ├── build_artifacts.sh             # orchestrator builder 入口
│   └── compile.sh                     # 实际编译逻辑
├── scripts/
│   └── inject.sh                      # orchestrator injector 入口
├── libs/                              # 依赖库（自动下载）
│   ├── pine-core.aar                  # Pine 框架 AAR
│   ├── pine-core-classes.jar          # Pine 框架 JAR
│   ├── baksmali.jar                   # Smali 反编译工具
│   └── jni/                           # Native 库
│       ├── arm64-v8a/libpine.so
│       └── armeabi-v7a/libpine.so
└── build/                             # 编译输出
    ├── classes.dex                    # 签名绕过 DEX
    ├── smali/                         # 签名绕过 Smali
    │   └── com/sigbypass/*.smali
    └── pine_smali/                    # Pine 框架 Smali
        └── top/canyie/pine/*.smali
```

## 快速开始

### 1. 修改签名配置（如需要）

编辑 `src/main/java/com/sigbypass/SignatureConfig.java`：

```java
// 修改目标包名（如需支持其他应用）
public static final String TARGET_PACKAGE = "com.phonepe.app";

// 修改原始签名（使用目标应用的原始签名）
public static final String ORIGINAL_SIGNATURE = "3082...";
```

### 2. 构建 artifact

```bash
./tools/build_artifacts.sh
```

输出：
```
✓ 编译成功!

生成的文件:
  - build/classes.dex           (签名绕过 DEX)
  - build/smali/                (签名绕过 Smali)
  - build/pine_smali/           (Pine 框架 Smali)
  - libs/jni/arm64-v8a/         (Native 库)
```

### 3. 通过 orchestrator 注入并测试

```bash
python3 src/build-orchestrator/orchestrator.py test --profile sigbypass-only --smoke --serial emulator-5554
```

## 验证

启动应用后检查日志：

```bash
adb logcat -s SigBypass
```

预期输出：
```
I SigBypass: Initializing signature bypass...
D SigBypass: Pine configured
I SigBypass: Pine initialized successfully
I SigBypass: Signature hook installed successfully
I SigBypass: Signature bypass initialized for: com.phonepe.app
I SigBypass: Hooked GET_SIGNATURES for com.phonepe.app
```

## 工作原理

### 签名校验机制

Android 应用通常通过以下方式检查签名：

```java
// 方式 1: GET_SIGNATURES (旧版 API)
PackageInfo info = pm.getPackageInfo(packageName, PackageManager.GET_SIGNATURES);
Signature[] signatures = info.signatures;

// 方式 2: GET_SIGNING_CERTIFICATES (Android P+)
PackageInfo info = pm.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES);
Signature[] signers = info.signingInfo.getApkContentsSigners();
```

### 绕过方法

使用 [Pine](https://github.com/canyie/pine) Hook 框架，Hook `ApplicationPackageManager.getPackageInfo()` 方法：

1. 在方法返回后（`afterCall`）拦截结果
2. 检查请求的 flags（64 或 0x8000000）
3. 如果是目标包名，将签名替换为原始签名
4. 返回修改后的结果

### 代码流程

```
应用启动
    ↓
PhonePeApplication.attachBaseContext()
    ↓
HookEntry.init(context)         ← 我们注入的入口
    ↓
Pine.ensureInitialized()        ← 初始化 Hook 框架
    ↓
SignatureHook.install()         ← 安装签名 Hook
    ↓
应用调用 getPackageInfo()
    ↓
SignatureMethodHook.afterCall() ← 拦截并替换签名
    ↓
应用获得"原始"签名，校验通过
```

## 源码说明

### SignatureConfig.java

配置文件，包含：
- `TARGET_PACKAGE`: 目标应用包名
- `ORIGINAL_SIGNATURE`: 原始 APK 签名
- `DEBUG`: 是否启用调试日志

### HookEntry.java

入口类，负责：
- 配置 Pine 框架
- 初始化 Pine
- 调用 SignatureHook.install()

### SignatureHook.java

核心 Hook 类，负责：
- 查找 getPackageInfo 方法
- 安装 MethodHook
- 在 afterCall 中替换签名

### ReflectUtils.java

反射工具类，提供：
- findMethod(): 查找方法
- logDebug/logInfo(): 日志输出

## 运行方式

- 推荐命令：
  - `python3 src/build-orchestrator/orchestrator.py build-modules --profile sigbypass-only`
  - `python3 src/build-orchestrator/orchestrator.py test --profile sigbypass-only --smoke --serial emulator-5554`
- `scripts/inject.sh` 现在只消费 `--artifact-dir`，不再在注入阶段隐式编译。

## 自定义修改

### 添加新的 Hook

在 `SignatureHook.java` 或新文件中添加：

```java
public static boolean installCustomHook() {
    Method method = ReflectUtils.findMethod("com.example.Class", "method", String.class);
    if (method == null) return false;

    Pine.hook(method, new MethodHook() {
        @Override
        public void afterCall(Pine.CallFrame callFrame) {
            // 自定义逻辑
        }
    });
    return true;
}
```

然后在 `HookEntry.init()` 中调用。

### 支持多个应用

修改 `SignatureHook.java` 中的 `isTargetPackage()`：

```java
private boolean isTargetPackage(String packageName) {
    return "com.app1".equals(packageName)
        || "com.app2".equals(packageName);
}
```

## 依赖

- **Java JDK 8+**: 编译 Java 代码
- **Android SDK**: d8, android.jar
- **Pine 框架**: 自动从 Maven Central 下载
- **baksmali**: 自动下载

## 故障排除

### 编译失败

检查环境：
```bash
javac -version          # 需要 JDK 8+
echo $ANDROID_HOME      # 需要设置 Android SDK 路径
ls $ANDROID_HOME/build-tools/*/d8  # 需要 d8 工具
```

### Hook 不生效

1. 检查日志：`adb logcat -s SigBypass Pine`
2. 确认 libpine.so 已复制
3. 确认入口代码已注入

### 应用崩溃

查看崩溃日志：
```bash
adb logcat | grep -E "FATAL|AndroidRuntime"
```

## 测试结果

在 PhonePe 应用上测试成功：
- ✓ Pine 框架初始化成功
- ✓ 签名 Hook 安装成功
- ✓ 签名 Hook 触发 10+ 次
- ✓ 应用正常运行

## 参考资料

- [Pine Hook 框架](https://github.com/canyie/pine)
- [Pine Maven 仓库](https://repo1.maven.org/maven2/top/canyie/pine/)
- [baksmali](https://github.com/JesusFreke/smali)

## 版本历史

- **v1.0** (2026-01-29): 初始版本，纯 Java 实现签名绕过

## 许可证

仅供安全研究和学习使用。
