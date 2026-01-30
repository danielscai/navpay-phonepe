#!/bin/bash
#
# HTTPS 请求拦截演示应用 - 构建和安装脚本
#
# 使用方法:
#   ./build_and_install.sh          # 构建并安装到连接的设备/模拟器
#   ./build_and_install.sh build    # 仅构建
#   ./build_and_install.sh install  # 仅安装（需先构建）
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APK_PATH="$SCRIPT_DIR/app/build/outputs/apk/debug/app-debug.apk"
PACKAGE_NAME="com.httpinterceptor"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== HTTPS 请求拦截演示应用 ===${NC}"
echo ""

# 检查 Android SDK
if [ -z "$ANDROID_HOME" ]; then
    if [ -d "$HOME/Library/Android/sdk" ]; then
        export ANDROID_HOME="$HOME/Library/Android/sdk"
    elif [ -d "$HOME/Android/Sdk" ]; then
        export ANDROID_HOME="$HOME/Android/Sdk"
    else
        echo -e "${RED}错误: 找不到 Android SDK${NC}"
        echo "请设置 ANDROID_HOME 环境变量"
        exit 1
    fi
fi

echo "Android SDK: $ANDROID_HOME"

# 添加工具到 PATH
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/tools:$PATH"

# 检查 adb
if ! command -v adb &> /dev/null; then
    echo -e "${RED}错误: 找不到 adb${NC}"
    exit 1
fi

build_apk() {
    echo -e "${YELLOW}构建 APK...${NC}"

    cd "$SCRIPT_DIR"

    # 检查是否有 gradle wrapper
    if [ ! -f "gradle/wrapper/gradle-wrapper.jar" ]; then
        echo -e "${YELLOW}正在下载 Gradle Wrapper...${NC}"

        # 尝试使用系统 gradle 生成 wrapper
        if command -v gradle &> /dev/null; then
            gradle wrapper --gradle-version 8.2
        else
            echo -e "${RED}需要安装 Gradle 或在 Android Studio 中打开项目${NC}"
            echo ""
            echo "方法 1: 安装 Gradle"
            echo "  brew install gradle"
            echo "  然后重新运行此脚本"
            echo ""
            echo "方法 2: 在 Android Studio 中打开"
            echo "  1. 打开 Android Studio"
            echo "  2. 选择 'Open' -> 选择 $SCRIPT_DIR"
            echo "  3. 等待 Gradle 同步完成"
            echo "  4. 点击 Build -> Build Bundle(s) / APK(s) -> Build APK(s)"
            echo ""
            exit 1
        fi
    fi

    # 构建 debug APK
    ./gradlew assembleDebug

    if [ -f "$APK_PATH" ]; then
        echo -e "${GREEN}构建成功!${NC}"
        echo "APK 位置: $APK_PATH"
    else
        echo -e "${RED}构建失败${NC}"
        exit 1
    fi
}

install_apk() {
    echo -e "${YELLOW}安装 APK...${NC}"

    if [ ! -f "$APK_PATH" ]; then
        echo -e "${RED}APK 文件不存在，请先构建${NC}"
        exit 1
    fi

    # 检查设备连接
    DEVICE_COUNT=$(adb devices | grep -v "^$" | grep -v "List" | wc -l)
    if [ "$DEVICE_COUNT" -eq 0 ]; then
        echo -e "${RED}没有连接的设备或模拟器${NC}"
        echo ""
        echo "请启动模拟器或连接设备后重试"
        echo "启动模拟器: emulator -avd <avd_name>"
        echo "列出可用模拟器: emulator -list-avds"
        exit 1
    fi

    echo "检测到设备:"
    adb devices

    # 卸载旧版本（如果存在）
    echo "卸载旧版本（如果存在）..."
    adb uninstall $PACKAGE_NAME 2>/dev/null || true

    # 安装新版本
    echo "安装新版本..."
    adb install -r "$APK_PATH"

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}安装成功!${NC}"
    else
        echo -e "${RED}安装失败${NC}"
        exit 1
    fi
}

start_app() {
    echo -e "${YELLOW}启动应用...${NC}"
    adb shell am start -n "$PACKAGE_NAME/.MainActivity"
    echo -e "${GREEN}应用已启动${NC}"
}

show_logs() {
    echo -e "${YELLOW}显示日志...${NC}"
    echo "按 Ctrl+C 停止"
    echo ""
    adb logcat -s HttpInterceptor TokenInterceptor CertBypass
}

# 解析参数
case "${1:-all}" in
    build)
        build_apk
        ;;
    install)
        install_apk
        start_app
        ;;
    logs)
        show_logs
        ;;
    all|*)
        build_apk
        install_apk
        start_app
        echo ""
        echo -e "${GREEN}=== 完成 ===${NC}"
        echo ""
        echo "应用已安装并启动"
        echo ""
        echo "查看拦截日志:"
        echo "  adb logcat -s HttpInterceptor TokenInterceptor CertBypass"
        echo ""
        echo "或运行: ./build_and_install.sh logs"
        ;;
esac
