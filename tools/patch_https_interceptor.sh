#!/bin/bash

#######################################################################
# APK HTTPS 拦截器补丁脚本
#
# 功能：将 HTTPS 请求拦截器注入到合并后的 APK，记录所有网络请求
#
# 原理：
# 1. 编译拦截器 Java 代码为 smali
# 2. 复制拦截器 smali 到目标 APK
# 3. 修改 HookUtil 来注入拦截器到 OkHttpClient
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
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
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

log_step "2. 创建拦截器 smali 代码"

# 创建临时目录
TEMP_DIR=$(mktemp -d)
SMALI_OUT="$TEMP_DIR/smali"
mkdir -p "$SMALI_OUT"

log_info "临时目录: $TEMP_DIR"

# 创建拦截器 smali 目录
INTERCEPTOR_SMALI_DIR="$TARGET_DIR/smali_classes14/com/httpinterceptor/interceptor"
HOOK_SMALI_DIR="$TARGET_DIR/smali_classes14/com/httpinterceptor/hook"
mkdir -p "$INTERCEPTOR_SMALI_DIR"
mkdir -p "$HOOK_SMALI_DIR"

# 直接创建 smali 文件（因为编译依赖 OkHttp 等库比较复杂）
log_info "生成 RemoteLoggingInterceptor.smali..."

cat > "$INTERCEPTOR_SMALI_DIR/RemoteLoggingInterceptor.smali" << 'SMALI_EOF'
.class public Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor;
.super Ljava/lang/Object;
.source "RemoteLoggingInterceptor.java"

# implements Interceptor
.implements Lokhttp3/Interceptor;

# static fields
.field private static TAG:Ljava/lang/String; = "HttpInterceptor"
.field private static logServerUrl:Ljava/lang/String;

# instance fields
.field private final executor:Ljava/util/concurrent/ExecutorService;
.field private final dateFormat:Ljava/text/SimpleDateFormat;

# direct methods
.method static constructor <clinit>()V
    .locals 1

    const-string v0, "http://127.0.0.1:8088/api/log"
    sput-object v0, Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor;->logServerUrl:Ljava/lang/String;

    return-void
.end method

.method public constructor <init>()V
    .locals 3

    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    # Create executor
    const/4 v0, 0x2
    invoke-static {v0}, Ljava/util/concurrent/Executors;->newFixedThreadPool(I)Ljava/util/concurrent/ExecutorService;
    move-result-object v0
    iput-object v0, p0, Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor;->executor:Ljava/util/concurrent/ExecutorService;

    # Create date format
    new-instance v0, Ljava/text/SimpleDateFormat;
    const-string v1, "yyyy-MM-dd HH:mm:ss.SSS"
    invoke-static {}, Ljava/util/Locale;->getDefault()Ljava/util/Locale;
    move-result-object v2
    invoke-direct {v0, v1, v2}, Ljava/text/SimpleDateFormat;-><init>(Ljava/lang/String;Ljava/util/Locale;)V
    iput-object v0, p0, Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor;->dateFormat:Ljava/text/SimpleDateFormat;

    return-void
.end method

.method public static setLogServerUrl(Ljava/lang/String;)V
    .locals 2
    .param p0, "url"

    sput-object p0, Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor;->logServerUrl:Ljava/lang/String;

    const-string v0, "HttpInterceptor"
    new-instance v1, Ljava/lang/StringBuilder;
    invoke-direct {v1}, Ljava/lang/StringBuilder;-><init>()V
    const-string v1, "Log server URL set to: "
    invoke-virtual {v1, p0}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v1}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;
    move-result-object v1
    invoke-static {v0, v1}, Landroid/util/Log;->i(Ljava/lang/String;Ljava/lang/String;)I

    return-void
.end method

