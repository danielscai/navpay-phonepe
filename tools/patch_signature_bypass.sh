#!/bin/bash

#######################################################################
# APK 签名绕过补丁脚本
#
# 功能：将签名绕过代码注入到合并后的 APK，使其能够通过自检
#
# 原理：
# 1. 复制 Pine Hook 框架和签名伪造代码
# 2. 修改 PhonePeApplication 初始化 Hook
# 3. 绕过服务器响应校验
#
# 用法：./patch_signature_bypass.sh <decompiled_dir>
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
PEV70_DIR="/Users/danielscai/Documents/印度支付/apk包-研究/pev70_apktool"
TARGET_DIR="${1:-/Users/danielscai/Documents/印度支付/apk包-研究/merge_test_output/decompiled/base}"

if [ ! -d "$TARGET_DIR" ]; then
    log_error "目标目录不存在: $TARGET_DIR"
    exit 1
fi

log_step "1. 复制 Pine Hook 框架"

# 创建目标目录
mkdir -p "$TARGET_DIR/smali_classes14/top/canyie"
mkdir -p "$TARGET_DIR/smali_classes14/com/myairtelapp"
mkdir -p "$TARGET_DIR/smali_classes14/com/PhonePeTweak"
mkdir -p "$TARGET_DIR/smali_classes14/com/zerolog"
mkdir -p "$TARGET_DIR/smali_classes14/com/tweakUtil"

# 复制 Pine 框架
if [ -d "$PEV70_DIR/smali_classes14/top/canyie/pine" ]; then
    cp -r "$PEV70_DIR/smali_classes14/top/canyie/pine" "$TARGET_DIR/smali_classes14/top/canyie/"
    log_info "已复制 Pine 框架"
else
    log_error "Pine 框架不存在"
    exit 1
fi

log_step "2. 复制 Hook 工具类"

