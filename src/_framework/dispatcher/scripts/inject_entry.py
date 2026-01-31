#!/usr/bin/env python3
"""
Inject dispatcher entry call into Application.attachBaseContext().

Usage: python3 inject_entry.py <smali_file>
"""

import sys
import re

DISPATCHER_CALL = "    invoke-static {p0}, Lcom/indipay/inject/Dispatcher;->init(Landroid/content/Context;)V\n"


def inject_entry(file_path: str) -> bool:
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    if "Lcom/indipay/inject/Dispatcher;->init" in content:
        print("[SKIP] Dispatcher call already present")
        return True

    # Prefer injecting right after SplitCompat call if present.
    splitcompat_pattern = r"(invoke-static \{p0(?:, p1)?\}, Lcom/google/android/play/core/splitcompat/SplitCompat;[^\n]*\n)"

    def add_after_splitcompat(match: re.Match) -> str:
        return match.group(1) + DISPATCHER_CALL

    new_content, count = re.subn(splitcompat_pattern, add_after_splitcompat, content, count=1)

    if count == 0:
        print("[WARN] SplitCompat call not found, injecting before return-void")
        return_pattern = r"(\.method public (?:final )?attachBaseContext\(Landroid/content/Context;\)V.*?)(    return-void\n\.end method)"

        def add_before_return(match: re.Match) -> str:
            return match.group(1) + DISPATCHER_CALL + match.group(2)

        new_content, count = re.subn(return_pattern, add_before_return, content, count=1, flags=re.DOTALL)

        if count == 0:
            print("[ERROR] Failed to find injection point")
            return False

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(new_content)

    print("[OK] Dispatcher entry injected")
    return True


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <smali_file>")
        sys.exit(1)

    sys.exit(0 if inject_entry(sys.argv[1]) else 1)
