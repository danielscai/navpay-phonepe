#!/bin/bash

#######################################################################
# HTTPS interceptor smali artifact builder
#
# 功能：直接将拦截器相关的最小 Java 源码编译为 smali 产物，
#      供 injection 阶段直接消费。
#
# 产物：
#   build/smali/com/httpinterceptor/interceptor/RemoteLoggingInterceptor*.smali
#   build/smali/com/httpinterceptor/interceptor/LogSender*.smali
#   build/smali/com/httpinterceptor/hook/HookUtil*.smali
#######################################################################

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "\n${BLUE}==== $1 ====${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODULE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$MODULE_DIR/../../.." && pwd)"
BUILD_DIR="$MODULE_DIR/build"
CLASSES_DIR="$BUILD_DIR/classes"
DEX_DIR="$BUILD_DIR/dex"
OUTPUT_DIR="$BUILD_DIR/smali"
SRC_DIR="$MODULE_DIR/app/src/main/java"
APP_BUILD_GRADLE="$MODULE_DIR/app/build.gradle"

OKHTTP_VERSION="4.10.0"
OKIO_VERSION="3.0.0"
# okhttp 4.10.0 metadata points to kotlin-stdlib 1.6.20, but the local cache in
# this workspace only contains newer stdlib artifacts. Pin one explicit version
# instead of scanning "latest", so the build remains deterministic.
KOTLIN_STDLIB_VERSION="1.8.22"

JAVA_SOURCES=(
    "$SRC_DIR/com/httpinterceptor/interceptor/RemoteLoggingInterceptor.java"
    "$SRC_DIR/com/httpinterceptor/interceptor/LogSender.java"
    "$SRC_DIR/com/httpinterceptor/interceptor/LogEndpointResolver.java"
    "$SRC_DIR/com/httpinterceptor/hook/HookUtil.java"
)

ANDROID_SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
ANDROID_JAR="${ANDROID_JAR:-$ANDROID_SDK/platforms/android-36/android.jar}"

find_exact_jar() {
    local description="$1"
    local group_path="$2"
    local artifact="$3"
    local version="$4"
    local root="$HOME/.gradle/caches/modules-2/files-2.1/$group_path/$artifact/$version"
    local found=""

    found=$(find "$root" -type f -name "$artifact-$version.jar" 2>/dev/null | sort | head -1 || true)
    if [ -z "$found" ]; then
        log_error "未找到 $description ($artifact:$version)"
        exit 1
    fi
    echo "$found"
}

if [ ! -d "$SRC_DIR" ]; then
    log_error "源码目录不存在: $SRC_DIR"
    exit 1
fi

if [ ! -f "$ANDROID_JAR" ]; then
    ANDROID_JAR=$(find "$ANDROID_SDK/platforms" -mindepth 2 -maxdepth 2 -name android.jar 2>/dev/null | sort -V | tail -1 || true)
fi

if [ -z "${ANDROID_JAR:-}" ] || [ ! -f "$ANDROID_JAR" ]; then
    log_error "未找到 android.jar"
    exit 1
fi

BUILD_TOOLS_DIR="${BUILD_TOOLS_DIR:-$(find "$ANDROID_SDK/build-tools" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -1 || true)}"
if [ -z "${BUILD_TOOLS_DIR:-}" ] || [ ! -x "$BUILD_TOOLS_DIR/d8" ]; then
    log_error "未找到 d8，请确认 Android SDK build-tools 已安装"
    exit 1
fi

if command -v baksmali >/dev/null 2>&1; then
    BAKSMALI_CMD=(baksmali d)
else
    BAKSMALI_JAR=""
    for candidate in \
        "$PROJECT_ROOT/src/apk/signature_bypass/libs/baksmali.jar" \
        "$PROJECT_ROOT/src/apk/phonepehelper/libs/baksmali.jar"; do
        if [ -f "$candidate" ]; then
            BAKSMALI_JAR="$candidate"
            break
        fi
    done
    if [ -z "$BAKSMALI_JAR" ]; then
        log_error "未找到 baksmali，可执行文件或本地 jar 均缺失"
        exit 1
    fi
    BAKSMALI_CMD=(java -jar "$BAKSMALI_JAR" d)
