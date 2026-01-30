#!/bin/bash

#######################################################################
# Split APK 合并脚本
#
# 功能：将 Android Split APKs 合并为单个可安装的 APK
#
# 用法：
#   ./merge_split_apks.sh -p <package_name> [options]
#
# 示例：
#   ./merge_split_apks.sh -p com.phonepe.app
#   ./merge_split_apks.sh -p com.phonepe.app -s emulator-5554 -i
#   ./merge_split_apks.sh -d ./extracted_apks -p com.phonepe.app
#
# 作者：自动生成
# 日期：2026-01-29
#######################################################################

set -e

# ==================== 配置 ====================

# Android SDK 路径
ANDROID_SDK="$HOME/Library/Android/sdk"
ADB="$ANDROID_SDK/platform-tools/adb"
ZIPALIGN="$ANDROID_SDK/build-tools/35.0.0/zipalign"
APKSIGNER="$ANDROID_SDK/build-tools/35.0.0/apksigner"

# Java 配置
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk}"

# 签名配置
DEBUG_KEYSTORE="$HOME/.android/debug.keystore"
KEYSTORE_PASS="android"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ==================== 函数 ====================

print_banner() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════╗"
    echo "║     Split APK 合并工具 v1.0                ║"
    echo "╚════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_usage() {
    echo "用法: $0 -p <package_name> [options]"
    echo ""
    echo "必需参数:"
    echo "  -p <package>    目标应用包名"
    echo ""
    echo "可选参数:"
    echo "  -s <serial>     设备序列号 (默认: 自动选择)"
    echo "  -d <dir>        本地 APK 目录 (跳过从设备提取)"
    echo "  -o <dir>        输出目录 (默认: ./merged_output)"
    echo "  -i              合并后自动安装"
    echo "  -h              显示帮助"
    echo ""
    echo "示例:"
    echo "  $0 -p com.phonepe.app"
    echo "  $0 -p com.phonepe.app -s emulator-5554 -i"
    echo "  $0 -d ./my_apks -p com.example.app -o ./output"
}

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo ""
    echo -e "${BLUE}==== $1 ====${NC}"
}

check_requirements() {
    log_step "检查环境"

    local missing=0

    # 检查 adb
    if [ ! -f "$ADB" ]; then
        log_error "未找到 adb: $ADB"
        missing=1
    else
        log_info "adb: $($ADB version | head -1)"
    fi

    # 检查 zipalign
    if [ ! -f "$ZIPALIGN" ]; then
        log_error "未找到 zipalign: $ZIPALIGN"
        log_warn "尝试查找其他版本..."
        ZIPALIGN=$(find "$ANDROID_SDK/build-tools" -name "zipalign" | head -1)
        if [ -z "$ZIPALIGN" ]; then
            missing=1
        else
            log_info "找到 zipalign: $ZIPALIGN"
        fi
    fi

    # 检查 apksigner
    if [ ! -f "$APKSIGNER" ]; then
        log_error "未找到 apksigner: $APKSIGNER"
        log_warn "尝试查找其他版本..."
        APKSIGNER=$(find "$ANDROID_SDK/build-tools" -name "apksigner" | head -1)
        if [ -z "$APKSIGNER" ]; then
            missing=1
        else
            log_info "找到 apksigner: $APKSIGNER"
        fi
    fi

    # 检查 apktool
    if ! command -v apktool &> /dev/null; then
        log_error "未找到 apktool，请安装: brew install apktool"
        missing=1
    else
        log_info "apktool: $(apktool --version)"
    fi

    # 检查 Java
    if ! command -v java &> /dev/null && [ ! -f "$JAVA_HOME/bin/java" ]; then
        log_error "未找到 Java，请安装: brew install openjdk"
        missing=1
    else
        log_info "Java: $(java -version 2>&1 | head -1)"
    fi

    # 检查 keystore
    if [ ! -f "$DEBUG_KEYSTORE" ]; then
        log_warn "未找到 debug.keystore，将自动创建"
    fi

    if [ $missing -eq 1 ]; then
        log_error "缺少必要工具，请先安装"
        exit 1
    fi

    log_info "环境检查通过"
}

