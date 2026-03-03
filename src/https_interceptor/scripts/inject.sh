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
MODULE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$MODULE_DIR/../.." && pwd)"
PROJECT_ROOT="$ROOT_DIR"
INTERCEPTOR_SRC="$MODULE_DIR"
DEFAULT_TARGET_DIR="$ROOT_DIR/temp/phonepe_merged/decompiled/base"
SKIP_BUILD=0
TARGET_DIR=""

usage() {
    echo "用法: $0 [--skip-build] <decompiled_dir>"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --skip-build)
            SKIP_BUILD=1
            shift
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

TARGET_DIR="${TARGET_DIR:-$DEFAULT_TARGET_DIR}"

# Java/Android 配置
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk}"
export PATH="$JAVA_HOME/bin:$PATH"
ANDROID_SDK="$HOME/Library/Android/sdk"
ANDROID_JAR="$ANDROID_SDK/platforms/android-36/android.jar"

if [ ! -d "$TARGET_DIR" ]; then
    log_error "目标目录不存在: $TARGET_DIR"
    echo ""
    usage
    echo ""
    echo "示例:"
    echo "  $0 ./merged_output/decompiled/base"
    echo "  $0 --skip-build ./merged_output/decompiled/base"
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

# 清理旧的 com/httpinterceptor，避免重复类导致旧版本被加载
while IFS= read -r d; do
    rm -rf "$d"
done < <(find "$TARGET_DIR" -type d -path "*/com/httpinterceptor")

# 创建拦截器/HookUtil smali 目录
INTERCEPTOR_SMALI_DIR="$INJECT_SMALI_DIR/com/httpinterceptor/interceptor"
HOOK_SMALI_DIR="$INJECT_SMALI_DIR/com/httpinterceptor/hook"
mkdir -p "$INTERCEPTOR_SMALI_DIR" "$HOOK_SMALI_DIR"

# 从 https_interceptor demo APK 提取 smali
DEMO_APK="$MODULE_DIR/app/build/outputs/apk/debug/app-debug.apk"
if [ "$SKIP_BUILD" -eq 1 ] && [ -f "$DEMO_APK" ]; then
    log_info "启用 --skip-build，复用现有 demo APK: $DEMO_APK"
else
    if [ "$SKIP_BUILD" -eq 1 ]; then
        log_warn "启用 --skip-build 但 demo APK 不存在，回退到构建"
    else
        log_info "强制构建 demo APK..."
    fi
    (cd "$MODULE_DIR" && ./build_and_install.sh build)
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

log_info "从 demo APK 提取 LogSender* smali"
found=0
while IFS= read -r f; do
    cp "$f" "$INTERCEPTOR_SMALI_DIR/"
    found=1
done < <(find "$APP_DECOMPILED" -path "*/com/httpinterceptor/interceptor/LogSender*.smali")

if [ "$found" -ne 1 ]; then
    log_error "未找到 LogSender smali 文件"
    exit 1
fi

log_info "已复制 LogSender smali 文件"

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

log_step "3.1 禁用 OkHttp 敏感 Header 脱敏"

# 查找 Util.smali 文件
UTIL_SMALI=$(find "$TARGET_DIR" -path "*/okhttp3/internal/Util.smali" | head -1)
if [ -z "$UTIL_SMALI" ] || [ ! -f "$UTIL_SMALI" ]; then
    log_warn "找不到 okhttp3/internal/Util.smali，跳过敏感 header 脱敏禁用"
else
    # 检查是否已修改（方法体只有 return 0x0）
    if rg -q 'const/4 v0, 0x0\s+return v0\s+\.end method' "$UTIL_SMALI"; then
        log_warn "敏感 header 检查方法已被 patch，跳过修改"
    else
        log_info "查找并修改敏感 header 检查方法..."

        python3 - "$UTIL_SMALI" <<'PYCODE'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text()

# The method name is obfuscated (e.g., "r" instead of "isSensitiveHeader")
# We find it by looking for a method that:
# 1. Takes String and returns boolean: (Ljava/lang/String;)Z
# 2. Contains "Authorization" string check
# Pattern matches: .method public static final X(Ljava/lang/String;)Z ... "Authorization" ... .end method
pattern = re.compile(
    r'(?ms)^(\.method public static final )(\w+)(\(Ljava/lang/String;\)Z.*?const-string[^\n]+"Authorization".*?^\.end method)\s*',
)

match = pattern.search(text)
if not match:
    print("Warning: Could not find isSensitiveHeader method (obfuscated) to replace", file=sys.stderr)
    sys.exit(0)  # Non-fatal, continue

method_name = match.group(2)
print(f"Found sensitive header check method: Util.{method_name}()")

# Replace with a simple method that always returns false
replacement = f"""\
.method public static final {method_name}(Ljava/lang/String;)Z
    .locals 1
    .param p0    # Ljava/lang/String;
        .annotation build Lorg/jetbrains/annotations/NotNull;
        .end annotation
    .end param

    # Always return false to disable header redaction
    # This allows full logging of Authorization, Cookie, Proxy-Authorization, Set-Cookie
    const/4 v0, 0x0

    return v0
.end method
"""

new_text = pattern.sub(replacement, text, count=1)
path.write_text(new_text)
print(f"Successfully patched Util.{method_name}() to always return false")
PYCODE
    fi
fi

log_step "3.2 允许本地明文日志上报"

MANIFEST_FILE="$TARGET_DIR/AndroidManifest.xml"
NSC_DIR="$TARGET_DIR/res/xml"
NSC_FILE="$NSC_DIR/network_security_config.xml"

if [ -f "$MANIFEST_FILE" ]; then
  python3 - "$MANIFEST_FILE" <<'PYCODE'
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
ns_android = "http://schemas.android.com/apk/res/android"
ET.register_namespace("android", ns_android)
tree = ET.parse(path)
root = tree.getroot()
app = root.find("application")
if app is not None:
    key_clear = f"{{{ns_android}}}usesCleartextTraffic"
    key_nsc = f"{{{ns_android}}}networkSecurityConfig"
    if app.get(key_clear) != "true":
        app.set(key_clear, "true")
    if app.get(key_nsc) is None:
        app.set(key_nsc, "@xml/network_security_config")
tree.write(path, encoding="utf-8", xml_declaration=True)
PYCODE
  log_info "已设置 usesCleartextTraffic + networkSecurityConfig"
else
  log_warn "AndroidManifest.xml 未找到，跳过 cleartext 配置"
fi

mkdir -p "$NSC_DIR"
if [ ! -f "$NSC_FILE" ]; then
  cat <<'XML' > "$NSC_FILE"
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true" />
</network-security-config>
XML
  log_info "已写入 network_security_config.xml"
else
  log_warn "network_security_config.xml 已存在，未覆盖"
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