fi

if [ ! -f "$APP_BUILD_GRADLE" ]; then
    log_error "未找到 app/build.gradle: $APP_BUILD_GRADLE"
    exit 1
fi

OKHTTP_JAR=$(find_exact_jar "okhttp" "com.squareup.okhttp3" "okhttp" "$OKHTTP_VERSION")
OKIO_JAR=$(find_exact_jar "okio-jvm" "com.squareup.okio" "okio-jvm" "$OKIO_VERSION")
KOTLIN_STDLIB_JAR=$(find_exact_jar "kotlin-stdlib" "org.jetbrains.kotlin" "kotlin-stdlib" "$KOTLIN_STDLIB_VERSION")

CLASSPATH=(
    "$ANDROID_JAR"
    "$OKHTTP_JAR"
    "$OKIO_JAR"
    "$KOTLIN_STDLIB_JAR"
)

D8_CLASSPATH_ARGS=()
for jar in "${CLASSPATH[@]}"; do
    if [ "$jar" != "$ANDROID_JAR" ]; then
        D8_CLASSPATH_ARGS+=(--classpath "$jar")
    fi
done

log_step "准备构建环境"
log_info "Android JAR: $ANDROID_JAR"
log_info "d8: $BUILD_TOOLS_DIR/d8"
log_info "okhttp ($OKHTTP_VERSION): $OKHTTP_JAR"
log_info "okio-jvm ($OKIO_VERSION): $OKIO_JAR"
log_info "kotlin-stdlib ($KOTLIN_STDLIB_VERSION): $KOTLIN_STDLIB_JAR"

rm -rf "$BUILD_DIR"
mkdir -p "$CLASSES_DIR" "$DEX_DIR" "$OUTPUT_DIR"

log_step "编译 HTTPS 拦截器源码"
for source in "${JAVA_SOURCES[@]}"; do
    if [ ! -f "$source" ]; then
        log_error "缺少源码文件: $source"
        exit 1
    fi
done

javac -encoding UTF-8 -source 1.8 -target 1.8 \
    -cp "$(IFS=:; echo "${CLASSPATH[*]}")" \
    -d "$CLASSES_DIR" \
    "${JAVA_SOURCES[@]}"

log_step "转换为 dex"
CLASS_FILES=()
while IFS= read -r class_file; do
    [ -n "$class_file" ] || continue
    CLASS_FILES+=("$class_file")
done < <(find "$CLASSES_DIR" -name "*.class" | sort)

if [ "${#CLASS_FILES[@]}" -eq 0 ]; then
    log_error "未生成 class 文件"
    exit 1
fi

"$BUILD_TOOLS_DIR/d8" \
    --lib "$ANDROID_JAR" \
    "${D8_CLASSPATH_ARGS[@]}" \
    --output "$DEX_DIR" \
    "${CLASS_FILES[@]}"

if [ ! -f "$DEX_DIR/classes.dex" ]; then
    log_error "未生成 classes.dex"
    exit 1
fi

log_step "反编译为 smali"
"${BAKSMALI_CMD[@]}" "$DEX_DIR/classes.dex" -o "$OUTPUT_DIR"

if [ ! -f "$OUTPUT_DIR/com/httpinterceptor/interceptor/RemoteLoggingInterceptor.smali" ]; then
    log_error "RemoteLoggingInterceptor.smali 生成失败"
    exit 1
fi
if [ ! -f "$OUTPUT_DIR/com/httpinterceptor/interceptor/LogSender.smali" ]; then
    log_error "LogSender.smali 生成失败"
    exit 1
fi
if [ ! -f "$OUTPUT_DIR/com/httpinterceptor/hook/HookUtil.smali" ]; then
    log_error "HookUtil.smali 生成失败"
    exit 1
fi

log_step "完成"
log_info "smali 产物已生成: $OUTPUT_DIR"
