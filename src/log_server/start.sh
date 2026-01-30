#!/bin/bash

#######################################################################
# HTTPS 请求拦截日志服务器启动脚本
#######################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════╗"
echo "║     HTTPS 请求拦截日志服务器                            ║"
echo "╚════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}未找到 Node.js，请先安装:${NC}"
    echo "  brew install node"
    exit 1
fi

echo -e "${GREEN}Node.js:${NC} $(node --version)"

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}安装依赖...${NC}"
    npm install
fi

# 设置 adb reverse（如果有设备连接）
if command -v adb &> /dev/null; then
    DEVICE_COUNT=$(adb devices | grep -v "^$" | grep -v "List" | wc -l)
    if [ "$DEVICE_COUNT" -gt 0 ]; then
        echo -e "${GREEN}设置 ADB 端口转发...${NC}"
        adb reverse tcp:8088 tcp:8088 2>/dev/null || true
        echo "  已设置: tcp:8088 -> localhost:8088"
    else
        echo -e "${YELLOW}未检测到 Android 设备，跳过端口转发${NC}"
        echo "  连接设备后运行: adb reverse tcp:8088 tcp:8088"
    fi
fi

echo ""
echo -e "${GREEN}启动服务器...${NC}"
echo ""

# 启动服务器
node src/server.js
