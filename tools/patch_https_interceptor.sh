#!/bin/bash

#######################################################################
# APK HTTPS 拦截器补丁脚本
#
# 功能：将 HTTPS 请求拦截器注入到合并后的 APK，记录所有网络请求
#
# 原理：
# 1. 编译拦截器 Java 代码为 smali
# 2. 复制拦截器 smali 到目标 APK
# 3. 修改 HookUtil 或 OkHttpClient.Builder.build() 注入拦截器
#
# 用法：./patch_https_interceptor.sh <decompiled_dir>
#
# 示例：
#   ./patch_https_interceptor.sh ./merged_output/decompiled/base
#   ./patch_https_interceptor.sh ./merged_output/decompiled/base
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

# 配置
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
INTERCEPTOR_SRC="$PROJECT_ROOT/src/https_interceptor"
TARGET_DIR="${1:-$PROJECT_ROOT/temp/phonepe_merged/decompiled/base}"

# Java/Android 配置
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk}"
export PATH="$JAVA_HOME/bin:$PATH"
ANDROID_SDK="$HOME/Library/Android/sdk"
ANDROID_JAR="$ANDROID_SDK/platforms/android-36/android.jar"

if [ ! -d "$TARGET_DIR" ]; then
    log_error "目标目录不存在: $TARGET_DIR"
    echo ""
    echo "用法: $0 <decompiled_dir>"
    echo ""
    echo "示例:"
    echo "  $0 ./merged_output/decompiled/base"
    echo "  $0 ./merged_output/decompiled/base http://192.168.1.100:8088/api/log"
    exit 1
fi

log_step "1. 检查环境"

# 检查 Java
if ! command -v java &> /dev/null; then
    log_error "未找到 Java"
    exit 1
fi
log_info "Java: $(java -version 2>&1 | head -1)"

# 检查 apktool
if ! command -v apktool &> /dev/null; then
    log_error "未找到 apktool，请安装: brew install apktool"
    exit 1
fi
log_info "apktool: $(apktool --version)"

# 检查 Android SDK
if [ ! -f "$ANDROID_JAR" ]; then
    log_warn "未找到 android.jar: $ANDROID_JAR"
    ANDROID_JAR=$(find "$ANDROID_SDK/platforms" -name "android.jar" | head -1)
    if [ -z "$ANDROID_JAR" ]; then
        log_error "未找到 Android SDK"
        exit 1
    fi
fi
log_info "Android JAR: $ANDROID_JAR"

log_step "2. 生成拦截器 smali 代码"

# 创建临时目录
TEMP_DIR=$(mktemp -d)
APP_DECOMPILED="$TEMP_DIR/app_decompiled"

log_info "临时目录: $TEMP_DIR"

# 选择新的 smali_classes 目录用于注入，避免覆盖原有类
max_idx=0
for d in "$TARGET_DIR"/smali_classes*; do
    base=$(basename "$d")
    if [[ "$base" =~ ^smali_classes([0-9]+)$ ]]; then
        idx="${BASH_REMATCH[1]}"
        if [ "$idx" -gt "$max_idx" ]; then
            max_idx="$idx"
        fi
    fi
done
new_idx=$((max_idx + 1))
INJECT_SMALI_DIR="$TARGET_DIR/smali_classes$new_idx"
mkdir -p "$INJECT_SMALI_DIR"

# 创建拦截器/HookUtil smali 目录
INTERCEPTOR_SMALI_DIR="$INJECT_SMALI_DIR/com/httpinterceptor/interceptor"
HOOK_SMALI_DIR="$INJECT_SMALI_DIR/com/httpinterceptor/hook"
mkdir -p "$INTERCEPTOR_SMALI_DIR" "$HOOK_SMALI_DIR"

# 从 https_interceptor demo APK 提取 smali
DEMO_APK="$PROJECT_ROOT/src/https_interceptor/app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$DEMO_APK" ]; then
    log_warn "未找到 demo APK，尝试构建..."
    (cd "$PROJECT_ROOT/src/https_interceptor" && ./build_and_install.sh build)
fi

if [ ! -f "$DEMO_APK" ]; then
    log_error "demo APK 未找到: $DEMO_APK"
    exit 1
