#!/bin/bash

#######################################################################
# PhonePeHelper 代码合并脚本
#
# 功能：将编译后的 smali 代码注入到反编译的 APK 目录
#
# 用法：./merge.sh --artifact-dir <artifact_dir> <decompiled_apk_dir>
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

usage() {
    echo "用法: $0 --artifact-dir <artifact_dir> <decompiled_apk_dir>"
}

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

log_step "检查编译输出"

if [ ! -d "$SMALI_DIR/com/phonepehelper" ]; then
    log_error "artifact 中缺少 phonepehelper smali: $SMALI_DIR/com/phonepehelper"
    exit 1
fi
if [ ! -f "$SMALI_DIR/com/PhonePeTweak/Def/PhonePeHelper.smali" ]; then
    log_error "artifact 中缺少关键入口文件: $SMALI_DIR/com/PhonePeTweak/Def/PhonePeHelper.smali"
    exit 1
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

log_step "2. 绑定主注入入口 (Dispatcher)"

APP_SMALI=$(find "$TARGET_DIR" -name "PhonePeApplication.smali" -path "*/com/phonepe/app/*" | head -1)
if [ -z "$APP_SMALI" ]; then
    log_error "未找到 PhonePeApplication.smali"
    exit 1
fi

log_info "Application: $APP_SMALI"

if [ "${NAVPAY_SKIP_APP_DISPATCHER_INJECT:-0}" = "1" ]; then
    log_warn "检测到 NAVPAY_SKIP_APP_DISPATCHER_INJECT=1，跳过 Application Dispatcher 注入"
else
    python3 "$DISPATCHER_INJECT_SCRIPT" "$APP_SMALI"
fi

log_step "3. 注册 phonepehelper 到 Dispatcher"

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
DISPATCHER_CMD+=(--append "Lcom/phonepehelper/ModuleInit;->init(Landroid/content/Context;)V")
"${DISPATCHER_CMD[@]}"

DISPATCHER_SMALI="$TARGET_SMALI_DIR/com/indipay/inject/Dispatcher.smali"
if [ ! -f "$DISPATCHER_SMALI" ]; then
    log_error "Dispatcher.smali 创建失败: $DISPATCHER_SMALI"
    exit 1
fi

log_step "4. 注入 Navpay ContentProvider 到 Manifest"

MANIFEST_FILE="$TARGET_DIR/AndroidManifest.xml"
if [ -f "$MANIFEST_FILE" ]; then
    python3 - "$MANIFEST_FILE" <<'PYCODE'
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
ns_android = "http://schemas.android.com/apk/res/android"
provider_name = "com.phonepehelper.NavpayBridgeProvider"
provider_authority = "com.phonepe.navpay.provider"

ET.register_namespace("android", ns_android)
tree = ET.parse(path)
root = tree.getroot()
app = root.find("application")
if app is None:
    raise SystemExit("application node not found")

for node in app.findall("provider"):
    if node.get(f"{{{ns_android}}}name") == provider_name or node.get(f"{{{ns_android}}}authorities") == provider_authority:
        tree.write(path, encoding="utf-8", xml_declaration=True)
        print("provider already exists")
        raise SystemExit(0)

provider = ET.Element("provider")
provider.set(f"{{{ns_android}}}name", provider_name)
provider.set(f"{{{ns_android}}}exported", "true")
provider.set(f"{{{ns_android}}}grantUriPermissions", "true")
provider.set(f"{{{ns_android}}}authorities", provider_authority)
app.append(provider)
tree.write(path, encoding="utf-8", xml_declaration=True)
print("provider injected")
PYCODE
    log_info "AndroidManifest.xml provider 配置完成"
else
    log_warn "AndroidManifest.xml 未找到，跳过 provider 注入"
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

check_file "$TARGET_SMALI_DIR/com/PhonePeTweak/Def/PhonePeHelper.smali" "PhonePeHelper.smali"
check_file "$DISPATCHER_SMALI" "Dispatcher.smali"

if [ ! -f "$TARGET_SMALI_DIR/com/PhonePeTweak/Def/PhonePeHelper.smali" ]; then
    log_error "PhonePeHelper.smali 缺失，注入失败"
    exit 1
fi

if [ ! -f "$DISPATCHER_SMALI" ]; then
    log_error "Dispatcher.smali 缺失，注入失败"
    exit 1
fi

if grep -q "Lcom/phonepehelper/ModuleInit;->init(Landroid/content/Context;)V" "$DISPATCHER_SMALI"; then
    echo -e "  ${GREEN}✓${NC} Dispatcher 已注册 phonepehelper 初始化"
else
    echo -e "  ${RED}✗${NC} Dispatcher 未注册 phonepehelper 初始化"
    exit 1
fi

if [ "${NAVPAY_SKIP_APP_DISPATCHER_INJECT:-0}" = "1" ]; then
    PROVIDER_SMALI="$TARGET_SMALI_DIR/com/phonepehelper/NavpayBridgeProvider.smali"
    if [ -f "$PROVIDER_SMALI" ] && grep -q "com.indipay.inject.Dispatcher" "$PROVIDER_SMALI"; then
        echo -e "  ${GREEN}✓${NC} Provider 将负责触发 Dispatcher 初始化"
    else
        echo -e "  ${RED}✗${NC} Provider 未包含 Dispatcher 启动逻辑"
        exit 1
    fi
elif grep -q "Lcom/indipay/inject/Dispatcher;->init(Landroid/content/Context;)V" "$APP_SMALI"; then
    echo -e "  ${GREEN}✓${NC} Application 入口已注入 Dispatcher"
else
    echo -e "  ${RED}✗${NC} Application 入口未注入 Dispatcher"
    exit 1
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
