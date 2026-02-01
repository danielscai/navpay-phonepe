#!/bin/bash

#######################################################################
# 签名绕过代码合并脚本
#
# 功能：将编译后的 smali 代码注入到反编译的 APK 目录
#
# 用法：./inject.sh <decompiled_apk_dir>
#
# 示例：./inject.sh /path/to/decompiled/base
#######################################################################

set -e

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
TOOLS_DIR="$PROJECT_DIR/tools"
BUILD_DIR="$PROJECT_DIR/build"
SMALI_DIR="$BUILD_DIR/smali"
PINE_SMALI_DIR="$BUILD_DIR/pine_smali"
PINE_LIB_DIR="$PROJECT_DIR/libs/jni"

# 目标 APK 目录
TARGET_DIR="${1:-}"

if [ -z "$TARGET_DIR" ]; then
    log_error "请指定目标 APK 目录"
    echo ""
    echo "用法: $0 <decompiled_apk_dir>"
    echo ""
    echo "示例: $0 /path/to/merge_test_output/decompiled/base"
    exit 1
fi

if [ ! -d "$TARGET_DIR" ]; then
    log_error "目标目录不存在: $TARGET_DIR"
    exit 1
fi

log_step "检查编译输出"

# 检查是否已编译
if [ ! -d "$SMALI_DIR/com/sigbypass" ]; then
    log_warn "签名绕过代码未编译，先运行编译..."
    "$TOOLS_DIR/compile.sh"
fi

log_info "Smali 目录: $SMALI_DIR"

log_step "1. 复制签名绕过代码"

# 确定目标 smali 目录（使用最后一个 smali_classes 目录，或创建新的）
LAST_SMALI=$(ls -d "$TARGET_DIR"/smali_classes* 2>/dev/null | sort -V | tail -1)
if [ -z "$LAST_SMALI" ]; then
    TARGET_SMALI_DIR="$TARGET_DIR/smali_classes2"
else
    # 提取数字并加1
    NUM=$(echo "$LAST_SMALI" | grep -o '[0-9]*$')
    if [ -z "$NUM" ]; then
        NUM=1
    fi
    NEXT_NUM=$((NUM + 1))
    TARGET_SMALI_DIR="$TARGET_DIR/smali_classes$NEXT_NUM"
fi

log_info "目标 Smali 目录: $TARGET_SMALI_DIR"
mkdir -p "$TARGET_SMALI_DIR"

# 复制签名绕过代码
cp -r "$SMALI_DIR/com" "$TARGET_SMALI_DIR/"
log_info "已复制 com/sigbypass/* 到 $TARGET_SMALI_DIR"

log_step "2. 复制 Pine Hook 框架"

# 检查 Pine smali 是否存在，如果不存在则编译
if [ ! -d "$PINE_SMALI_DIR/top/canyie/pine" ]; then
    log_warn "Pine smali 未找到，需要先运行编译..."
    "$TOOLS_DIR/compile.sh"
fi

if [ -d "$PINE_SMALI_DIR/top/canyie/pine" ]; then
    mkdir -p "$TARGET_SMALI_DIR/top/canyie"
    cp -r "$PINE_SMALI_DIR/top/canyie/pine" "$TARGET_SMALI_DIR/top/canyie/"
    log_info "已复制 Pine 框架 ($(find $PINE_SMALI_DIR/top/canyie/pine -name '*.smali' | wc -l | tr -d ' ') 个文件)"
else
    log_error "Pine 框架 smali 未找到"
    log_error "请运行 ./tools/compile.sh 先编译 Pine 框架"
    exit 1
fi

log_step "3. 复制 Native 库"