# Main intercept method
.method public intercept(Lokhttp3/Interceptor$Chain;)Lokhttp3/Response;
    .locals 15
    .param p1, "chain"
    .annotation system Ldalvik/annotation/Throws;
        value = {
            Ljava/io/IOException;
        }
    .end annotation

    # Get request
    invoke-interface {p1}, Lokhttp3/Interceptor$Chain;->request()Lokhttp3/Request;
    move-result-object v0

    # Get start time
    invoke-static {}, Ljava/lang/System;->nanoTime()J
    move-result-wide v1

    # Get timestamp
    iget-object v3, p0, Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor;->dateFormat:Ljava/text/SimpleDateFormat;
    new-instance v4, Ljava/util/Date;
    invoke-direct {v4}, Ljava/util/Date;-><init>()V
    invoke-virtual {v3, v4}, Ljava/text/SimpleDateFormat;->format(Ljava/util/Date;)Ljava/lang/String;
    move-result-object v3

    # Create JSON log object
    new-instance v4, Lorg/json/JSONObject;
    invoke-direct {v4}, Lorg/json/JSONObject;-><init>()V

    :try_start_0
    # Put timestamp
    const-string v5, "timestamp"
    invoke-virtual {v4, v5, v3}, Lorg/json/JSONObject;->put(Ljava/lang/String;Ljava/lang/Object;)Lorg/json/JSONObject;

    # Put URL
    const-string v5, "url"
    invoke-virtual {v0}, Lokhttp3/Request;->url()Lokhttp3/HttpUrl;
    move-result-object v6
    invoke-virtual {v6}, Lokhttp3/HttpUrl;->toString()Ljava/lang/String;
    move-result-object v6
    invoke-virtual {v4, v5, v6}, Lorg/json/JSONObject;->put(Ljava/lang/String;Ljava/lang/Object;)Lorg/json/JSONObject;

    # Put method
    const-string v5, "method"
    invoke-virtual {v0}, Lokhttp3/Request;->method()Ljava/lang/String;
    move-result-object v6
    invoke-virtual {v4, v5, v6}, Lorg/json/JSONObject;->put(Ljava/lang/String;Ljava/lang/Object;)Lorg/json/JSONObject;

    # Put request headers as string
    const-string v5, "request_headers"
    invoke-virtual {v0}, Lokhttp3/Request;->headers()Lokhttp3/Headers;
    move-result-object v6
    invoke-virtual {v6}, Lokhttp3/Headers;->toString()Ljava/lang/String;
    move-result-object v6
    invoke-virtual {v4, v5, v6}, Lorg/json/JSONObject;->put(Ljava/lang/String;Ljava/lang/Object;)Lorg/json/JSONObject;
    :try_end_0
    .catch Lorg/json/JSONException; {:try_start_0 .. :try_end_0} :catch_0

    goto :goto_0

    :catch_0
    move-exception v5

    :goto_0
    # Proceed with request
    invoke-interface {p1, v0}, Lokhttp3/Interceptor$Chain;->proceed(Lokhttp3/Request;)Lokhttp3/Response;
    move-result-object v5

    # Calculate duration
    invoke-static {}, Ljava/lang/System;->nanoTime()J
    move-result-wide v6
    sub-long/2addr v6, v1
    const-wide v8, 0xf4240L
    div-long/2addr v6, v8

    :try_start_1
    # Put duration
    const-string v8, "duration_ms"
    invoke-virtual {v4, v8, v6, v7}, Lorg/json/JSONObject;->put(Ljava/lang/String;J)Lorg/json/JSONObject;

    # Put status code
    const-string v8, "status_code"
    invoke-virtual {v5}, Lokhttp3/Response;->code()I
    move-result v9
    invoke-virtual {v4, v8, v9}, Lorg/json/JSONObject;->put(Ljava/lang/String;I)Lorg/json/JSONObject;

    # Put status message
    const-string v8, "status_message"
    invoke-virtual {v5}, Lokhttp3/Response;->message()Ljava/lang/String;
    move-result-object v9
    invoke-virtual {v4, v8, v9}, Lorg/json/JSONObject;->put(Ljava/lang/String;Ljava/lang/Object;)Lorg/json/JSONObject;

    # Put response headers
    const-string v8, "response_headers"
    invoke-virtual {v5}, Lokhttp3/Response;->headers()Lokhttp3/Headers;
    move-result-object v9
    invoke-virtual {v9}, Lokhttp3/Headers;->toString()Ljava/lang/String;
    move-result-object v9
    invoke-virtual {v4, v8, v9}, Lorg/json/JSONObject;->put(Ljava/lang/String;Ljava/lang/Object;)Lorg/json/JSONObject;
    :try_end_1
    .catch Lorg/json/JSONException; {:try_start_1 .. :try_end_1} :catch_1

    goto :goto_1

    :catch_1
    move-exception v8

    :goto_1
    # Log to console
    const-string v8, "HttpInterceptor"
    new-instance v9, Ljava/lang/StringBuilder;
    invoke-direct {v9}, Ljava/lang/StringBuilder;-><init>()V
    const-string v10, "["
    invoke-virtual {v9, v10}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v9, v3}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    const-string v10, "] "
    invoke-virtual {v9, v10}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v0}, Lokhttp3/Request;->method()Ljava/lang/String;
    move-result-object v10
    invoke-virtual {v9, v10}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    const-string v10, " "
    invoke-virtual {v9, v10}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v0}, Lokhttp3/Request;->url()Lokhttp3/HttpUrl;
    move-result-object v10
    invoke-virtual {v9, v10}, Ljava/lang/StringBuilder;->append(Ljava/lang/Object;)Ljava/lang/StringBuilder;
    const-string v10, " - "
    invoke-virtual {v9, v10}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v5}, Lokhttp3/Response;->code()I
    move-result v10
    invoke-virtual {v9, v10}, Ljava/lang/StringBuilder;->append(I)Ljava/lang/StringBuilder;
    invoke-virtual {v9}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;
    move-result-object v9
    invoke-static {v8, v9}, Landroid/util/Log;->d(Ljava/lang/String;Ljava/lang/String;)I

    # Send log async
    invoke-direct {p0, v4}, Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor;->sendLogAsync(Lorg/json/JSONObject;)V

    return-object v5