select_device() {
    log_step "选择设备"

    if [ -n "$DEVICE_SERIAL" ]; then
        log_info "使用指定设备: $DEVICE_SERIAL"
        return
    fi

    # 获取设备列表
    local devices=$($ADB devices | grep -v "List" | grep "device$" | awk '{print $1}')
    local count=$(echo "$devices" | grep -c . || echo 0)

    if [ "$count" -eq 0 ]; then
        log_error "未找到已连接的设备"
        exit 1
    elif [ "$count" -eq 1 ]; then
        DEVICE_SERIAL="$devices"
        log_info "自动选择设备: $DEVICE_SERIAL"
    else
        log_warn "检测到多个设备:"
        echo "$devices" | nl
        echo ""
        read -p "请输入设备编号: " choice
        DEVICE_SERIAL=$(echo "$devices" | sed -n "${choice}p")
        log_info "已选择: $DEVICE_SERIAL"
    fi
}

extract_apks() {
    log_step "从设备提取 APK"

    # 检查应用是否安装
    if ! $ADB -s "$DEVICE_SERIAL" shell pm list packages | grep -q "$PACKAGE_NAME"; then
        log_error "应用未安装: $PACKAGE_NAME"
        exit 1
    fi

    # 获取 APK 路径
    local apk_paths=$($ADB -s "$DEVICE_SERIAL" shell pm path "$PACKAGE_NAME" | sed 's/package://')

    if [ -z "$apk_paths" ]; then
        log_error "无法获取 APK 路径"
        exit 1
    fi

    log_info "找到以下 APK 文件:"
    echo "$apk_paths"

    # 创建提取目录
    EXTRACT_DIR="$OUTPUT_DIR/extracted"
    mkdir -p "$EXTRACT_DIR"

    # 提取每个 APK
    local count=0
    while IFS= read -r apk_path; do
        apk_path=$(echo "$apk_path" | tr -d '\r')
        local filename=$(basename "$apk_path")
        log_info "提取: $filename"
        $ADB -s "$DEVICE_SERIAL" pull "$apk_path" "$EXTRACT_DIR/$filename"
        count=$((count + 1))
    done <<< "$apk_paths"

    log_info "共提取 $count 个 APK 文件"
    APK_SOURCE_DIR="$EXTRACT_DIR"
}

decompile_apks() {
    log_step "反编译 APK"

    DECOMPILE_DIR="$OUTPUT_DIR/decompiled"
    mkdir -p "$DECOMPILE_DIR"

    # 反编译 base.apk
    if [ -f "$APK_SOURCE_DIR/base.apk" ]; then
        log_info "反编译 base.apk..."
        apktool d "$APK_SOURCE_DIR/base.apk" -o "$DECOMPILE_DIR/base" -f 2>&1 | tail -3
    else
        log_error "未找到 base.apk"
        exit 1
    fi

    # 反编译 split APKs
    for split_apk in "$APK_SOURCE_DIR"/split_*.apk; do
        if [ -f "$split_apk" ]; then
            local name=$(basename "$split_apk" .apk)
            log_info "反编译 $name..."
            apktool d "$split_apk" -o "$DECOMPILE_DIR/$name" -f 2>&1 | tail -2
        fi
    done
}

