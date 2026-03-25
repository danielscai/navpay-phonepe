#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import platform
import struct
import sys
import tempfile
import zipfile
from pathlib import Path

from elftools.elf.elffile import ELFFile


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


def add_python_path(path: str | None) -> None:
    if path and path not in sys.path:
        sys.path.insert(0, path)


def inspect_elf(path: Path) -> dict[str, int]:
    symbols: dict[str, int] = {}
    with path.open("rb") as fp:
        elf = ELFFile(fp)
        for sec_name in (".dynsym", ".symtab"):
            sec = elf.get_section_by_name(sec_name)
            if sec is None:
                continue
            for sym in sec.iter_symbols():
                if sym.name and sym.name not in symbols:
                    symbols[sym.name] = int(sym.entry["st_value"])
    return symbols


def extract_member(apk_path: Path, member: str, out_dir: Path) -> Path:
    with zipfile.ZipFile(apk_path) as zf:
        zf.extract(member, path=out_dir)
    return out_dir / member


def fmt_addr(value: int | None) -> str:
    if value is None:
        return "None"
    return hex(int(value))


def print_kv(key: str, value: object) -> None:
    print(f"{key}={value}")


def run_qiling_probe(so_path: Path, keystone_path: str | None, run_jni: bool, count: int) -> None:
    add_python_path(keystone_path)

    try:
        import qiling
        from qiling import Qiling
        from qiling.const import QL_ARCH, QL_OS, QL_VERBOSE
    except Exception as exc:
        print_kv("qiling_import", f"FAIL:{type(exc).__name__}:{exc}")
        return

    print_kv("qiling_import", "OK")
    print_kv("qiling_version", getattr(qiling, "__version__", "unknown"))
    print_kv("qiling_module", qiling.__file__)
    print_kv("qiling_android_support", "ANDROID" in [o.name for o in QL_OS])
    print_kv("qiling_arch_arm64", "ARM64" in [a.name for a in QL_ARCH])

    rootfs = Path(tempfile.mkdtemp(prefix="qiling-rootfs-"))
    try:
        ql = Qiling(
            [str(so_path)],
            rootfs=str(rootfs),
            ostype=QL_OS.LINUX,
            archtype=QL_ARCH.ARM64,
            verbose=QL_VERBOSE.OFF,
            console=False,
        )
    except Exception as exc:
        print_kv("qiling_init", f"FAIL:{type(exc).__name__}:{exc}")
        return

    print_kv("qiling_init", "OK")
    print_kv("load_address", fmt_addr(getattr(ql.loader, "load_address", None)))
    print_kv("elf_entry", fmt_addr(getattr(ql.loader, "elf_entry", None)))
    print_kv("entry_point", fmt_addr(getattr(ql, "entry_point", None)))

    if not run_jni:
        return

    base = int(ql.loader.load_address)
    jni = base + 0x4898
    slot_130 = base + 0xC130
    slot_1a0 = base + 0xC1A0

    stub0 = 0x0200_0000
    stub4 = 0x0200_0100
    fake_vm = 0x0100_0000
    fake_table = 0x0100_1000
    stack_top = 0x0300_0000
    tls = 0x0400_0000

    # Two tiny ARM64 stubs:
    #   stub0: return 0
    #   stub4: return 4
    ql.mem.map(stub0, 0x1000)
    ql.mem.write(stub0, b"\x00\x00\x80\x52\xc0\x03\x5f\xd6")
    ql.mem.write(stub4, b"\x80\x00\x80\x52\xc0\x03\x5f\xd6")

    ql.mem.map(fake_vm, 0x1000)
    ql.mem.map(fake_table, 0x2000)
    ql.mem.map(stack_top - 0x10000, 0x20000)
    ql.mem.map(tls, 0x1000)

    ql.mem.write(fake_vm, struct.pack("<Q", fake_table))
    ql.mem.write(tls + 0x28, struct.pack("<Q", 0xDEADBEEFCAFEBABE))

    for off in range(0, 0x800, 8):
        ql.mem.write(fake_table + off, struct.pack("<Q", stub0))

    # Patch the first two zeroed internal slots observed in the loader path.
    ql.mem.write(slot_130, struct.pack("<Q", jni + 0x40))
    ql.mem.write(slot_1a0, struct.pack("<Q", stub4))

    print_kv("jni_onload_symbol", fmt_addr(jni))
    print_kv("slot_130", fmt_addr(struct.unpack("<Q", ql.mem.read(slot_130, 8))[0]))
    print_kv("slot_1a0", fmt_addr(struct.unpack("<Q", ql.mem.read(slot_1a0, 8))[0]))

    hook_hits: list[int] = []

    def on_code(_ql, address, size):
        if len(hook_hits) < 160:
            hook_hits.append(address)
            print(f"pc={hex(address)} size={size} x0={hex(_ql.arch.regs.read('x0'))} x23={hex(_ql.arch.regs.read('x23'))}")

    def on_stub(_ql):
        print(
            "stub_hit"
            f" pc={hex(_ql.arch.regs.read('pc'))}"
            f" x0={hex(_ql.arch.regs.read('x0'))}"
            f" x1={hex(_ql.arch.regs.read('x1'))}"
            f" x2={hex(_ql.arch.regs.read('x2'))}"
        )

    ql.hook_code(on_code)
    ql.hook_address(on_stub, stub0)
    ql.hook_address(on_stub, stub4)

    ql.arch.regs.write("x0", fake_vm)
    ql.arch.regs.write("x1", 0)
    ql.arch.regs.write("sp", stack_top)
    ql.arch.regs.write("tpidr_el0", tls)

    print_kv("jni_run_begin", fmt_addr(jni))
    print_kv("jni_run_end", fmt_addr(jni + 0x300))
    try:
        ql.emu_start(jni, jni + 0x300, count=count)
        print_kv("jni_run", "OK")
    except Exception as exc:
        print_kv("jni_run", f"FAIL:{type(exc).__name__}:{exc}")
    print_kv("jni_hits", len(hook_hits))
    print_kv("jni_last_pc", fmt_addr(ql.arch.regs.read("pc")))
    print_kv("jni_last_x0", fmt_addr(ql.arch.regs.read("x0")))
    print_kv("jni_last_x23", fmt_addr(ql.arch.regs.read("x23")))