.end method

# Send log asynchronously
.method private sendLogAsync(Lorg/json/JSONObject;)V
    .locals 2
    .param p1, "logData"

    iget-object v0, p0, Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor;->executor:Ljava/util/concurrent/ExecutorService;

    new-instance v1, Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor$1;
    invoke-direct {v1, p0, p1}, Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor$1;-><init>(Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor;Lorg/json/JSONObject;)V

    invoke-interface {v0, v1}, Ljava/util/concurrent/ExecutorService;->submit(Ljava/lang/Runnable;)Ljava/util/concurrent/Future;

    return-void
.end method
SMALI_EOF

# 创建内部类 (Runnable)
cat > "$INTERCEPTOR_SMALI_DIR/RemoteLoggingInterceptor\$1.smali" << 'SMALI_EOF'
.class Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor$1;
.super Ljava/lang/Object;
.source "RemoteLoggingInterceptor.java"

# implements Runnable
.implements Ljava/lang/Runnable;

# enclosing method
.annotation system Ldalvik/annotation/EnclosingMethod;
    value = Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor;->sendLogAsync(Lorg/json/JSONObject;)V
.end annotation

# inner class
.annotation system Ldalvik/annotation/InnerClass;
    accessFlags = 0x0
    name = null
.end annotation

# instance fields
.field final synthetic this$0:Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor;
.field final synthetic val$logData:Lorg/json/JSONObject;

# direct methods
.method constructor <init>(Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor;Lorg/json/JSONObject;)V
    .locals 0

    iput-object p1, p0, Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor$1;->this$0:Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor;
    iput-object p2, p0, Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor$1;->val$logData:Lorg/json/JSONObject;

    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    return-void
.end method

