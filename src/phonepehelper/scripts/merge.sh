#!/bin/bash

#######################################################################
# PhonePeHelper 代码合并脚本
#
# 功能：将编译后的 smali 代码注入到反编译的 APK 目录
#
# 用法：./merge.sh <decompiled_apk_dir>
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
BUILD_DIR="$PROJECT_DIR/build"
SMALI_DIR="$BUILD_DIR/smali"

# 目标 APK 目录
TARGET_DIR="${1:-}"

if [ -z "$TARGET_DIR" ]; then
    log_error "请指定目标 APK 目录"
    echo ""
    echo "用法: $0 <decompiled_apk_dir>"
    exit 1
fi

if [ ! -d "$TARGET_DIR" ]; then
    log_error "目标目录不存在: $TARGET_DIR"
    exit 1
fi

log_step "检查编译输出"

# 检查是否已编译
if [ ! -d "$SMALI_DIR/com/phonepehelper" ]; then
    log_warn "PhonePeHelper 代码未编译，先运行编译..."
    "$SCRIPT_DIR/compile.sh"
fi

log_info "Smali 目录: $SMALI_DIR"

log_step "1. 复制 PhonePeHelper 代码"

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

# 清理旧的 phonepehelper 类，避免重复定义
while IFS= read -r d; do
    rm -rf "$d"
done < <(find "$TARGET_DIR" -type d -path "*/com/phonepehelper")

while IFS= read -r f; do
    rm -f "$f"
done < <(find "$TARGET_DIR" -type f -path "*/com/PhonePeTweak/Def/PhonePeHelper.smali")

# 复制 helper 代码
cp -r "$SMALI_DIR/com" "$TARGET_SMALI_DIR/"
log_info "已复制 com/* 到 $TARGET_SMALI_DIR"

log_step "2. 绑定主注入入口 (SignatureBypass)"

HOOK_ENTRY_LIST=$(find "$TARGET_DIR" -path "*/com/sigbypass/HookEntry.smali" | sort -V)
HOOK_ENTRY_SMALI=$(echo "$HOOK_ENTRY_LIST" | tail -1)

if [ -z "$HOOK_ENTRY_SMALI" ]; then
    log_error "未找到 com/sigbypass/HookEntry.smali"
    log_error "请先注入 signature_bypass 作为主入口，再注入 phonepehelper"
    exit 1
fi

log_info "HookEntry: $HOOK_ENTRY_SMALI"

# 去重：仅保留一个 HookEntry.smali，避免重复定义导致入口未生效
if [ -n "$HOOK_ENTRY_LIST" ]; then
    while IFS= read -r f; do
        if [ "$f" != "$HOOK_ENTRY_SMALI" ]; then
            rm -f "$f"
        fi
    done <<< "$HOOK_ENTRY_LIST"
fi

if grep -q "Lcom/phonepehelper/ModuleInit;->init" "$HOOK_ENTRY_SMALI"; then
    log_warn "HookEntry 已包含 phonepehelper 初始化，跳过修改"
else
    log_info "向 HookEntry.init() 注入 phonepehelper 初始化..."

    python3 - "$HOOK_ENTRY_SMALI" <<'PYCODE'
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text()

if "Lcom/phonepehelper/ModuleInit;->init" in text:
    sys.exit(0)

start = text.find(".method public static init(Landroid/content/Context;)V")
if start == -1:
    raise SystemExit("HookEntry.init() not found")

end = text.find(".end method", start)
if end == -1:
    raise SystemExit("HookEntry.init() end not found")

end = end + len(".end method")
method = text[start:end]
if "Lcom/phonepehelper/ModuleInit;->init" in method:
    sys.exit(0)

snippet = (
    "    invoke-static {p0}, Lcom/phonepehelper/ModuleInit;->init(Landroid/content/Context;)V\n"
)

inserted = False
for needle in [
    "sput-object v0, Lcom/sigbypass/HookEntry;->appContext:Landroid/content/Context;",
    "sput-object p0, Lcom/sigbypass/HookEntry;->appContext:Landroid/content/Context;",
    "invoke-virtual {p0}, Landroid/content/Context;->getApplicationContext()Landroid/content/Context;",
]:
    idx = method.find(needle)
    if idx != -1:
        line_end = method.find("\\n", idx)
        if line_end == -1:
            line_end = idx + len(needle)
        injected = method[:line_end + 1] + snippet + method[line_end + 1:]
        inserted = True
        break

if not inserted:
    raise SystemExit("Failed to find injection point in HookEntry.init")

injected = injected if inserted else method

text = text[:start] + injected + text[end:]
path.write_text(text)
PYCODE
fi

log_step "3. 验证"

echo ""
echo "文件检查:"

check_file() {
    if [ -f "$1" ] || [ -d "$1" ]; then
        echo -e "  ${GREEN}✓${NC} $2"
    else
        echo -e "  ${RED}✗${NC} $2"
    fi
}

check_file "$TARGET_SMALI_DIR/com/PhonePeTweak/Def/PhonePeHelper.smali" "PhonePeHelper.smali"
check_file "$HOOK_ENTRY_SMALI" "HookEntry.smali"

if grep -q "Lcom/phonepehelper/ModuleInit;->init" "$HOOK_ENTRY_SMALI"; then
    echo -e "  ${GREEN}✓${NC} HookEntry 已注入 phonepehelper 初始化"
else
    echo -e "  ${RED}✗${NC} HookEntry 未注入 phonepehelper 初始化"
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
