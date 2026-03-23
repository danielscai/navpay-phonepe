#!/bin/bash

#######################################################################
# PhonePeHelper 模块构建脚本
#
# 功能：仅构建 phonepehelper 所需的本地产物，不执行任何 APK 注入。
#
# 用法：./build_artifacts.sh
#######################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

log_info() { echo "[INFO] $1"; }
log_step() { echo ""; echo "==== $1 ===="; }

log_step "构建 PhonePeHelper 产物"
log_info "复用现有编译流程: $SCRIPT_DIR/compile.sh"
"$SCRIPT_DIR/compile.sh"

log_step "完成"
log_info "PhonePeHelper 产物已构建"