merge_apks() {
    log_step "合并 APK 内容"

    local base_dir="$DECOMPILE_DIR/base"

    # 合并 native 库
    for split_dir in "$DECOMPILE_DIR"/split_config.*; do
        if [ -d "$split_dir/lib" ]; then
            log_info "合并 native 库: $(basename $split_dir)"

            for arch_dir in "$split_dir/lib"/*; do
                if [ -d "$arch_dir" ]; then
                    local arch=$(basename "$arch_dir")
                    mkdir -p "$base_dir/lib/$arch"
                    cp -r "$arch_dir"/* "$base_dir/lib/$arch/" 2>/dev/null || true
                    local so_count=$(ls -1 "$base_dir/lib/$arch"/*.so 2>/dev/null | wc -l)
                    log_info "  $arch: $so_count 个 .so 文件"
                fi
            done
        fi

        # 合并资源（如果有）
        if [ -d "$split_dir/res" ]; then
            log_info "合并资源: $(basename $split_dir)"
            cp -rn "$split_dir/res"/* "$base_dir/res/" 2>/dev/null || true
        fi
    done
}

fix_manifest() {
    log_step "修复 AndroidManifest.xml"

    local manifest="$DECOMPILE_DIR/base/AndroidManifest.xml"

    if [ ! -f "$manifest" ]; then
        log_error "未找到 AndroidManifest.xml"
        exit 1
    fi

    # 备份
    cp "$manifest" "$manifest.bak"

    # 1. 移除 requiredSplitTypes
    if grep -q "requiredSplitTypes" "$manifest"; then
        sed -i '' 's/ android:requiredSplitTypes="[^"]*"//g' "$manifest"
        log_info "已移除 requiredSplitTypes"
    fi

    # 2. 移除 splitTypes
    if grep -q "splitTypes" "$manifest"; then
        sed -i '' 's/ android:splitTypes="[^"]*"//g' "$manifest"
        log_info "已移除 splitTypes"
    fi

    # 3. 修改 extractNativeLibs
    if grep -q 'extractNativeLibs="false"' "$manifest"; then
        sed -i '' 's/android:extractNativeLibs="false"/android:extractNativeLibs="true"/g' "$manifest"
        log_info "已修改 extractNativeLibs 为 true"
    fi

    # 4. 删除 @null 引用
    if grep -q '@null' "$manifest"; then
        sed -i '' '/@null/d' "$manifest"
        log_info "已删除 @null 无效引用"
    fi

    # 5. 检查其他可能的问题
    if grep -q 'android:isSplitRequired="true"' "$manifest"; then
        sed -i '' 's/android:isSplitRequired="true"/android:isSplitRequired="false"/g' "$manifest"
        log_info "已修改 isSplitRequired 为 false"
    fi
}

rebuild_apk() {
    log_step "重新打包 APK"

    local base_dir="$DECOMPILE_DIR/base"
    UNSIGNED_APK="$OUTPUT_DIR/${PACKAGE_NAME}_merged_unsigned.apk"

    log_info "打包中..."
    apktool b "$base_dir" -o "$UNSIGNED_APK" 2>&1 | tail -5

    if [ ! -f "$UNSIGNED_APK" ]; then
        log_error "打包失败"
        exit 1
    fi

    log_info "打包完成: $UNSIGNED_APK"
}

align_apk() {
    log_step "对齐 APK"

    ALIGNED_APK="$OUTPUT_DIR/${PACKAGE_NAME}_merged_aligned.apk"

    "$ZIPALIGN" -f 4 "$UNSIGNED_APK" "$ALIGNED_APK"

    if [ ! -f "$ALIGNED_APK" ]; then
        log_error "对齐失败"
        exit 1
    fi

    log_info "对齐完成: $ALIGNED_APK"
}

sign_apk() {
    log_step "签名 APK"

    SIGNED_APK="$OUTPUT_DIR/${PACKAGE_NAME}_merged_signed.apk"

    # 确保 debug keystore 存在
    if [ ! -f "$DEBUG_KEYSTORE" ]; then
        log_warn "创建 debug keystore..."
        keytool -genkeypair -v -keystore "$DEBUG_KEYSTORE" \
            -alias androiddebugkey -keyalg RSA -keysize 2048 \
            -validity 10000 -storepass android -keypass android \
            -dname "CN=Android Debug,O=Android,C=US" 2>/dev/null
    fi

    "$APKSIGNER" sign \
        --ks "$DEBUG_KEYSTORE" \
        --ks-pass "pass:$KEYSTORE_PASS" \
        --out "$SIGNED_APK" \
        "$ALIGNED_APK" 2>&1 | grep -v "^WARNING" || true

    if [ ! -f "$SIGNED_APK" ]; then
        log_error "签名失败"
        exit 1
    fi

    log_info "签名完成: $SIGNED_APK"

    # 验证签名
    log_info "验证签名..."
    "$APKSIGNER" verify --print-certs "$SIGNED_APK" 2>&1 | grep -v "^WARNING" | head -5
}

install_apk() {
    log_step "安装 APK"

    # 先卸载旧版本
    log_info "卸载旧版本..."
    $ADB -s "$DEVICE_SERIAL" uninstall "$PACKAGE_NAME" 2>/dev/null || true

    # 安装新版本
    log_info "安装新版本..."
    $ADB -s "$DEVICE_SERIAL" install "$SIGNED_APK"

    # 验证安装
    if $ADB -s "$DEVICE_SERIAL" shell pm list packages | grep -q "$PACKAGE_NAME"; then
        log_info "安装成功!"
        $ADB -s "$DEVICE_SERIAL" shell dumpsys package "$PACKAGE_NAME" | grep -E "versionCode|versionName" | head -2
    else
        log_error "安装失败"
        exit 1
    fi
}

cleanup() {
    log_step "清理临时文件"

    # 可选：删除中间文件
    # rm -rf "$DECOMPILE_DIR"
    # rm -f "$UNSIGNED_APK" "$ALIGNED_APK"

    log_info "保留所有文件以供检查"
}

print_summary() {
    log_step "完成"

    echo ""
    echo -e "${GREEN}合并完成!${NC}"
    echo ""
    echo "输出文件:"
    echo "  $SIGNED_APK"
    echo ""
    echo "文件大小:"
    ls -lh "$SIGNED_APK" | awk '{print "  " $5}'
    echo ""

    if [ "$DO_INSTALL" = true ]; then
        echo "安装状态: 已安装到 $DEVICE_SERIAL"
    else
        echo "安装命令:"
        echo "  $ADB install $SIGNED_APK"
    fi
}

# ==================== 主程序 ====================

main() {
    print_banner

    # 解析参数
    while getopts "p:s:d:o:ih" opt; do
        case $opt in
            p) PACKAGE_NAME="$OPTARG" ;;
            s) DEVICE_SERIAL="$OPTARG" ;;
            d) APK_SOURCE_DIR="$OPTARG" ;;
            o) OUTPUT_DIR="$OPTARG" ;;
            i) DO_INSTALL=true ;;
            h) print_usage; exit 0 ;;
            *) print_usage; exit 1 ;;
        esac
    done

    # 验证必需参数
    if [ -z "$PACKAGE_NAME" ]; then
        log_error "缺少包名参数 (-p)"
        print_usage
        exit 1
    fi

    # 设置默认值
    OUTPUT_DIR="${OUTPUT_DIR:-./merged_output_$(date +%Y%m%d_%H%M%S)}"
    DO_INSTALL="${DO_INSTALL:-false}"

    # 创建输出目录
    mkdir -p "$OUTPUT_DIR"

    log_info "包名: $PACKAGE_NAME"
    log_info "输出目录: $OUTPUT_DIR"

    # 执行步骤
    check_requirements

    if [ -z "$APK_SOURCE_DIR" ]; then
        select_device
        extract_apks
    else
        log_info "使用本地 APK 目录: $APK_SOURCE_DIR"
    fi

    decompile_apks
    merge_apks
    fix_manifest
    rebuild_apk
    align_apk
    sign_apk

    if [ "$DO_INSTALL" = true ]; then
        if [ -z "$DEVICE_SERIAL" ]; then
            select_device
        fi
        install_apk
    fi

    cleanup
    print_summary
}

# 运行主程序
main "$@"
