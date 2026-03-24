#!/bin/bash

#######################################################################
# 签名绕过代码合并脚本
#
# 功能：将编译后的 smali 代码合并到反编译的 APK 目录
#
# 用法：./merge.sh --artifact-dir <artifact_dir> <decompiled_apk_dir>
#
# 示例：./merge.sh --artifact-dir ./build /path/to/decompiled/base
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
SRC_DIR="$(cd "$PROJECT_DIR/../.." && pwd)"
DISPATCHER_INJECT_SCRIPT="$SRC_DIR/apk/_framework/dispatcher/scripts/inject_entry.py"
DISPATCHER_LIB_SCRIPT="$SRC_DIR/pipeline/tools/lib/dispatcher.sh"

ARTIFACT_DIR=""
TARGET_DIR=""

usage() { echo "用法: $0 --artifact-dir <artifact_dir> <decompiled_apk_dir>"; }

while [ $# -gt 0 ]; do
    case "$1" in
        --artifact-dir)
            if [ $# -lt 2 ]; then
                log_error "--artifact-dir 需要一个路径参数"
                usage
                exit 1
            fi
            ARTIFACT_DIR="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            if [ -z "$TARGET_DIR" ]; then
                TARGET_DIR="$1"
            else
                log_error "未知参数: $1"
                usage
                exit 1
            fi
            shift
            ;;
    esac
done

if [ -z "$TARGET_DIR" ]; then
    log_error "请指定目标 APK 目录"
    echo ""
    usage
    echo ""
    echo "示例: $0 /path/to/merge_test_output/decompiled/base"
    exit 1
fi

if [ ! -d "$TARGET_DIR" ]; then
    log_error "目标目录不存在: $TARGET_DIR"
    exit 1
fi

collect_dispatcher_entries() {
    python3 - "$TARGET_DIR" <<'PYCODE'
import re
import sys
from pathlib import Path

target_dir = Path(sys.argv[1])
entries = []
for path in sorted(target_dir.glob("smali_classes*/com/indipay/inject/Dispatcher.smali")):
    text = path.read_text(encoding="utf-8")
    for entry in re.findall(r"invoke-static \{p0\}, (L[^ ]+;->[^\n]+)", text):
        if entry not in entries:
            entries.append(entry)
for entry in entries:
    print(entry)
PYCODE
}

if [ -z "$ARTIFACT_DIR" ]; then
    log_error "必须通过 --artifact-dir 提供预构建产物目录"
    exit 1
fi

if [ ! -d "$ARTIFACT_DIR" ]; then
    log_error "artifact 目录不存在: $ARTIFACT_DIR"
    exit 1
fi

BUILD_DIR="$ARTIFACT_DIR"
SMALI_DIR="$BUILD_DIR/smali"
PINE_SMALI_DIR="$BUILD_DIR/pine_smali"
PINE_LIB_DIR="$BUILD_DIR/libs/jni"

log_step "检查编译输出"

if [ ! -d "$SMALI_DIR/com/sigbypass" ]; then
    log_error "artifact 中缺少签名绕过 smali: $SMALI_DIR/com/sigbypass"
    exit 1
fi
if [ ! -d "$PINE_SMALI_DIR/top/canyie/pine" ]; then
    log_error "artifact 中缺少 Pine smali: $PINE_SMALI_DIR/top/canyie/pine"
    exit 1
fi
if [ ! -f "$PINE_LIB_DIR/arm64-v8a/libpine.so" ]; then
    log_error "artifact 中缺少 libpine.so: $PINE_LIB_DIR/arm64-v8a/libpine.so"
    exit 1
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

if [ -d "$PINE_SMALI_DIR/top/canyie/pine" ]; then
    mkdir -p "$TARGET_SMALI_DIR/top/canyie"
    cp -r "$PINE_SMALI_DIR/top/canyie/pine" "$TARGET_SMALI_DIR/top/canyie/"
    log_info "已复制 Pine 框架 ($(find $PINE_SMALI_DIR/top/canyie/pine -name '*.smali' | wc -l | tr -d ' ') 个文件)"
else
    log_error "Pine 框架 smali 未找到"
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
    exit 1
fi

log_step "4. 修改 Application 入口 (Dispatcher)"

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
if grep -q "Lcom/indipay/inject/Dispatcher;->init" "$APP_SMALI"; then
    log_warn "Application 已包含 Dispatcher 入口代码，跳过修改"
else
    log_info "注入 Dispatcher 入口代码..."

    # 使用统一 Dispatcher 入口注入脚本
    python3 "$DISPATCHER_INJECT_SCRIPT" "$APP_SMALI"

    # 验证注入结果
    if grep -q "Lcom/indipay/inject/Dispatcher;->init" "$APP_SMALI"; then
        log_info "注入成功"
    else
        log_error "注入失败，请手动编辑 $APP_SMALI"
        log_error "在 attachBaseContext 方法中添加:"
        echo ""
        echo '    invoke-static {p0}, Lcom/indipay/inject/Dispatcher;->init(Landroid/content/Context;)V'
        echo ""
        exit 1
    fi
fi

log_step "5. 生成 Dispatcher"

DISPATCHER_ENTRIES=()
while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    DISPATCHER_ENTRIES+=("$entry")
done < <(collect_dispatcher_entries)

while IFS= read -r f; do
    rm -f "$f"
done < <(find "$TARGET_DIR" -type f -path "*/com/indipay/inject/Dispatcher.smali")

DISPATCHER_CMD=("$DISPATCHER_LIB_SCRIPT" --target-dir "$TARGET_SMALI_DIR")
for entry in "${DISPATCHER_ENTRIES[@]}"; do
    DISPATCHER_CMD+=(--append "$entry")
done
DISPATCHER_CMD+=(--append "Lcom/sigbypass/HookEntry;->init(Landroid/content/Context;)V")
"${DISPATCHER_CMD[@]}"

DISPATCHER_SMALI="$TARGET_SMALI_DIR/com/indipay/inject/Dispatcher.smali"

log_step "6. 验证"

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
check_file "$DISPATCHER_SMALI" "Dispatcher.smali"
check_file "$TARGET_SMALI_DIR/top/canyie/pine/Pine.smali" "Pine.smali"
check_file "$TARGET_DIR/lib/arm64-v8a/libpine.so" "libpine.so"

# 检查注入
if grep -q "Lcom/indipay/inject/Dispatcher;->init" "$APP_SMALI"; then
    echo -e "  ${GREEN}✓${NC} Application 入口已注入"
else
    echo -e "  ${RED}✗${NC} Application 入口未注入"
fi

if grep -q "Lcom/sigbypass/HookEntry;->init(Landroid/content/Context;)V" "$DISPATCHER_SMALI"; then
    echo -e "  ${GREEN}✓${NC} Dispatcher 已包含 HookEntry 入口"
else
    echo -e "  ${RED}✗${NC} Dispatcher 未包含 HookEntry 入口"
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
