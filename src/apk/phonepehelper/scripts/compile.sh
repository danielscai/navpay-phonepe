#!/bin/bash

#######################################################################
# PhonePeHelper 模块编译脚本
#
# 功能：将 Java 源码编译为 smali 文件
#
# 依赖：
# - Java JDK (javac)
# - Android SDK (d8/dx)
# - baksmali (smali 反编译工具)
#
# 用法：./compile.sh
#######################################################################

set -euo pipefail

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "\n${BLUE}==== $1 ====${NC}"; }

# 路径配置
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SRC_DIR="$PROJECT_DIR/src/main/java"
LIBS_DIR="$PROJECT_DIR/libs"
BUILD_DIR="$PROJECT_DIR/build"
OUTPUT_DIR="$BUILD_DIR/smali"

# Android SDK 路径
ANDROID_SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BUILD_TOOLS="$(find "$ANDROID_SDK/build-tools" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -1)"
# 自动查找最新的 android.jar
ANDROID_JAR=$(ls -d "$ANDROID_SDK/platforms/android-"* 2>/dev/null | sort -V | tail -1)/android.jar

# Java 路径 (macOS Homebrew)
JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk}"
export PATH="$JAVA_HOME/bin:$PATH"

log_step "检查依赖"

# 检查 Java
if ! command -v javac &> /dev/null; then
    log_error "javac 未找到，请安装 JDK"
    exit 1
fi
log_info "Java: $(javac -version 2>&1)"

# 检查 d8
if [ ! -f "$BUILD_TOOLS/d8" ]; then
    log_error "d8 未找到: $BUILD_TOOLS/d8"
    log_error "请确保 Android SDK Build Tools 已安装"
    exit 1
fi
log_info "d8: $BUILD_TOOLS/d8"

# 检查 android.jar
if [ ! -f "$ANDROID_JAR" ]; then
    log_error "android.jar 未找到: $ANDROID_JAR"
    exit 1
fi
log_info "android.jar: $ANDROID_JAR"

# 检查 baksmali
if ! command -v baksmali &> /dev/null; then
    if [ ! -f "$LIBS_DIR/baksmali.jar" ]; then
        log_error "baksmali 未找到，且本地 jar 缺失: $LIBS_DIR/baksmali.jar"
        exit 1
    fi
    BAKSMALI=(java -jar "$LIBS_DIR/baksmali.jar")
else
    BAKSMALI=(baksmali)
fi

log_step "编译 Java 源码"

# 创建构建目录
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/classes"
mkdir -p "$OUTPUT_DIR"

# 查找所有 Java 文件
JAVA_FILES=$(find "$SRC_DIR" -name "*.java")
log_info "找到 Java 文件:"
for f in $JAVA_FILES; do
    echo "  - $(basename $f)"
done

# 编译 Java
log_info "编译中..."
javac -source 1.8 -target 1.8 \
    -cp "$ANDROID_JAR" \
    -d "$BUILD_DIR/classes" \
    $JAVA_FILES

if [ $? -ne 0 ]; then
    log_error "编译失败"
    exit 1
fi
log_info "编译成功"

log_step "转换为 DEX"

# 使用 d8 将 class 文件转换为 dex
log_info "转换为 DEX..."
"$BUILD_TOOLS/d8" \
    --lib "$ANDROID_JAR" \
    --output "$BUILD_DIR" \
    $(find "$BUILD_DIR/classes" -name "*.class")

if [ ! -f "$BUILD_DIR/classes.dex" ]; then
    log_error "DEX 转换失败"
    exit 1
fi
log_info "生成: $BUILD_DIR/classes.dex"

log_step "反编译为 Smali"

# 使用 baksmali 将 dex 转换为 smali
log_info "反编译为 Smali..."
"${BAKSMALI[@]}" d "$BUILD_DIR/classes.dex" -o "$OUTPUT_DIR"

if [ $? -ne 0 ]; then
    log_error "Smali 反编译失败"
    exit 1
fi

log_info "生成 Smali 文件:"
find "$OUTPUT_DIR" -name "*.smali" | while read f; do
    echo "  - ${f#$OUTPUT_DIR/}"
done

log_step "完成"

echo ""
echo -e "${GREEN}编译成功!${NC}"
echo ""