def main() -> int:
    parser = argparse.ArgumentParser(description="Qiling feasibility probe for PhonePe native checksum path")
    parser.add_argument("--apk", required=True, help="Path to the APK sample")
    parser.add_argument(
        "--member",
        default="lib/arm64-v8a/libe755b7.so",
        help="APK member to extract and load",
    )
    parser.add_argument(
        "--keystone-path",
        default=os.environ.get("QILING_KEYSTONE_PATH"),
        help="Path prepended to PYTHONPATH so the keystone dylib build can be imported",
    )
    parser.add_argument("--no-jni-run", action="store_true", help="Only load the ELF and report metadata")
    parser.add_argument("--count", type=int, default=800, help="Instruction count limit for the JNI run")
    args = parser.parse_args()

    apk_path = Path(args.apk).expanduser().resolve()
    if not apk_path.is_file():
        eprint(f"APK not found: {apk_path}")
        return 2

    with tempfile.TemporaryDirectory(prefix="qiling-probe-") as td:
        workdir = Path(td)
        so_path = extract_member(apk_path, args.member, workdir)
        print_kv("apk", apk_path)
        print_kv("member", args.member)
        print_kv("so_path", so_path)
        print_kv("python", sys.version.split()[0])
        print_kv("platform", platform.platform())

        symbols = inspect_elf(so_path)
        print_kv("dynsym_has_JNI_OnLoad", "JNI_OnLoad" in symbols)
        print_kv("dynsym_has_nmcs", "nmcs" in symbols)
        if "JNI_OnLoad" in symbols:
            print_kv("JNI_OnLoad_offset", fmt_addr(symbols["JNI_OnLoad"]))
        if "nmcs" in symbols:
            print_kv("nmcs_offset", fmt_addr(symbols["nmcs"]))

        run_qiling_probe(so_path, args.keystone_path, not args.no_jni_run, args.count)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
