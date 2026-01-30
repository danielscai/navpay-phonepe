# Android Split APK 合并为单体 APK 指南

> 本文档记录了将 Android App Bundle (AAB) 生成的 Split APKs 合并为单个可安装 APK 的完整流程
> 创建时间：2026-01-29

---

## 目录

1. [背景知识](#1-背景知识)
2. [环境准备](#2-环境准备)
3. [从设备提取 APK](#3-从设备提取-apk)
4. [合并 Split APKs](#4-合并-split-apks)
5. [常见问题及解决方案](#5-常见问题及解决方案)
6. [自动化脚本](#6-自动化脚本)

---

## 1. 背景知识

### 什么是 Split APK？

从 2021 年开始，Google Play 要求新应用使用 **Android App Bundle (AAB)** 格式发布。AAB 会根据设备自动生成定制的 Split APKs：

```
应用安装结构:
├── base.apk                      # 主 APK（代码、基础资源）
├── split_config.arm64_v8a.apk    # Native 库（针对 CPU 架构）
├── split_config.xxhdpi.apk       # 资源（针对屏幕密度）
└── split_config.zh.apk           # 语言资源（可选）
```

### 为什么需要合并？

- **研究分析**：单体 APK 更容易反编译和分析
- **离线分发**：单个文件便于传输和备份
- **兼容性**：某些工具只支持单体 APK

### 合并后的影响

| 方面 | 影响 |
|------|------|
| **签名** | ❌ 原始签名失效，需要重新签名 |
| **文件大小** | 📦 略有变化（压缩率不同） |
| **功能** | ✅ 正常运行（如正确合并） |
| **更新** | ❌ 无法通过 Play Store 更新 |

---

## 2. 环境准备

### 必需工具

```bash
# 1. Android SDK Platform Tools (adb)
# 通常位于: ~/Library/Android/sdk/platform-tools/

# 2. Android SDK Build Tools (zipalign, apksigner)
# 通常位于: ~/Library/Android/sdk/build-tools/35.0.0/

# 3. apktool (反编译/重打包)
brew install apktool

# 4. Java Runtime
brew install openjdk
```

### 验证环境

```bash
# 验证 adb
~/Library/Android/sdk/platform-tools/adb version

# 验证 apktool
apktool --version

# 验证 Java
java -version
```

---

## 3. 从设备提取 APK

### 3.1 连接设备

```bash
# 查看已连接设备
adb devices -l

# 输出示例:
# SM02G4061933188    device product:seeker model:Seeker    # 真机
# emulator-5554      device product:sdk_gphone64_arm64     # 模拟器
```

### 3.2 查找目标应用

```bash
# 列出已安装应用
adb shell pm list packages | grep <关键词>

# 示例: 查找 PhonePe
adb shell pm list packages | grep phonepe
# 输出: package:com.phonepe.app
```

### 3.3 获取 APK 路径

```bash
adb shell pm path com.phonepe.app

# 输出示例:
# package:/data/app/~~xxx==/com.phonepe.app-xxx==/base.apk
# package:/data/app/~~xxx==/com.phonepe.app-xxx==/split_config.arm64_v8a.apk
# package:/data/app/~~xxx==/com.phonepe.app-xxx==/split_config.xxhdpi.apk
```

### 3.4 提取 APK 文件

```bash
# 创建输出目录
mkdir -p ~/apk_extract

# 提取所有 APK（需要根据实际路径修改）
adb pull "/data/app/~~xxx==/com.phonepe.app-xxx==/base.apk" ~/apk_extract/
adb pull "/data/app/~~xxx==/com.phonepe.app-xxx==/split_config.arm64_v8a.apk" ~/apk_extract/
adb pull "/data/app/~~xxx==/com.phonepe.app-xxx==/split_config.xxhdpi.apk" ~/apk_extract/
```

---

## 4. 合并 Split APKs

### 4.1 反编译所有 APK

```bash
WORK_DIR=~/apk_merge
mkdir -p $WORK_DIR

# 反编译 base.apk
apktool d ~/apk_extract/base.apk -o $WORK_DIR/base_decompiled -f

# 反编译 split APKs
apktool d ~/apk_extract/split_config.arm64_v8a.apk -o $WORK_DIR/split_arm64 -f
apktool d ~/apk_extract/split_config.xxhdpi.apk -o $WORK_DIR/split_xxhdpi -f
```

### 4.2 合并 Native 库

```bash
# 创建 lib 目录并复制 .so 文件
mkdir -p $WORK_DIR/base_decompiled/lib/arm64-v8a
cp $WORK_DIR/split_arm64/lib/arm64-v8a/*.so $WORK_DIR/base_decompiled/lib/arm64-v8a/
```

### 4.3 修改 AndroidManifest.xml

需要修改三处：

```bash
MANIFEST=$WORK_DIR/base_decompiled/AndroidManifest.xml

# 1. 移除 requiredSplitTypes 属性
sed -i '' 's/ android:requiredSplitTypes="[^"]*"//g' $MANIFEST

# 2. 移除 splitTypes 属性
sed -i '' 's/ android:splitTypes="[^"]*"//g' $MANIFEST

# 3. 修改 extractNativeLibs 为 true
sed -i '' 's/android:extractNativeLibs="false"/android:extractNativeLibs="true"/g' $MANIFEST

# 4. 删除无效的 @null 引用（如果存在）
sed -i '' '/@null/d' $MANIFEST
```

### 4.4 重新打包

```bash
apktool b $WORK_DIR/base_decompiled -o $WORK_DIR/merged_unsigned.apk
```

### 4.5 对齐 APK

```bash
ZIPALIGN=~/Library/Android/sdk/build-tools/35.0.0/zipalign
$ZIPALIGN -f 4 $WORK_DIR/merged_unsigned.apk $WORK_DIR/merged_aligned.apk
```

### 4.6 签名 APK

```bash
APKSIGNER=~/Library/Android/sdk/build-tools/35.0.0/apksigner
DEBUG_KEYSTORE=~/.android/debug.keystore

# 使用 debug keystore 签名
JAVA_HOME=/opt/homebrew/opt/openjdk $APKSIGNER sign \
    --ks $DEBUG_KEYSTORE \
    --ks-pass pass:android \
    --out $WORK_DIR/merged_signed.apk \
    $WORK_DIR/merged_aligned.apk
```

### 4.7 安装测试

```bash
# 卸载旧版本（如果存在）
adb uninstall com.phonepe.app

# 安装合并后的 APK
adb install $WORK_DIR/merged_signed.apk
```

---

## 5. 常见问题及解决方案

### 问题 1: INSTALL_FAILED_MISSING_SPLIT

**错误信息**:
```
INSTALL_FAILED_MISSING_SPLIT: Missing split for com.phonepe.app
```

**原因**: AndroidManifest.xml 中声明了 `requiredSplitTypes`，但缺少对应的 split APK

**解决方案**:
```bash
sed -i '' 's/ android:requiredSplitTypes="[^"]*"//g' AndroidManifest.xml
sed -i '' 's/ android:splitTypes="[^"]*"//g' AndroidManifest.xml
```

---

### 问题 2: INSTALL_FAILED_INVALID_APK (native libraries)

**错误信息**:
```
INSTALL_FAILED_INVALID_APK: Failed to extract native libraries, res=-2
```

**原因**: `extractNativeLibs="false"` 要求 .so 文件不压缩存储，但 apktool 默认压缩

**解决方案**:
```bash
sed -i '' 's/android:extractNativeLibs="false"/android:extractNativeLibs="true"/g' AndroidManifest.xml
```

---

### 问题 3: INSTALL_PARSE_FAILED_MANIFEST_MALFORMED

**错误信息**:
```
INSTALL_PARSE_FAILED_MANIFEST_MALFORMED: <meta-data> requires an android:value or android:resource attribute
```

**原因**: Manifest 中存在 `android:resource="@null"` 等无效引用

**解决方案**:
```bash
# 删除包含 @null 的行
sed -i '' '/@null/d' AndroidManifest.xml
```

---

### 问题 4: 签名不匹配无法覆盖安装

**错误信息**:
```
INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package signatures do not match
```

**原因**: 设备上已安装官方签名版本，无法用自签名版本覆盖

**解决方案**:
```bash
# 先卸载再安装
adb uninstall <package_name>
adb install merged_signed.apk
```

---

## 6. 自动化脚本

完整的自动化脚本位于：
```
/Users/danielscai/Documents/印度支付/apk包-研究/merge_split_apks.sh
```

### 使用方法

```bash
# 基本用法（从设备提取并合并）
./merge_split_apks.sh -p com.phonepe.app

# 指定设备
./merge_split_apks.sh -p com.phonepe.app -s SM02G4061933188

# 从本地目录合并（已提取的 APK）
./merge_split_apks.sh -d /path/to/extracted_apks -p com.phonepe.app

# 合并后自动安装到模拟器
./merge_split_apks.sh -p com.phonepe.app -i -s emulator-5554
```

### 脚本参数

| 参数 | 说明 |
|------|------|
| `-p <package>` | 包名（必需） |
| `-s <serial>` | 设备序列号（可选） |
| `-d <dir>` | 本地 APK 目录（可选，跳过提取步骤） |
| `-o <dir>` | 输出目录（默认: ./merged_output） |
| `-i` | 合并后自动安装 |
| `-h` | 显示帮助 |

---

## 附录：PhonePe 合并实例

### 原始文件

| 文件 | 大小 |
|------|------|
| base.apk | 146 MB |
| split_config.arm64_v8a.apk | 34 MB |
| split_config.xxhdpi.apk | 1 MB |
| **总计** | **181 MB** |

### 合并结果

| 文件 | 大小 |
|------|------|
| phonepe_merged_v3_signed.apk | 175 MB |

### 修改清单

1. ✅ 移除 `android:requiredSplitTypes="base__abi,base__density"`
2. ✅ 移除 `android:splitTypes=""`
3. ✅ 修改 `android:extractNativeLibs="false"` → `"true"`
4. ✅ 删除 `<meta-data android:resource="@null"/>` 无效行
5. ✅ 复制 37 个 .so 文件到 `lib/arm64-v8a/`

---

> 文档结束
