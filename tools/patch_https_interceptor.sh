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
# 用法：./patch_https_interceptor.sh <decompiled_dir> [log_server_url]
#
# 示例：
#   ./patch_https_interceptor.sh ./merged_output/decompiled/base
#   ./patch_https_interceptor.sh ./merged_output/decompiled/base http://192.168.1.100:8088/api/log
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
LOG_SERVER_URL="${2:-http://127.0.0.1:8088/api/log}"

# Java/Android 配置
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk}"
export PATH="$JAVA_HOME/bin:$PATH"
ANDROID_SDK="$HOME/Library/Android/sdk"
ANDROID_JAR="$ANDROID_SDK/platforms/android-36/android.jar"

if [ ! -d "$TARGET_DIR" ]; then
    log_error "目标目录不存在: $TARGET_DIR"
    echo ""
    echo "用法: $0 <decompiled_dir> [log_server_url]"
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

# 创建拦截器 smali 目录
INTERCEPTOR_SMALI_DIR="$TARGET_DIR/smali_classes14/com/httpinterceptor/interceptor"
mkdir -p "$INTERCEPTOR_SMALI_DIR"

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

log_step "3. 修改 HookUtil 注入拦截器"

# 查找 HookUtil.smali
HOOKUTIL_SMALI="$TARGET_DIR/smali_classes14/com/PhonePeTweak/Def/HookUtil.smali"

if [ ! -f "$HOOKUTIL_SMALI" ]; then
    log_warn "未找到 HookUtil.smali，尝试搜索..."
    HOOKUTIL_SMALI=$(find "$TARGET_DIR" -name "HookUtil.smali" | head -1)
fi

if [ -z "$HOOKUTIL_SMALI" ] || [ ! -f "$HOOKUTIL_SMALI" ]; then
    log_warn "未找到 HookUtil.smali，将尝试注入 OkHttpClient\$Builder.build()"

    BUILDER_SMALI=$(find "$TARGET_DIR" -path "*/okhttp3/OkHttpClient\$Builder.smali" | head -1)
    if [ -z "$BUILDER_SMALI" ] || [ ! -f "$BUILDER_SMALI" ]; then
        log_error "找不到 OkHttpClient\$Builder.smali"
        exit 1
    fi

    if grep -q "RemoteLoggingInterceptor" "$BUILDER_SMALI"; then
        log_warn "OkHttpClient\$Builder 已包含 RemoteLoggingInterceptor，跳过修改"
    else
        log_info "注入 RemoteLoggingInterceptor 到 OkHttpClient\$Builder.build()"

        python3 - "$BUILDER_SMALI" <<'PYCODE'
import re
import sys
from pathlib import Path
path = Path(sys.argv[1])
lines = path.read_text().splitlines()
method_start = None
for i, line in enumerate(lines):
    if re.match(r"^\.method .* build\(\)Lokhttp3/OkHttpClient;", line):
        method_start = i
        break
if method_start is None:
    raise SystemExit("build() method not found")
locals_idx = None
for i in range(method_start+1, min(method_start+10, len(lines))):
    if lines[i].strip().startswith('.locals '):
        locals_idx = i
        break
if locals_idx is None:
    raise SystemExit(".locals not found in build()")
# increase locals by 1 to ensure a temp register
m = re.match(r"(\s*\.locals\s+)(\d+)", lines[locals_idx])
if not m:
    raise SystemExit("Failed to parse .locals")
count = int(m.group(2))
lines[locals_idx] = f"{m.group(1)}{count+2}"
# inject after .locals
inject = [
    "    const-string v0, \"HttpInterceptor\"",
    "    const-string v1, \"RemoteLoggingInterceptor injected\"",
    "    invoke-static {v0, v1}, Landroid/util/Log;->d(Ljava/lang/String;Ljava/lang/String;)I",
    "    new-instance v0, Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor;",
    "    invoke-direct {v0}, Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor;-><init>()V",
    "    invoke-virtual {p0, v0}, Lokhttp3/OkHttpClient$Builder;->addInterceptor(Lokhttp3/Interceptor;)Lokhttp3/OkHttpClient$Builder;",
    ""
]
lines[locals_idx+1:locals_idx+1] = inject
path.write_text("\n".join(lines) + "\n")
PYCODE
    fi
else
    log_info "找到 HookUtil: $HOOKUTIL_SMALI"

    # 备份
    cp "$HOOKUTIL_SMALI" "$HOOKUTIL_SMALI.bak"

    # 检查是否已经注入过
    if grep -q "RemoteLoggingInterceptor" "$HOOKUTIL_SMALI"; then
        log_warn "HookUtil 已经包含 RemoteLoggingInterceptor，跳过修改"
    else
        log_info "修改 HookUtil.build() 方法..."

        # 尝试在 PhonePeInterceptor 之后添加
        if grep -q "PhonePeInterceptor" "$HOOKUTIL_SMALI"; then
            sed -i '' '/PhonePeInterceptor.*addInterceptor/a\
    \
    # Add RemoteLoggingInterceptor\
    new-instance v2, Lcom\/httpinterceptor\/interceptor\/RemoteLoggingInterceptor;\
    invoke-direct {v2}, Lcom\/httpinterceptor\/interceptor\/RemoteLoggingInterceptor;-><init>()V\
    invoke-virtual {p0, v2}, Lokhttp3\/OkHttpClient\$Builder;->addInterceptor(Lokhttp3\/Interceptor;)Lokhttp3\/OkHttpClient\$Builder;\
' "$HOOKUTIL_SMALI"
            log_info "已在 PhonePeInterceptor 后添加 RemoteLoggingInterceptor"
        else
            log_warn "未找到 PhonePeInterceptor 引用，请手动修改 HookUtil.smali"
        fi
    fi
fi

log_step "4. 设置日志服务器地址"

# 如果用户指定了自定义服务器地址，更新 smali 文件
if [ "$LOG_SERVER_URL" != "http://127.0.0.1:8088/api/log" ]; then
    log_info "更新日志服务器地址为: $LOG_SERVER_URL"

    # 转义 URL 中的特殊字符
    ESCAPED_URL=$(echo "$LOG_SERVER_URL" | sed 's/\//\\\//g')

    for f in "$INTERCEPTOR_SMALI_DIR"/RemoteLoggingInterceptor*.smali; do
        [ -f "$f" ] || continue
        sed -i '' "s/http:\/\/127.0.0.1:8088\/api\/log/$ESCAPED_URL/g" "$f"
    done
fi

log_step "5. 验证文件"

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

# 清理临时目录
rm -rf "$TEMP_DIR"

log_step "完成"

echo ""
echo -e "${GREEN}HTTPS 拦截器补丁已应用!${NC}"
echo ""
echo "日志服务器地址: $LOG_SERVER_URL"
echo ""
echo "下一步:"
echo "  1. 重新打包: apktool b $TARGET_DIR -o patched.apk"
echo "  2. 对齐签名 (使用现有脚本)"
echo "  3. 启动日志服务器:"
echo "     cd $PROJECT_ROOT/src/log_server && npm install && npm start"
echo "  4. 设置端口转发:"
echo "     adb reverse tcp:8088 tcp:8088"
echo "  5. 安装 APK 并测试"
echo "  6. 在浏览器打开 http://localhost:8088 查看日志"