fi

apktool d -f "$DEMO_APK" -o "$APP_DECOMPILED" >/dev/null

log_info "从 demo APK 提取 RemoteLoggingInterceptor* smali"
found=0
while IFS= read -r f; do
    cp "$f" "$INTERCEPTOR_SMALI_DIR/"
    found=1
done < <(find "$APP_DECOMPILED" -path "*/com/httpinterceptor/interceptor/RemoteLoggingInterceptor*.smali")

if [ "$found" -ne 1 ]; then
    log_error "未找到 RemoteLoggingInterceptor smali 文件"
    exit 1
fi

log_info "已复制 RemoteLoggingInterceptor smali 文件"

log_step "2.1 复制 HookUtil smali"

log_info "从 demo APK 提取 HookUtil* smali"
found=0
while IFS= read -r f; do
    cp "$f" "$HOOK_SMALI_DIR/"
    found=1
done < <(find "$APP_DECOMPILED" -path "*/com/httpinterceptor/hook/HookUtil*.smali")

if [ "$found" -ne 1 ]; then
    log_error "未找到 HookUtil smali 文件"
    exit 1
fi

log_info "已复制 HookUtil smali 文件"

log_step "3. 修改 OkHttpClient\$Builder.build() 调用 HookUtil"

BUILDER_SMALI=$(find "$TARGET_DIR" -path "*/okhttp3/OkHttpClient\$Builder.smali" | head -1)
if [ -z "$BUILDER_SMALI" ] || [ ! -f "$BUILDER_SMALI" ]; then
    log_error "找不到 OkHttpClient\$Builder.smali"
    exit 1
fi

if rg -q "HookUtil;->build\(" "$BUILDER_SMALI"; then
    log_warn "OkHttpClient\$Builder.build() 已指向 HookUtil.build()，跳过修改"
else
    log_info "替换 OkHttpClient\$Builder.build() -> HookUtil.build()"

    python3 - "$BUILDER_SMALI" <<'PYCODE'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text()

pattern = re.compile(
    r"(?ms)^\.method public final build\(\)Lokhttp3/OkHttpClient;.*?^\.end method\s*",
)

replacement = """\
.method public final build()Lokhttp3/OkHttpClient;
    .locals 1
    .annotation build Lorg/jetbrains/annotations/NotNull;
    .end annotation

    invoke-static {p0}, Lcom/httpinterceptor/hook/HookUtil;->build(Lokhttp3/OkHttpClient$Builder;)Lokhttp3/OkHttpClient;

    move-result-object v0

    return-object v0
.end method
"""

new_text, n = pattern.subn(replacement, text, count=1)
if n != 1:
    raise SystemExit("Failed to replace OkHttpClient$Builder.build()")

path.write_text(new_text)
PYCODE
fi

log_step "4. 验证文件"

echo "检查生成的文件:"
check_file() {
    if [ -f "$1" ]; then
        echo -e "  ${GREEN}✓${NC} $(basename $1)"
    else
        echo -e "  ${RED}✗${NC} $(basename $1) - 缺失!"
    fi
}

interceptor_files=("$INTERCEPTOR_SMALI_DIR"/RemoteLoggingInterceptor*.smali)
if [ ${#interceptor_files[@]} -eq 0 ]; then
    echo -e "  ${RED}✗${NC} RemoteLoggingInterceptor*.smali - 缺失!"
else
    for f in "${interceptor_files[@]}"; do
        check_file "$f"
    done
fi

hookutil_files=("$HOOK_SMALI_DIR"/HookUtil*.smali)
if [ ${#hookutil_files[@]} -eq 0 ]; then
    echo -e "  ${RED}✗${NC} HookUtil*.smali - 缺失!"
else
    for f in "${hookutil_files[@]}"; do
        check_file "$f"
    done
fi

# 清理临时目录
rm -rf "$TEMP_DIR"

log_step "完成"

echo ""
echo -e "${GREEN}HTTPS 拦截器补丁已应用!${NC}"
echo ""
echo "下一步:"
echo "  1. 重新打包: apktool b $TARGET_DIR -o patched.apk"
echo "  2. 对齐签名 (使用现有脚本)"
echo "  3. 安装 APK 并测试"
