#!/bin/bash

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "\n${BLUE}==== $1 ====${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SRC_DIR="$PROJECT_DIR/src/main/java"
LIBS_DIR="$PROJECT_DIR/libs"
BUILD_DIR="$PROJECT_DIR/build"
OUTPUT_DIR="$BUILD_DIR/smali"

ANDROID_SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BUILD_TOOLS="$(find "$ANDROID_SDK/build-tools" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -1)"
ANDROID_JAR=$(ls -d "$ANDROID_SDK/platforms/android-"* 2>/dev/null | sort -V | tail -1)/android.jar

JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk}"
export PATH="$JAVA_HOME/bin:$PATH"

log_step "Check dependencies"

if ! command -v javac &> /dev/null; then
    log_error "javac not found"
    exit 1
fi
log_info "Java: $(javac -version 2>&1)"

if [ ! -f "$BUILD_TOOLS/d8" ]; then
    log_error "d8 not found: $BUILD_TOOLS/d8"
    exit 1
fi
log_info "d8: $BUILD_TOOLS/d8"

if [ ! -f "$ANDROID_JAR" ]; then
    log_error "android.jar not found: $ANDROID_JAR"
    exit 1
fi
log_info "android.jar: $ANDROID_JAR"

if ! command -v baksmali &> /dev/null; then
    if [ ! -f "$LIBS_DIR/baksmali.jar" ]; then
        log_error "baksmali not found and local jar missing: $LIBS_DIR/baksmali.jar"
        exit 1
    fi
    BAKSMALI=(java -jar "$LIBS_DIR/baksmali.jar")
else
    BAKSMALI=(baksmali)
fi

log_step "Compile Java sources"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/classes" "$OUTPUT_DIR"

JAVA_FILES=$(find "$SRC_DIR" -name "*.java")
log_info "Java files:"
for f in $JAVA_FILES; do
    echo "  - $(basename "$f")"
done

javac -source 1.8 -target 1.8 \
    -cp "$ANDROID_JAR" \
    -d "$BUILD_DIR/classes" \
    $JAVA_FILES

log_info "Java compilation completed"

log_step "Convert to DEX"
"$BUILD_TOOLS/d8" \
    --lib "$ANDROID_JAR" \
    --output "$BUILD_DIR" \
    $(find "$BUILD_DIR/classes" -name "*.class")

if [ ! -f "$BUILD_DIR/classes.dex" ]; then
    log_error "DEX conversion failed"
    exit 1
fi

log_step "Convert DEX to Smali"
"${BAKSMALI[@]}" d "$BUILD_DIR/classes.dex" -o "$OUTPUT_DIR"

log_info "Generated smali under $OUTPUT_DIR"
log_step "Done"