.method public run()V
    .locals 8

    const/4 v0, 0x0

    :try_start_0
    # Get server URL
    sget-object v1, Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor;->logServerUrl:Ljava/lang/String;

    # Create URL
    new-instance v2, Ljava/net/URL;
    invoke-direct {v2, v1}, Ljava/net/URL;-><init>(Ljava/lang/String;)V

    # Open connection
    invoke-virtual {v2}, Ljava/net/URL;->openConnection()Ljava/net/URLConnection;
    move-result-object v0
    check-cast v0, Ljava/net/HttpURLConnection;

    # Configure connection
    const-string v3, "POST"
    invoke-virtual {v0, v3}, Ljava/net/HttpURLConnection;->setRequestMethod(Ljava/lang/String;)V

    const-string v3, "Content-Type"
    const-string v4, "application/json; charset=utf-8"
    invoke-virtual {v0, v3, v4}, Ljava/net/HttpURLConnection;->setRequestProperty(Ljava/lang/String;Ljava/lang/String;)V

    const/16 v3, 0x1388
    invoke-virtual {v0, v3}, Ljava/net/HttpURLConnection;->setConnectTimeout(I)V
    invoke-virtual {v0, v3}, Ljava/net/HttpURLConnection;->setReadTimeout(I)V

    const/4 v3, 0x1
    invoke-virtual {v0, v3}, Ljava/net/HttpURLConnection;->setDoOutput(Z)V

    # Get body bytes
    iget-object v3, p0, Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor$1;->val$logData:Lorg/json/JSONObject;
    invoke-virtual {v3}, Lorg/json/JSONObject;->toString()Ljava/lang/String;
    move-result-object v3
    sget-object v4, Ljava/nio/charset/StandardCharsets;->UTF_8:Ljava/nio/charset/Charset;
    invoke-virtual {v3, v4}, Ljava/lang/String;->getBytes(Ljava/nio/charset/Charset;)[B
    move-result-object v3

    # Set content length
    array-length v4, v3
    invoke-virtual {v0, v4}, Ljava/net/HttpURLConnection;->setFixedLengthStreamingMode(I)V

    # Write body
    invoke-virtual {v0}, Ljava/net/HttpURLConnection;->getOutputStream()Ljava/io/OutputStream;
    move-result-object v4
    invoke-virtual {v4, v3}, Ljava/io/OutputStream;->write([B)V
    invoke-virtual {v4}, Ljava/io/OutputStream;->close()V

    # Get response code
    invoke-virtual {v0}, Ljava/net/HttpURLConnection;->getResponseCode()I
    move-result v4

    const/16 v5, 0xc8
    if-eq v4, v5, :cond_0

    const-string v5, "HttpInterceptor"
    new-instance v6, Ljava/lang/StringBuilder;
    invoke-direct {v6}, Ljava/lang/StringBuilder;-><init>()V
    const-string v7, "Log server returned: "
    invoke-virtual {v6, v7}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v6, v4}, Ljava/lang/StringBuilder;->append(I)Ljava/lang/StringBuilder;
    invoke-virtual {v6}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;
    move-result-object v6
    invoke-static {v5, v6}, Landroid/util/Log;->w(Ljava/lang/String;Ljava/lang/String;)I
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0
    .catchall {:try_start_0 .. :try_end_0} :catchall_0

    :cond_0
    goto :goto_0

    :catch_0
    move-exception v1

    :try_start_1
    const-string v2, "HttpInterceptor"
    new-instance v3, Ljava/lang/StringBuilder;
    invoke-direct {v3}, Ljava/lang/StringBuilder;-><init>()V
    const-string v4, "Failed to send log: "
    invoke-virtual {v3, v4}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v1}, Ljava/lang/Exception;->getMessage()Ljava/lang/String;
    move-result-object v4
    invoke-virtual {v3, v4}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v3}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;
    move-result-object v3
    invoke-static {v2, v3}, Landroid/util/Log;->w(Ljava/lang/String;Ljava/lang/String;)I
    :try_end_1
    .catchall {:try_start_1 .. :try_end_1} :catchall_0

    :goto_0
    # Disconnect
    if-eqz v0, :cond_1
    invoke-virtual {v0}, Ljava/net/HttpURLConnection;->disconnect()V

    :cond_1
    return-void

    :catchall_0
    move-exception v1
    if-eqz v0, :cond_2
    invoke-virtual {v0}, Ljava/net/HttpURLConnection;->disconnect()V
    :cond_2
    throw v1
.end method
SMALI_EOF

log_info "已生成 RemoteLoggingInterceptor smali 文件"

log_step "3. 修改 HookUtil 注入拦截器"

# 查找 HookUtil.smali
HOOKUTIL_SMALI="$TARGET_DIR/smali_classes14/com/PhonePeTweak/Def/HookUtil.smali"

if [ ! -f "$HOOKUTIL_SMALI" ]; then
    log_warn "未找到 HookUtil.smali，尝试搜索..."
    HOOKUTIL_SMALI=$(find "$TARGET_DIR" -name "HookUtil.smali" | head -1)
fi

if [ -z "$HOOKUTIL_SMALI" ] || [ ! -f "$HOOKUTIL_SMALI" ]; then
    log_error "找不到 HookUtil.smali"
    log_warn "将创建独立的 Hook 入口点..."

    # 创建独立的 Hook 入口
    mkdir -p "$TARGET_DIR/smali_classes14/com/httpinterceptor/hook"

    cat > "$TARGET_DIR/smali_classes14/com/httpinterceptor/hook/InterceptorInjector.smali" << 'INJECTOR_EOF'
.class public Lcom/httpinterceptor/hook/InterceptorInjector;
.super Ljava/lang/Object;
.source "InterceptorInjector.java"

.field private static TAG:Ljava/lang/String; = "InterceptorInjector"
.field private static initialized:Z

