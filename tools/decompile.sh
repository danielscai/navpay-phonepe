#!/bin/bash
# ========================================
# APK 反编译脚本
# 用于重新生成被 .gitignore 忽略的反编译产物
# 输出目录: decompiled/
# ========================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SAMPLES_DIR="$PROJECT_ROOT/samples"
OUTPUT_DIR="$PROJECT_ROOT/decompiled"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 检查依赖
check_dependencies() {
    local missing=""
    command -v apktool &>/dev/null || missing="$missing apktool"
    command -v jadx &>/dev/null || missing="$missing jadx"

    if [ -n "$missing" ]; then
        log_error "缺少依赖工具:$missing"
        echo "安装方法 (macOS): brew install apktool jadx"
        exit 1
    fi
}

# 获取 APK 文件路径
get_apk_path() {
    case "$1" in
        pev70)   echo "$SAMPLES_DIR/pev70.apk" ;;
        mov)     echo "$SAMPLES_DIR/Mov 4.5.3.apk" ;;
        ip)      echo "$SAMPLES_DIR/ip4.6.apk" ;;
        phonepe) echo "$SAMPLES_DIR/PhonePe APK v24.08.23.apk" ;;
        *)       echo "" ;;
    esac
}

# 获取输出名称
get_output_name() {
    case "$1" in
        pev70)   echo "pev70" ;;
        mov)     echo "mov4.5.3" ;;
        ip)      echo "ip4.6" ;;
        phonepe) echo "phonepe_original" ;;
        *)       echo "" ;;
    esac
}

# 使用 apktool 反编译
decompile_apktool() {
    local apk_path="$1"
    local output_name="$2"
    local output_path="$OUTPUT_DIR/${output_name}_apktool"

    if [ -d "$output_path" ]; then
        log_warn "目录已存在，跳过: ${output_name}_apktool"
        return 0
    fi

    log_info "apktool 反编译: $(basename "$apk_path")"
    apktool d -f "$apk_path" -o "$output_path"
    log_info "完成: ${output_name}_apktool"
}

# 使用 jadx 反编译
decompile_jadx() {
    local apk_path="$1"
    local output_name="$2"
    local output_path="$OUTPUT_DIR/${output_name}_jadx"

    if [ -d "$output_path" ]; then
        log_warn "目录已存在，跳过: ${output_name}_jadx"
        return 0
    fi

    log_info "jadx 反编译: $(basename "$apk_path")"
    jadx -d "$output_path" "$apk_path"
    log_info "完成: ${output_name}_jadx"
}

# 显示帮助
show_help() {
    cat << 'EOF'
用法: decompile.sh [选项] [APK名称...]

选项:
  -a, --all      反编译所有 APK 样本
  -t, --apktool  仅使用 apktool 反编译
  -j, --jadx     仅使用 jadx 反编译
  -f, --force    强制重新反编译 (删除已有目录)
  -h, --help     显示此帮助信息

APK 名称:
  pev70          恶意注入的 PhonePe
  mov            MovPay 主控应用
  ip             InstallPlugin 插件
  phonepe        原版 PhonePe

示例:
  ./tools/decompile.sh --all           # 反编译所有 APK
  ./tools/decompile.sh pev70           # 仅反编译 pev70.apk
  ./tools/decompile.sh -t pev70 ip     # 使用 apktool 反编译指定 APK
  ./tools/decompile.sh -f pev70        # 强制重新反编译 pev70

EOF
    echo "输出目录: $OUTPUT_DIR"
}

# 处理单个 APK
process_apk() {
    local target="$1"
    local use_apktool="$2"
    local use_jadx="$3"
    local force="$4"

    local apk_path=$(get_apk_path "$target")
    local output_name=$(get_output_name "$target")

    if [ -z "$apk_path" ] || [ -z "$output_name" ]; then
        log_error "未知的 APK 名称: $target"
        echo "可用名称: pev70, mov, ip, phonepe"
        return 1
    fi

    if [ ! -f "$apk_path" ]; then
        log_error "APK 文件不存在: $apk_path"
        return 1
    fi

    echo ""
    log_info "========== 处理: $(basename "$apk_path") =========="

    # 强制模式：删除已有目录
    if [ "$force" = "true" ]; then
        if [ "$use_apktool" = "true" ] && [ -d "$OUTPUT_DIR/${output_name}_apktool" ]; then
            log_info "删除已有目录: ${output_name}_apktool"
            rm -rf "$OUTPUT_DIR/${output_name}_apktool"
        fi
        if [ "$use_jadx" = "true" ] && [ -d "$OUTPUT_DIR/${output_name}_jadx" ]; then
            log_info "删除已有目录: ${output_name}_jadx"
            rm -rf "$OUTPUT_DIR/${output_name}_jadx"
        fi
    fi

    if [ "$use_apktool" = "true" ]; then
        decompile_apktool "$apk_path" "$output_name"
    fi

    if [ "$use_jadx" = "true" ]; then
        decompile_jadx "$apk_path" "$output_name"
    fi
}

# 主函数
main() {
    local use_apktool="true"
    local use_jadx="true"
    local force="false"
    local targets=""

    # 解析参数
    while [ $# -gt 0 ]; do
        case "$1" in
            -a|--all)
                targets="pev70 mov ip phonepe"
                shift
                ;;
            -t|--apktool)
                use_jadx="false"
                shift
                ;;
            -j|--jadx)
                use_apktool="false"
                shift
                ;;
            -f|--force)
                force="true"
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            pev70|mov|ip|phonepe)
                targets="$targets $1"
                shift
                ;;
            *)
                log_error "未知参数: $1"
                show_help
                exit 1
                ;;
        esac
    done

    # 去除首尾空格
    targets=$(echo "$targets" | xargs)

    if [ -z "$targets" ]; then
        show_help
        exit 1
    fi

    check_dependencies

    # 确保输出目录存在
    mkdir -p "$OUTPUT_DIR"

    # 执行反编译
    for target in $targets; do
        process_apk "$target" "$use_apktool" "$use_jadx" "$force"
    done

    echo ""
    log_info "========== 完成 =========="
    log_info "输出目录: $OUTPUT_DIR"
    ls -la "$OUTPUT_DIR"
}

main "$@"
