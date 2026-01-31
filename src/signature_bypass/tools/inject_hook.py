#!/usr/bin/env python3
"""
Hook 入口注入脚本

将 HookEntry.init() 调用注入到 Application.attachBaseContext() 方法中。

用法: python3 inject_hook.py <smali_file>
"""

import sys
import re

def inject_hook(file_path):
    """注入 Hook 入口代码"""

    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 检查是否已注入
    if 'Lcom/sigbypass/HookEntry;->init' in content:
        print(f"[SKIP] 已包含 Hook 入口代码")
        return False

    # 1. 修改 .locals 为至少 1
    locals_pattern = r'(\.method public (?:final )?attachBaseContext\(Landroid/content/Context;\)V\s*\n\s*\.locals )(\d+)'

    def replace_locals(match):
        prefix = match.group(1)
        locals_count = int(match.group(2))
        new_count = max(locals_count, 1)
        print(f"[INFO] .locals {locals_count} -> {new_count}")
        return prefix + str(new_count)

    content = re.sub(locals_pattern, replace_locals, content)

    # 2. 在 SplitCompat 调用后注入代码
    splitcompat_pattern = r'(invoke-static \{p0(?:, p1)?\}, Lcom/google/android/play/core/splitcompat/SplitCompat;[^\n]*\n)'

    inject_code = '''
    # === Signature Bypass Hook Entry ===
    const-string v0, "SigBypass"

    const-string p1, "Initializing signature bypass..."

    invoke-static {v0, p1}, Landroid/util/Log;->d(Ljava/lang/String;Ljava/lang/String;)I

    invoke-static {p0}, Lcom/sigbypass/HookEntry;->init(Landroid/content/Context;)V
    # === End Signature Bypass ===

'''

    def add_inject(match):
        return match.group(1) + inject_code

    new_content, count = re.subn(splitcompat_pattern, add_inject, content, count=1)

    if count == 0:
        print(f"[WARN] 未找到 SplitCompat 调用，尝试其他位置...")
        # 备用方案：在 attachBaseContext 方法的 return-void 前注入
        return_pattern = r'(\.method public (?:final )?attachBaseContext\(Landroid/content/Context;\)V.*?)(    return-void\n\.end method)'

        def add_before_return(match):
            method_body = match.group(1)
            return_stmt = match.group(2)
            return method_body + inject_code + return_stmt

        new_content, count = re.subn(return_pattern, add_before_return, content, count=1, flags=re.DOTALL)

        if count == 0:
            print(f"[ERROR] 无法找到注入位置")
            return False

    # 写回文件
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)

    print(f"[OK] 注入成功")
    return True


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(f"用法: {sys.argv[0]} <smali_file>")
        sys.exit(1)

    file_path = sys.argv[1]
    success = inject_hook(file_path)
    sys.exit(0 if success else 1)
