根本原因分析

  问题出在 AndroidManifest.xml 第 2 行：

  android:requiredSplitTypes="base__abi,base__density"

  这表明该 APK 是 Android App Bundle (AAB) 的 Split APK，它依赖以下分包：
  ┌───────────────┬────────────────────────────────────────────────────────┐
  │  Split 类型   │                          说明                          │
  ├───────────────┼────────────────────────────────────────────────────────┤
  │ base__abi     │ 原生库分包（针对 CPU 架构：arm64-v8a, armeabi-v7a 等） │
  ├───────────────┼────────────────────────────────────────────────────────┤
  │ base__density │ 资源分包（针对屏幕密度：hdpi, xhdpi, xxhdpi 等）       │
  └───────────────┴────────────────────────────────────────────────────────┘
  原因说明

  从 2021 年开始，Google Play 要求新应用使用 AAB (Android App Bundle) 格式发布。AAB 会根据设备自动生成定制的 Split APKs：

  PhonePe.aab
      ├── base.apk           ← 你下载的这个
      ├── split_config.arm64_v8a.apk    ← 缺失
      ├── split_config.xxhdpi.apk       ← 缺失
      └── ...

  你下载的只是 base.apk，缺少了必需的 Split APKs。

  ---
  解决方案

  方案 1: 使用 APKMirror 下载完整 APKS/XAPK（推荐）

  从 https://www.apkmirror.com/apk/phonepe-private-limited/phonepe/ 下载 APKS 或 XAPK 格式，它包含所有 Split APKs。

  使用 SAI (Split APKs Installer) 或 APKMirror Installer 安装：

  # 如果是 APKS 格式，解压后使用 adb 安装
  unzip PhonePe_v24.08.23.apks -d phonepe_splits/
  adb install-multiple phonepe_splits/*.apk

  方案 2: 使用 bundletool 从设备提取完整 APK

  如果你有一台已安装 PhonePe 的设备：

  # 安装 bundletool
  brew install bundletool

  # 从设备提取 APKs
  bundletool extract-apks \
      --apks=device.apks \
      --device-spec=device-spec.json \
      --output-dir=extracted/

  方案 3: 修改 APK 移除 Split 依赖（仅供研究）

  可以修改 AndroidManifest.xml 移除 requiredSplitTypes 属性，但这会导致：
  - 缺少原生库 → 应用崩溃
  - 缺少资源 → 显示异常

  cd phonepe_original_apktool

  # 编辑 AndroidManifest.xml，删除 requiredSplitTypes 属性
  # 然后重新打包
  apktool b . -o phonepe_nosplit.apk

  # 签名（需要自签名，会破坏原始签名）

  注意：这种方法通常无法正常运行，因为关键的 native libraries 可能在 split 中。

  方案 4: 使用 Google Play 直接安装

  使用 adb 配合 Play Store：

  # 查看包名
  adb shell pm path com.phonepe.app

  # 如果已安装，会显示所有 split 路径
  # package:/data/app/~~xxx==/com.phonepe.app-xxx==/base.apk
  # package:/data/app/~~xxx==/com.phonepe.app-xxx==/split_config.arm64_v8a.apk
  # package:/data/app/~~xxx==/com.phonepe.app-xxx==/split_config.xxhdpi.apk

  ---
  pev70 为什么能安装？

  让我检查 pev70 的 manifest：

⏺ Read 1 file (ctrl+o to expand)

⏺ 关键发现：pev70 的 AndroidManifest.xml 没有 requiredSplitTypes 属性！

  这说明攻击者：
  1. 使用完整版 APK（从已安装设备提取）或合并了所有 splits
  2. 移除了 split 依赖声明
  3. 将所有 native libraries 和资源打包到单个 APK 中

⏺ Bash(ls -la pev70_apktool/lib/ 2>/dev/null && echo "---" && ls -la phonepe_original_apktool/lib/ 2>/dev/null || echo
      "phonepe_original has no lib folder")
  ⎿  total 0
     drwxr-xr-x   3 danielscai  staff    96  1月 28 00:38 .
     drwxr-xr-x@ 24 danielscai  staff   768  1月 28 00:38 ..
     … +3 lines (ctrl+o to expand)

⏺ 验证结论：
  ┌────────────────────┬─────────────────────────┬────────────────┐
  │        属性        │   原始 APK (base.apk)   │     pev70      │
  ├────────────────────┼─────────────────────────┼────────────────┤
  │ requiredSplitTypes │ base__abi,base__density │ 无             │
  ├────────────────────┼─────────────────────────┼────────────────┤
  │ lib/ 目录          │ 无 (在 split 中)        │ 有 (arm64-v8a) │
  ├────────────────────┼─────────────────────────┼────────────────┤
  │ 可直接安装         │ 否                      │ 是             │
  └────────────────────┴─────────────────────────┴────────────────┘
  攻击者使用的是从设备提取的完整 APK，或者使用工具将 AAB 转换为完整的单体 APK。

  ---
  推荐方案

  如果你只是为了对比研究，可以直接使用 apktool 反编译后的目录进行分析，不需要实际安装原始 APK。smali 对比分析不受此影响。

  如果确实需要运行原始 APK，建议：
  1. 从 APKMirror 下载 APKS 格式
  2. 或从已安装 PhonePe 的设备使用 adb 提取完整 APK set