.method static constructor <clinit>()V
    .locals 1
    const/4 v0, 0x0
    sput-boolean v0, Lcom/httpinterceptor/hook/InterceptorInjector;->initialized:Z
    return-void
.end method

.method public constructor <init>()V
    .locals 0
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    return-void
.end method

# Hook OkHttpClient.Builder.build()
.method public static hookBuild(Lokhttp3/OkHttpClient$Builder;)Lokhttp3/OkHttpClient;
    .locals 3
    .param p0, "builder"

    sget-boolean v0, Lcom/httpinterceptor/hook/InterceptorInjector;->initialized:Z
    if-nez v0, :cond_0

    const-string v0, "InterceptorInjector"
    const-string v1, "Initializing HTTP interceptor..."
    invoke-static {v0, v1}, Landroid/util/Log;->i(Ljava/lang/String;Ljava/lang/String;)I

    const/4 v0, 0x1
    sput-boolean v0, Lcom/httpinterceptor/hook/InterceptorInjector;->initialized:Z

    :cond_0
    # Add RemoteLoggingInterceptor
    new-instance v0, Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor;
    invoke-direct {v0}, Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor;-><init>()V
    invoke-virtual {p0, v0}, Lokhttp3/OkHttpClient$Builder;->addInterceptor(Lokhttp3/Interceptor;)Lokhttp3/OkHttpClient$Builder;

    const-string v0, "InterceptorInjector"
    const-string v1, "RemoteLoggingInterceptor injected"
    invoke-static {v0, v1}, Landroid/util/Log;->d(Ljava/lang/String;Ljava/lang/String;)I

    # Build and return
    invoke-virtual {p0}, Lokhttp3/OkHttpClient$Builder;->build()Lokhttp3/OkHttpClient;
    move-result-object v0

    return-object v0
.end method
INJECTOR_EOF

    log_info "已创建 InterceptorInjector.smali"
else
    log_info "找到 HookUtil: $HOOKUTIL_SMALI"

    # 备份
    cp "$HOOKUTIL_SMALI" "$HOOKUTIL_SMALI.bak"

    # 检查是否已经注入过
    if grep -q "RemoteLoggingInterceptor" "$HOOKUTIL_SMALI"; then
        log_warn "HookUtil 已经包含 RemoteLoggingInterceptor，跳过修改"
    else
        log_info "修改 HookUtil.build() 方法..."

        # 在 build 方法中查找添加 PhonePeInterceptor 的位置，在其后添加 RemoteLoggingInterceptor
        # 使用 sed 在 PhonePeInterceptor 添加后插入新代码

        INJECT_SMALI='
    # Add RemoteLoggingInterceptor
    new-instance v2, Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor;
    invoke-direct {v2}, Lcom/httpinterceptor/interceptor/RemoteLoggingInterceptor;-><init>()V
    invoke-virtual {p0, v2}, Lokhttp3/OkHttpClient$Builder;->addInterceptor(Lokhttp3/Interceptor;)Lokhttp3/OkHttpClient$Builder;
'

        # 尝试在 PhonePeInterceptor 之后添加
        if grep -q "PhonePeInterceptor" "$HOOKUTIL_SMALI"; then
            sed -i '' '/PhonePeInterceptor.*addInterceptor/a\
    \
    # Add RemoteLoggingInterceptor\
    new-instance v2, Lcom\/httpinterceptor\/interceptor\/RemoteLoggingInterceptor;\
    invoke-direct {v2}, Lcom\/httpinterceptor\/interceptor\/RemoteLoggingInterceptor;-><init>()V\
    invoke-virtual {p0, v2}, Lokhttp3\/OkHttpClient$Builder;->addInterceptor(Lokhttp3\/Interceptor;)Lokhttp3\/OkHttpClient$Builder;\
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

    sed -i '' "s/http:\/\/127.0.0.1:8088\/api\/log/$ESCAPED_URL/g" \
        "$INTERCEPTOR_SMALI_DIR/RemoteLoggingInterceptor.smali"
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

check_file "$INTERCEPTOR_SMALI_DIR/RemoteLoggingInterceptor.smali"
check_file "$INTERCEPTOR_SMALI_DIR/RemoteLoggingInterceptor\$1.smali"

if [ -f "$TARGET_DIR/smali_classes14/com/httpinterceptor/hook/InterceptorInjector.smali" ]; then
    check_file "$TARGET_DIR/smali_classes14/com/httpinterceptor/hook/InterceptorInjector.smali"
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
