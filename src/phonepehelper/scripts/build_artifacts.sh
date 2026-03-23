#!/bin/bash

#######################################################################
# PhonePeHelper 模块构建脚本
#
# 功能：仅构建 phonepehelper 所需的本地产物，不执行任何 APK 注入。
#
# 用法：./build_artifacts.sh
#######################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/compile.sh" "$@"