# 复制 libpine.so (从 Pine AAR 提取)
if [ -f "$PINE_LIB_DIR/arm64-v8a/libpine.so" ]; then
    mkdir -p "$TARGET_DIR/lib/arm64-v8a"
    cp "$PINE_LIB_DIR/arm64-v8a/libpine.so" "$TARGET_DIR/lib/arm64-v8a/"
    log_info "已复制 libpine.so (arm64-v8a)"

    # 也复制 armeabi-v7a 版本（可选）
    if [ -f "$PINE_LIB_DIR/armeabi-v7a/libpine.so" ]; then
        mkdir -p "$TARGET_DIR/lib/armeabi-v7a"
        cp "$PINE_LIB_DIR/armeabi-v7a/libpine.so" "$TARGET_DIR/lib/armeabi-v7a/"
        log_info "已复制 libpine.so (armeabi-v7a)"
    fi
else
    log_error "libpine.so 未找到: $PINE_LIB_DIR/arm64-v8a/libpine.so"
    log_error "请确保运行了 compile.sh 来提取 Pine 库"
    exit 1
fi

log_step "4. 修改 Application 入口"

# 查找 PhonePeApplication.smali
APP_SMALI=$(find "$TARGET_DIR" -name "PhonePeApplication.smali" -path "*/com/phonepe/app/*" | head -1)

if [ -z "$APP_SMALI" ]; then
    log_error "未找到 PhonePeApplication.smali"
    exit 1
fi

log_info "Application: $APP_SMALI"

# 备份
if [ ! -f "$APP_SMALI.bak" ]; then
    cp "$APP_SMALI" "$APP_SMALI.bak"
    log_info "已备份原始文件"
fi

# 检查是否已修改
if grep -q "Lcom/sigbypass/HookEntry;->init" "$APP_SMALI"; then
    log_warn "Application 已包含 Hook 入口代码，跳过修改"
else
    log_info "注入 Hook 入口代码..."

    # 使用 Python 脚本进行注入
    python3 "$TOOLS_DIR/inject_hook.py" "$APP_SMALI"

    # 验证注入结果
    if grep -q "Lcom/sigbypass/HookEntry;->init" "$APP_SMALI"; then
        log_info "注入成功"
    else
        log_error "注入失败，请手动编辑 $APP_SMALI"
        log_error "在 attachBaseContext 方法中添加:"
        echo ""
        echo '    invoke-static {p0}, Lcom/sigbypass/HookEntry;->init(Landroid/content/Context;)V'
        echo ""
    fi
fi

log_step "5. 验证"

echo ""
echo "文件检查:"

check_file() {
    if [ -f "$1" ] || [ -d "$1" ]; then
        echo -e "  ${GREEN}✓${NC} $2"
    else
        echo -e "  ${RED}✗${NC} $2"
    fi
}

check_file "$TARGET_SMALI_DIR/com/sigbypass/HookEntry.smali" "HookEntry.smali"
check_file "$TARGET_SMALI_DIR/com/sigbypass/SignatureHook.smali" "SignatureHook.smali"
check_file "$TARGET_SMALI_DIR/com/sigbypass/SignatureConfig.smali" "SignatureConfig.smali"
check_file "$TARGET_SMALI_DIR/top/canyie/pine/Pine.smali" "Pine.smali"
check_file "$TARGET_DIR/lib/arm64-v8a/libpine.so" "libpine.so"

# 检查注入
if grep -q "Lcom/sigbypass/HookEntry;->init" "$APP_SMALI"; then
    echo -e "  ${GREEN}✓${NC} Application 入口已注入"
else
    echo -e "  ${RED}✗${NC} Application 入口未注入"
fi

log_step "完成"

echo ""
echo -e "${GREEN}合并完成!${NC}"
echo ""
echo "下一步:"
echo "  1. 重新打包: apktool b $TARGET_DIR -o patched.apk"
echo "  2. 对齐: zipalign -f 4 patched.apk patched_aligned.apk"
echo "  3. 签名: apksigner sign --ks ~/.android/debug.keystore --ks-pass pass:android --out patched_signed.apk patched_aligned.apk"
echo "  4. 安装: adb install patched_signed.apk"
