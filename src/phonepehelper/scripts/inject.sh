#!/bin/bash

#######################################################################
# PhonePeHelper 注入脚本
#
# 功能：编译并注入 phonepehelper 模块到反编译后的 APK
#
# 用法：./inject.sh <decompiled_dir>
#######################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "\n${BLUE}==== $1 ==== ${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ARTIFACT_DIR=""
TARGET_DIR=""

usage() {
    echo "用法: $0 [--artifact-dir <artifact_dir>] <decompiled_dir>"
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

if [ -n "$ARTIFACT_DIR" ] && [ ! -d "$ARTIFACT_DIR" ]; then
    log_error "artifact 目录不存在: $ARTIFACT_DIR"
    exit 1
fi

if [ -n "$ARTIFACT_DIR" ]; then
    log_step "1. 使用 artifact 目录注入 phonepehelper"
    "$SCRIPT_DIR/merge.sh" --artifact-dir "$ARTIFACT_DIR" "$TARGET_DIR"
else
    log_step "1. 编译 phonepehelper"
    if [ ! -x "$SCRIPT_DIR/compile.sh" ]; then
        log_error "未找到编译脚本: $SCRIPT_DIR/compile.sh"
        exit 1
    fi
    "$SCRIPT_DIR/compile.sh"

    log_step "2. 注入 phonepehelper"
    if [ ! -x "$SCRIPT_DIR/merge.sh" ]; then
        log_error "未找到注入脚本: $SCRIPT_DIR/merge.sh"
        exit 1
    fi
    "$SCRIPT_DIR/merge.sh" "$TARGET_DIR"
fi

log_step "完成"
log_info "phonepehelper 已注入"