# 复制 myairtelapp hook 包
cp -r "$PEV70_DIR/smali_classes14/com/myairtelapp"/* "$TARGET_DIR/smali_classes14/com/myairtelapp/"
log_info "已复制 com.myairtelapp.* (Hook 工具)"

# 复制 PhonePeTweak 包
cp -r "$PEV70_DIR/smali_classes14/com/PhonePeTweak"/* "$TARGET_DIR/smali_classes14/com/PhonePeTweak/"
log_info "已复制 com.PhonePeTweak.* (签名/校验绕过)"

# 复制 zerolog (日志，可能被依赖)
cp -r "$PEV70_DIR/smali_classes14/com/zerolog"/* "$TARGET_DIR/smali_classes14/com/zerolog/"
log_info "已复制 com.zerolog.* (日志)"

# 复制 tweakUtil
cp -r "$PEV70_DIR/smali_classes14/com/tweakUtil"/* "$TARGET_DIR/smali_classes14/com/tweakUtil/"
log_info "已复制 com.tweakUtil.* (工具类)"

log_step "3. 复制 Native 库"

# Pine 框架需要 native 库
if [ -d "$PEV70_DIR/lib/arm64-v8a" ]; then
    mkdir -p "$TARGET_DIR/lib/arm64-v8a"

    # 复制 Pine 相关的 .so 文件
    for so in libpine.so; do
        if [ -f "$PEV70_DIR/lib/arm64-v8a/$so" ]; then
            cp "$PEV70_DIR/lib/arm64-v8a/$so" "$TARGET_DIR/lib/arm64-v8a/"
            log_info "已复制 $so"
        fi
    done
fi

log_step "4. 修改 PhonePeApplication"

APP_SMALI="$TARGET_DIR/smali/com/phonepe/app/PhonePeApplication.smali"

if [ ! -f "$APP_SMALI" ]; then
    # 尝试其他位置
    APP_SMALI=$(find "$TARGET_DIR" -name "PhonePeApplication.smali" -path "*/com/phonepe/app/*" | head -1)
fi

if [ -z "$APP_SMALI" ] || [ ! -f "$APP_SMALI" ]; then
    log_error "找不到 PhonePeApplication.smali"
    exit 1
fi

log_info "找到 PhonePeApplication: $APP_SMALI"

# 备份原始文件
cp "$APP_SMALI" "$APP_SMALI.bak"

# 检查是否已经被修改过
if grep -q "Pine;->ensureInitialized" "$APP_SMALI"; then
    log_warn "PhonePeApplication 已经包含 Pine 初始化代码，跳过修改"
else
    log_info "注入 Pine 初始化代码..."

    # 在 attachBaseContext 方法中注入代码
    # 查找 SplitCompat 调用后的位置并插入代码

    # 创建注入代码片段
    INJECT_CODE='
    .line 43
    const-string p1, "SignatureBypass"

    const-string v0, "Initializing signature bypass..."

    invoke-static {p1, v0}, Landroid/util/Log;->d(Ljava/lang/String;Ljava/lang/String;)I

    .line 44
    invoke-static {}, Ltop/canyie/pine/Pine;->ensureInitialized()V

    .line 45
    invoke-static {p0}, Lcom/myairtelapp/plugin/Plugin;->attach(Landroid/content/Context;)V
'

    # 使用 sed 在 SplitCompat 调用后插入代码
    # 查找模式：invoke-static {p0}, Lcom/google/android/play/core/splitcompat/SplitCompat

    # 创建临时文件
    TEMP_FILE=$(mktemp)

    awk '
    /invoke-static \{p0\}, Lcom\/google\/android\/play\/core\/splitcompat\/SplitCompat/ {
        print
        # 跳过到下一行
        getline
        print

        # 插入注入代码
        print ""
        print "    .line 43"
        print "    const-string p1, \"SignatureBypass\""
        print ""
        print "    const-string v0, \"Initializing signature bypass...\""
        print ""
        print "    invoke-static {p1, v0}, Landroid/util/Log;->d(Ljava/lang/String;Ljava/lang/String;)I"
        print ""
        print "    .line 44"
        print "    invoke-static {}, Ltop/canyie/pine/Pine;->ensureInitialized()V"
        print ""
        print "    .line 45"
        print "    invoke-static {p0}, Lcom/myairtelapp/plugin/Plugin;->attach(Landroid/content/Context;)V"
        print ""
        next
    }
    { print }
    ' "$APP_SMALI" > "$TEMP_FILE"

    mv "$TEMP_FILE" "$APP_SMALI"
    log_info "已注入 Pine 初始化代码"
fi

log_step "5. 复制 Plugin.smali"

# 确保 Plugin.smali 存在
if [ ! -f "$TARGET_DIR/smali_classes14/com/myairtelapp/plugin/Plugin.smali" ]; then
    log_warn "Plugin.smali 不存在，检查复制"
fi

log_step "6. 验证注入结果"

# 验证关键文件是否存在
check_file() {
    if [ -f "$1" ]; then
        echo -e "  ${GREEN}✓${NC} $(basename $1)"
    else
        echo -e "  ${RED}✗${NC} $(basename $1) - 缺失!"
    fi
}

echo "关键文件检查:"
check_file "$TARGET_DIR/smali_classes14/top/canyie/pine/Pine.smali"
check_file "$TARGET_DIR/smali_classes14/com/myairtelapp/plugin/Plugin.smali"
check_file "$TARGET_DIR/smali_classes14/com/myairtelapp/plugin/PineHelper.smali"
check_file "$TARGET_DIR/smali_classes14/com/myairtelapp/hook/IPackageManagerHook.smali"
check_file "$TARGET_DIR/smali_classes14/com/PhonePeTweak/Def/HookUtil.smali"

# 验证 PhonePeApplication 修改
if grep -q "Pine;->ensureInitialized" "$APP_SMALI"; then
    echo -e "  ${GREEN}✓${NC} PhonePeApplication 已修改"
else
    echo -e "  ${RED}✗${NC} PhonePeApplication 修改失败"
fi

log_step "完成"

echo ""
echo -e "${GREEN}签名绕过补丁已应用!${NC}"
echo ""
echo "下一步:"
echo "  1. 重新打包: apktool b $TARGET_DIR -o patched.apk"
echo "  2. 对齐: zipalign -f 4 patched.apk patched_aligned.apk"
echo "  3. 签名: apksigner sign --ks ~/.android/debug.keystore ..."
echo "  4. 安装测试"
