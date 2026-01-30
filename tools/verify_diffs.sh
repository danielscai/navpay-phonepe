#!/bin/bash

# pev70 DEX 字节码篡改核查脚本
# 用法: chmod +x verify_diffs.sh && ./verify_diffs.sh

ORIG="/Users/danielscai/Documents/印度支付/apk包-研究/phonepe_original_apktool"
PEV70="/Users/danielscai/Documents/印度支付/apk包-研究/pev70_apktool"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  pev70 DEX 字节码篡改核查脚本${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 检查目录是否存在
if [ ! -d "$ORIG" ]; then
    echo -e "${RED}错误: 原始 APK 目录不存在: $ORIG${NC}"
    exit 1
fi

if [ ! -d "$PEV70" ]; then
    echo -e "${RED}错误: pev70 APK 目录不存在: $PEV70${NC}"
    exit 1
fi

echo -e "${GREEN}原始 APK:${NC} $ORIG"
echo -e "${GREEN}pev70 APK:${NC} $PEV70"
echo ""

compare_files() {
    local name="$1"
    local orig_path="$2"
    local pev70_path="$3"
    local count="$4"

    echo -e "${YELLOW}===== [$count/10] $name =====${NC}"
    echo -e "原始: ${orig_path}"
    echo -e "pev70: ${pev70_path}"
    echo ""

    orig_file="$ORIG/$orig_path"
    pev70_file="$PEV70/$pev70_path"

    if [ ! -f "$orig_file" ]; then
        echo -e "${RED}原始文件不存在${NC}"
    elif [ ! -f "$pev70_file" ]; then
        echo -e "${RED}pev70 文件不存在${NC}"
    else
        # 计算差异行数
        diff_lines=$(diff "$orig_file" "$pev70_file" 2>/dev/null | wc -l)
        if [ "$diff_lines" -eq 0 ]; then
            echo -e "${GREEN}文件相同 (无差异)${NC}"
        else
            echo -e "${RED}发现差异: 约 $diff_lines 行不同${NC}"
            echo ""
            echo -e "${BLUE}差异预览 (前 50 行):${NC}"
            diff -u "$orig_file" "$pev70_file" 2>/dev/null | head -50
        fi
    fi

    echo ""
    echo "----------------------------------------"
    echo ""
}

# 比较每个文件
compare_files "PhonePeApplication" \
    "smali_classes3/com/phonepe/app/PhonePeApplication.smali" \
    "smali/com/phonepe/app/PhonePeApplication.smali" \
    "1"

compare_files "MpinHurdleViewModel" \
    "smali_classes6/com/phonepe/login/common/ui/hurdle/viewmodel/MpinHurdleViewModel.smali" \
    "smali_classes2/com/phonepe/login/common/ui/hurdle/viewmodel/MpinHurdleViewModel.smali" \
    "2"

compare_files "OkHttpClient_Builder" \
    "smali_classes9/okhttp3/OkHttpClient\$Builder.smali" \
    "smali_classes3/okhttp3/OkHttpClient\$Builder.smali" \
    "3"

compare_files "CertificatePinner" \
    "smali_classes9/okhttp3/CertificatePinner.smali" \
    "smali_classes3/okhttp3/CertificatePinner.smali" \
    "4"

compare_files "Util_OkHttp" \
    "smali_classes9/okhttp3/internal/Util.smali" \
    "smali_classes3/okhttp3/internal/Util.smali" \
    "5"

compare_files "Request_Builder" \
    "smali_classes9/okhttp3/Request\$Builder.smali" \
    "smali_classes3/okhttp3/Request\$Builder.smali" \
    "6"

compare_files "OkHttpClient_WebSocket" \
    "smali_classes9/okhttp3/OkHttpClient.smali" \
    "smali_classes3/okhttp3/OkHttpClient.smali" \
    "7"

compare_files "PlayIntegrityConfigProviderImpl" \
    "smali_classes7/com/phonepe/phonepecore/playintegrity/config/PlayIntegrityConfigProviderImpl.smali" \
    "smali_classes3/com/phonepe/phonepecore/playintegrity/config/PlayIntegrityConfigProviderImpl.smali" \
    "8"

compare_files "CLServices" \
    "smali_classes9/org/npci/upi/security/services/CLServices.smali" \
    "smali_classes3/org/npci/upi/security/services/CLServices.smali" \
    "9"

compare_files "CLRemoteResultReceiver" \
    "smali_classes9/org/npci/upi/security/services/CLRemoteResultReceiver.smali" \
    "smali_classes13/org/npci/upi/security/services/CLRemoteResultReceiver.smali" \
    "10"

# 统计恶意代码分布
echo -e "${YELLOW}===== 恶意代码分布统计 =====${NC}"
echo ""

echo -e "${BLUE}1. zerolog 调用分布:${NC}"
zerolog_count=$(grep -r "Lcom/zerolog/Z;" "$PEV70" --include="*.smali" 2>/dev/null | wc -l)
echo "   共 $zerolog_count 处调用"
echo "   文件分布 (前10个):"
grep -r "Lcom/zerolog/Z;" "$PEV70" --include="*.smali" -l 2>/dev/null | head -10

echo ""
echo -e "${BLUE}2. HookUtil 调用分布:${NC}"
hookutil_count=$(grep -r "Lcom/PhonePeTweak/Def/HookUtil;" "$PEV70" --include="*.smali" 2>/dev/null | wc -l)
echo "   共 $hookutil_count 处调用"
echo "   文件分布:"
grep -r "Lcom/PhonePeTweak/Def/HookUtil;" "$PEV70" --include="*.smali" -l 2>/dev/null

echo ""
echo -e "${BLUE}3. Pine Hook 框架调用:${NC}"
pine_count=$(grep -r "Ltop/canyie/pine" "$PEV70" --include="*.smali" 2>/dev/null | wc -l)
echo "   共 $pine_count 处调用"

echo ""
echo -e "${BLUE}4. PhonePeTweak 恶意包:${NC}"
tweak_files=$(find "$PEV70" -path "*/com/PhonePeTweak/*" -name "*.smali" 2>/dev/null | wc -l)
echo "   共 $tweak_files 个恶意类文件"
echo "   目录结构:"
find "$PEV70" -path "*/com/PhonePeTweak/*" -type d 2>/dev/null | head -10

echo ""
echo -e "${GREEN}===== 核查完成 =====${NC}"
echo ""
echo "提示: 使用 vimdiff 可以更清晰地查看差异:"
echo "  vimdiff \"\$ORIG/path/to/file.smali\" \"\$PEV70/path/to/file.smali\""
