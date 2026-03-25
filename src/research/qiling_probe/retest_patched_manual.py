#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import platform
import struct
import sys
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

from elftools.elf.elffile import ELFFile
from elftools.elf.descriptions import describe_reloc_type


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


def print_kv(key: str, value: object) -> None:
    print(f"{key}={value}")


def align_up(value: int, page: int = 0x1000) -> int:
    return (value + page - 1) & ~(page - 1)


def align_down(value: int, page: int = 0x1000) -> int:
    return value & ~(page - 1)


@dataclass
class FakeObject:
    kind: str
    data_ptr: int | None = None
    length: int = 0
    text: str | None = None


class ManualRuntime:
    def __init__(self, ql, base: int):
        self.ql = ql
        self.base = base
        self.page = 0x1000
        self.heap_base = 0x7100_0000
        self.heap_cursor = self.heap_base
        self.heap_limit = self.heap_base + 0x20_0000
        self.stub_base = 0x7200_0000
        self.stub_cursor = self.stub_base
        self.stub_limit = self.stub_base + 0x40_000
        self.table_base = 0x7300_0000
        self.table_cursor = self.table_base
        self.table_limit = self.table_base + 0x20_000
        self.env_base = 0x7400_0000
        self.vm_base = 0x7410_0000
        self.tls_base = 0x7500_0000
        self.import_stubs: dict[str, int] = {}
        self.helper_stubs: dict[str, int] = {}
        self.jni_slots: dict[int, int] = {}
        self.stub_meta: dict[int, tuple[str, int]] = {}
        self.objects: dict[int, FakeObject] = {}
        self.strings: dict[int, bytes] = {}
        self.calls: list[str] = []
        self.next_object_tag = 0x7600_0000

    def map_region(self, addr: int, size: int, perms: int = 7, info: str = "") -> None:
        size = align_up(size, self.page)
        if size:
            self.ql.mem.map(addr, size, perms, info=info)

    def alloc(self, size: int, *, kind: str = "heap", align: int = 0x10) -> int:
        cursor = self.heap_cursor
        cursor = (cursor + align - 1) & ~(align - 1)
        if cursor + size >= self.heap_limit:
            raise RuntimeError("manual heap exhausted")
        self.heap_cursor = cursor + size
        self.ql.mem.write(cursor, b"\x00" * size)
        return cursor

    def alloc_string(self, text: str) -> int:
        data = text.encode("utf-8") + b"\x00"
        addr = self.alloc(len(data), kind="string")
        self.ql.mem.write(addr, data)
        self.strings[addr] = data[:-1]
        return addr

    def alloc_bytes(self, data: bytes) -> int:
        data_addr = self.alloc(max(len(data), 1), kind="bytes")
        if data:
            self.ql.mem.write(data_addr, data)
        obj_addr = self.alloc(16, kind="jbyteArray")
        self.ql.mem.write(obj_addr, struct.pack("<QQ", len(data), data_addr))
        self.objects[obj_addr] = FakeObject(kind="jbyteArray", data_ptr=data_addr, length=len(data))
        return obj_addr

    def alloc_object(self, kind: str, *, text: str | None = None, length: int = 0, data: bytes | None = None) -> int:
        addr = self.next_object_tag
        self.next_object_tag += 0x100
        if data is not None:
            data_ptr = self.alloc_bytes(data)
            self.objects[addr] = FakeObject(kind=kind, data_ptr=self.objects[data_ptr].data_ptr, length=len(data), text=text)
        else:
            self.objects[addr] = FakeObject(kind=kind, text=text, length=length)
        return addr

    def read_cstring(self, addr: int) -> str:
        return self.ql.mem.string(addr)

    def read_bytes(self, addr: int, length: int) -> bytes:
        return bytes(self.ql.mem.read(addr, length))

    def write_u64(self, addr: int, value: int) -> None:
        self.ql.mem.write(addr, struct.pack("<Q", value & 0xFFFFFFFFFFFFFFFF))

    def read_u64(self, addr: int) -> int:
        return struct.unpack("<Q", bytes(self.ql.mem.read(addr, 8)))[0]

    def read_i64(self, addr: int) -> int:
        return struct.unpack("<q", bytes(self.ql.mem.read(addr, 8)))[0]

    def install_stub(self, name: str, handler: Callable[[int], None]) -> int:
        if name in self.import_stubs:
            return self.import_stubs[name]
        addr = self.stub_cursor
        self.stub_cursor += 0x10
        if self.stub_cursor >= self.stub_limit:
            raise RuntimeError("stub region exhausted")
        self.ql.mem.write(addr, b"\xc0\x03\x5f\xd6")  # ret
        def _dispatch(ql, _name=name, _handler=handler):
            self.log_call(f"import_call:{_name}")
            _handler(ql)

        self.ql.hook_address(_dispatch, addr)
        self.import_stubs[name] = addr
        self.stub_meta[addr] = (name, 0)
        return addr

    def install_jni_slot(self, slot: int, handler: Callable[[int], None]) -> int:
        if slot in self.jni_slots:
            return self.jni_slots[slot]
        addr = self.table_cursor
        self.table_cursor += 0x10
        if self.table_cursor >= self.table_limit:
            raise RuntimeError("JNI slot table exhausted")
        self.ql.mem.write(addr, b"\xc0\x03\x5f\xd6")  # ret
        self.ql.hook_address(lambda ql, _slot=slot, _handler=handler: _handler(ql), addr)
        self.jni_slots[slot] = addr
        self.stub_meta[addr] = (f"jni_slot_{slot:#x}", slot)
        return addr

    def install_helper(self, name: str, handler: Callable[[int], None]) -> int:
        if name in self.helper_stubs:
            return self.helper_stubs[name]
        addr = self.stub_cursor
        self.stub_cursor += 0x10
        if self.stub_cursor >= self.stub_limit:
            raise RuntimeError("helper stub region exhausted")
        self.ql.mem.write(addr, b"\xc0\x03\x5f\xd6")
        def _dispatch(ql, _name=name, _handler=handler):
            self.log_call(f"helper_call:{_name}")
            _handler(ql)

        self.ql.hook_address(_dispatch, addr)
        self.helper_stubs[name] = addr
        self.stub_meta[addr] = (name, 0)
        return addr

    def log_call(self, label: str) -> None:
        if len(self.calls) < 200:
            self.calls.append(label)
            print(label)

    def jni_env_table(self) -> int:
        return self.env_base + 0x100

    def vm_table(self) -> int:
        return self.vm_base + 0x100

    def write_canary(self) -> None:
        self.ql.mem.map(self.tls_base, 0x1000, info="[tls]")
        self.write_u64(self.tls_base + 0x28, 0xDEADBEEFCAFEBABE)
        self.ql.arch.regs.write("tpidr_el0", self.tls_base)

    def install_common_stubs(self) -> None:
        def ret0(_ql):
            _ql.arch.regs.write("x0", 0)

        def abort(_ql):
            raise RuntimeError("abort() hit")

        def stack_chk_fail(_ql):
            raise RuntimeError("__stack_chk_fail hit")

        def malloc(_ql):
            size = int(_ql.arch.regs.read("x0"))
            addr = self.alloc(max(size, 1), kind="malloc")
            _ql.arch.regs.write("x0", addr)

        def free(_ql):
            _ql.arch.regs.write("x0", 0)

        def realloc(_ql):
            size = int(_ql.arch.regs.read("x1"))
            addr = self.alloc(max(size, 1), kind="realloc")
            _ql.arch.regs.write("x0", addr)

        def posix_memalign(_ql):
            out_ptr = int(_ql.arch.regs.read("x0"))
            align = max(int(_ql.arch.regs.read("x1")), 0x10)
            size = int(_ql.arch.regs.read("x2"))
            addr = self.alloc(max(size, 1), kind="posix_memalign", align=align)
            self.write_u64(out_ptr, addr)
            _ql.arch.regs.write("x0", 0)

        def new_obj(_ql):
            size = int(_ql.arch.regs.read("x0"))
            addr = self.alloc(max(size, 1), kind="new")
            _ql.arch.regs.write("x0", addr)

        def delete_obj(_ql):
            _ql.arch.regs.write("x0", 0)

        def strlen(_ql):
            s = self.read_cstring(int(_ql.arch.regs.read("x0")))
            _ql.arch.regs.write("x0", len(s))

        def strcmp(_ql):
            a = self.read_cstring(int(_ql.arch.regs.read("x0")))
            b = self.read_cstring(int(_ql.arch.regs.read("x1")))
            _ql.arch.regs.write("x0", (a > b) - (a < b))

        def strncmp(_ql):
            a = self.read_cstring(int(_ql.arch.regs.read("x0")))
            b = self.read_cstring(int(_ql.arch.regs.read("x1")))
            n = int(_ql.arch.regs.read("x2"))
            a = a[:n]
            b = b[:n]
            _ql.arch.regs.write("x0", (a > b) - (a < b))

        def memcmp(_ql):
            a = bytes(self.ql.mem.read(int(_ql.arch.regs.read("x0")), int(_ql.arch.regs.read("x2"))))
            b = bytes(self.ql.mem.read(int(_ql.arch.regs.read("x1")), int(_ql.arch.regs.read("x2"))))
            _ql.arch.regs.write("x0", (a > b) - (a < b))

        def memcpy(_ql):
            dst = int(_ql.arch.regs.read("x0"))
            src = int(_ql.arch.regs.read("x1"))
            n = int(_ql.arch.regs.read("x2"))
            try:
                data = bytes(self.ql.mem.read(src, n))
                self.ql.mem.write(dst, data)
            except Exception as exc:
                self.log_call(f"memcpy_err:{type(exc).__name__}:{exc}")
            _ql.arch.regs.write("x0", dst)

        def memmove(_ql):
            memcpy(_ql)

        def memset(_ql):
            dst = int(_ql.arch.regs.read("x0"))
            val = int(_ql.arch.regs.read("x1")) & 0xFF
            n = int(_ql.arch.regs.read("x2"))
            self.ql.mem.write(dst, bytes([val]) * n)
            _ql.arch.regs.write("x0", dst)

        def memchr(_ql):
            data = self.read_bytes(int(_ql.arch.regs.read("x0")), int(_ql.arch.regs.read("x2")))
            needle = int(_ql.arch.regs.read("x1")) & 0xFF
            idx = data.find(bytes([needle]))
            _ql.arch.regs.write("x0", int(_ql.arch.regs.read("x0")) + idx if idx >= 0 else 0)

        def sysconf(_ql):
            _ql.arch.regs.write("x0", 4096)

        def getauxval(_ql):
            _ql.arch.regs.write("x0", 0)

        def system_property_get(_ql):
            _ql.arch.regs.write("x0", 0)

        def log_void(_ql):
            _ql.arch.regs.write("x0", 0)

        def nanosleep(_ql):
            _ql.arch.regs.write("x0", 0)

        def strerror_r(_ql):
            _ql.arch.regs.write("x0", 0)

        def dtor_noop(_ql):
            _ql.arch.regs.write("x0", 0)

        def guard_acquire(_ql):
            _ql.arch.regs.write("x0", 1)

        def guard_release(_ql):
            _ql.arch.regs.write("x0", 0)

        def cxa_allocate_exception(_ql):
            size = int(_ql.arch.regs.read("x0"))
            addr = self.alloc(max(size, 1), kind="exc")
            _ql.arch.regs.write("x0", addr)

        def cxa_throw(_ql):
            raise RuntimeError("__cxa_throw hit")

        def cxa_begin_catch(_ql):
            _ql.arch.regs.write("x0", int(_ql.arch.regs.read("x0")))

        def cxa_end_catch(_ql):
            _ql.arch.regs.write("x0", 0)

        def cxa_get_globals(_ql):
            addr = self.alloc(0x100, kind="cxa_globals")
            _ql.arch.regs.write("x0", addr)

        def cxa_demangle(_ql):
            _ql.arch.regs.write("x0", 0)

        common = {
            "__cxa_finalize": dtor_noop,
            "__cxa_atexit": dtor_noop,
            "__cxa_begin_catch": cxa_begin_catch,
            "__cxa_end_catch": cxa_end_catch,
            "__stack_chk_fail": stack_chk_fail,
            "_ZSt9terminatev": abort,
            "abort": abort,
            "__android_log_vprint": log_void,
            "android_set_abort_message": log_void,
            "__system_property_get": system_property_get,
            "getauxval": getauxval,
            "sysconf": sysconf,
            "nanosleep": nanosleep,
            "strerror_r": strerror_r,
            "openlog": log_void,
            "closelog": log_void,
            "syslog": log_void,
            "fprintf": log_void,
            "vfprintf": log_void,
            "fwrite": log_void,
            "fflush": log_void,
            "fputc": log_void,
            "malloc": malloc,
            "free": free,
            "realloc": realloc,
            "posix_memalign": posix_memalign,
            "_Znwm": new_obj,
            "_Znam": new_obj,
            "_ZnwmSt11align_val_t": new_obj,
            "_ZnamSt11align_val_t": new_obj,
            "_ZdlPv": delete_obj,
            "_ZdlPvm": delete_obj,
            "_ZdlPvSt11align_val_t": delete_obj,
            "_ZdaPv": delete_obj,
            "_ZdaPvSt11align_val_t": delete_obj,
            "strlen": strlen,
            "strcmp": strcmp,
            "strncmp": strncmp,
            "memcmp": memcmp,
            "memcpy": memcpy,
            "memmove": memmove,
            "memset": memset,
            "memchr": memchr,
            "pthread_mutex_lock": ret0,
            "pthread_mutex_unlock": ret0,
            "pthread_mutex_init": ret0,
            "pthread_mutex_destroy": ret0,
            "pthread_mutexattr_init": ret0,
            "pthread_mutexattr_destroy": ret0,
            "pthread_mutexattr_settype": ret0,
            "pthread_cond_destroy": ret0,
            "pthread_cond_signal": ret0,
            "pthread_cond_broadcast": ret0,
            "pthread_cond_wait": ret0,
            "pthread_cond_timedwait": ret0,
            "pthread_rwlock_rdlock": ret0,
            "pthread_rwlock_wrlock": ret0,
            "pthread_rwlock_unlock": ret0,
            "pthread_once": ret0,
            "pthread_setspecific": ret0,
            "pthread_getspecific": ret0,
            "pthread_key_create": ret0,
            "pthread_key_delete": ret0,
            "pthread_detach": ret0,
            "pthread_join": ret0,
            "pthread_self": ret0,
            "pthread_trylock": ret0,
            "pthread_mutex_trylock": ret0,
            "__cxa_guard_acquire": guard_acquire,
            "__cxa_guard_release": guard_release,
            "__cxa_guard_abort": ret0,
            "__cxa_allocate_exception": cxa_allocate_exception,
            "__cxa_throw": cxa_throw,
            "__cxa_get_globals": cxa_get_globals,
            "__cxa_get_globals_fast": cxa_get_globals,
            "__cxa_demangle": cxa_demangle,
            "__cxa_rethrow": abort,
            "__cxa_rethrow_primary_exception": abort,
            "__cxa_current_primary_exception": ret0,
            "__cxa_uncaught_exceptions": ret0,
            "__cxa_free_exception": ret0,
            "__cxa_increment_exception_refcount": ret0,
            "__cxa_decrement_exception_refcount": ret0,
            "__cxa_new_handler": ret0,
            "__cxa_unexpected_handler": ret0,
            "__cxa_terminate_handler": abort,
            "__cxa_pure_virtual": abort,
            "__cxa_init_primary_exception": ret0,
            "__cxa_atexit": ret0,
            "__cxa_finalize": ret0,
            "__cxa_verbose_abort": abort,
            "__cxa_throw_bad_array_new_length": abort,
            "__cxa_bad_typeid": abort,
            "__cxa_bad_cast": abort,
        }
        for name, handler in common.items():
            self.install_stub(name, handler)

    def install_jni_table(self) -> None:
        def find_class(_ql):
            name_ptr = int(_ql.arch.regs.read("x1"))
            name = self.read_cstring(name_ptr)
            handle = self.alloc_object("jclass", text=name)
            _ql.arch.regs.write("x0", handle)
            self.log_call(f"jni:FindClass({name}) -> {hex(handle)}")

        def get_array_length(_ql):
            arr = int(_ql.arch.regs.read("x1"))
            obj = self.objects.get(arr)
            length = obj.length if obj else self.read_u64(arr)
            _ql.arch.regs.write("x0", length)
            self.log_call(f"jni:GetArrayLength({hex(arr)}) -> {length}")

        def new_byte_array(_ql):
            length = int(_ql.arch.regs.read("x1"))
            handle = self.alloc_bytes(b"\x00" * max(length, 0))
            _ql.arch.regs.write("x0", handle)
            self.log_call(f"jni:NewByteArray({length}) -> {hex(handle)}")

        def get_byte_array_region(_ql):
            arr = int(_ql.arch.regs.read("x1"))
            start = int(_ql.arch.regs.read("x2"))
            length = int(_ql.arch.regs.read("x3"))
            dst = int(_ql.arch.regs.read("x4"))
            obj = self.objects.get(arr)
            if obj is None or obj.data_ptr is None:
                data = b"\x00" * length
            else:
                data = bytes(self.ql.mem.read(obj.data_ptr + start, length))
            self.ql.mem.write(dst, data)
            _ql.arch.regs.write("x0", 0)
            self.log_call(f"jni:GetByteArrayRegion({hex(arr)}, {start}, {length}, {hex(dst)})")

        def set_byte_array_region(_ql):
            arr = int(_ql.arch.regs.read("x1"))
            start = int(_ql.arch.regs.read("x2"))
            length = int(_ql.arch.regs.read("x3"))
            src = int(_ql.arch.regs.read("x4"))
            obj = self.objects.get(arr)
            if obj is not None and obj.data_ptr is not None:
                data = bytes(self.ql.mem.read(src, length))
                self.ql.mem.write(obj.data_ptr + start, data)
            _ql.arch.regs.write("x0", 0)
            self.log_call(f"jni:SetByteArrayRegion({hex(arr)}, {start}, {length}, {hex(src)})")

        def get_static_method_id(_ql):
            cls = int(_ql.arch.regs.read("x1"))
            name = self.read_cstring(int(_ql.arch.regs.read("x2")))
            sig = self.read_cstring(int(_ql.arch.regs.read("x3")))
            handle = self.alloc_object("jmethodID", text=f"{name}{sig}")
            _ql.arch.regs.write("x0", handle)
            self.log_call(f"jni:GetStaticMethodID({hex(cls)}, {name}, {sig}) -> {hex(handle)}")

        def call_static_object(_ql):
            cls = int(_ql.arch.regs.read("x1"))
            method = int(_ql.arch.regs.read("x2"))
            meta = self.objects.get(method)
            label = meta.text if meta else f"method@{hex(method)}"
            if label and "getAppSignature" in label:
                handle = self.alloc_bytes(b"APP_SIGNATURE")
            elif label and "getSignature" in label:
                handle = self.alloc_bytes(b"SIGNATURE")
            elif label and "getEncryptedPayload" in label:
                handle = self.alloc_bytes(b"ENCRYPTED_PAYLOAD")
            elif label and "getDeviceByteArray" in label:
                handle = self.alloc_bytes(b"DEVICE_BYTES")
            else:
                handle = self.alloc_bytes(b"JNI_OBJECT")
            _ql.arch.regs.write("x0", handle)
            self.log_call(f"jni:CallStaticObjectMethod({hex(cls)}, {label}) -> {hex(handle)}")

        def call_static_long(_ql):
            cls = int(_ql.arch.regs.read("x1"))
            method = int(_ql.arch.regs.read("x2"))
            meta = self.objects.get(method)
            label = meta.text if meta else f"method@{hex(method)}"
            value = 0x10
            if label and "currentTime" in label:
                value = 1700000000
            _ql.arch.regs.write("x0", value)
            self.log_call(f"jni:CallStaticLongMethod({hex(cls)}, {label}) -> {value}")

        def call_object_method(_ql):
            obj = int(_ql.arch.regs.read("x1"))
            method = int(_ql.arch.regs.read("x2"))
            meta = self.objects.get(method)
            label = meta.text if meta else f"method@{hex(method)}"
            if label and "getSignature" in label:
                handle = self.alloc_bytes(b"OBJ_SIGNATURE")
            elif label and "getAppSignature" in label:
                handle = self.alloc_bytes(b"OBJ_APP_SIGNATURE")
            else:
                handle = self.alloc_bytes(b"OBJ")
            _ql.arch.regs.write("x0", handle)
            self.log_call(f"jni:CallObjectMethod({hex(obj)}, {label}) -> {hex(handle)}")

        def call_static_void(_ql):
            cls = int(_ql.arch.regs.read("x1"))
            method = int(_ql.arch.regs.read("x2"))
            meta = self.objects.get(method)
            label = meta.text if meta else f"method@{hex(method)}"
            _ql.arch.regs.write("x0", 0)
            self.log_call(f"jni:CallStaticVoidMethod({hex(cls)}, {label})")

        def get_object_class(_ql):
            obj = int(_ql.arch.regs.read("x1"))
            handle = self.alloc_object("jclass", text=f"class_of_{hex(obj)}")
            _ql.arch.regs.write("x0", handle)
            self.log_call(f"jni:GetObjectClass({hex(obj)}) -> {hex(handle)}")

        def get_method_id(_ql):
            cls = int(_ql.arch.regs.read("x1"))
            name = self.read_cstring(int(_ql.arch.regs.read("x2")))
            sig = self.read_cstring(int(_ql.arch.regs.read("x3")))
            handle = self.alloc_object("jmethodID", text=f"{name}{sig}")
            _ql.arch.regs.write("x0", handle)
            self.log_call(f"jni:GetMethodID({hex(cls)}, {name}, {sig}) -> {hex(handle)}")

        slots = {
            0x30: find_class,
            0x388: get_static_method_id,
            0x558: get_array_length,
            0x580: new_byte_array,
            0x640: get_byte_array_region,
            0x680: set_byte_array_region,
            0xA8: get_object_class,
            0xF8: get_method_id,
            0x108: call_object_method,
        }
        for slot, handler in slots.items():
            self.install_jni_slot(slot, handler)

    def install_helper_overrides(self) -> None:
        def fixed_bytes(label: str, data: bytes):
            def _handler(_ql):
                handle = self.alloc_bytes(data)
                _ql.arch.regs.write("x0", handle)
                self.log_call(f"helper:{label} -> {hex(handle)}")
            return _handler

        def fixed_long(label: str, value: int):
            def _handler(_ql):
                _ql.arch.regs.write("x0", value)
                self.log_call(f"helper:{label} -> {value}")
            return _handler

        self.install_helper("_Z12getSignatureP7_JNIEnvP7_jclassP8_jobject", fixed_bytes("getSignature", b"APP_SIGNATURE"))
        self.install_helper("_Z15getAppSignatureP7_JNIEnvP8_jobject", fixed_bytes("getAppSignature", b"APP_SIGNATURE"))
        self.install_helper("_Z19getEncryptedPayloadP7_JNIEnvP7_jclassP11_jbyteArrayS4_", fixed_bytes("getEncryptedPayload", b"ENCRYPTED_PAYLOAD"))
        self.install_helper("_Z18getDeviceByteArrayP7_JNIEnvP11_jbyteArray", fixed_bytes("getDeviceByteArray", b"DEVICE_BYTES"))
        self.install_helper("_Z12getKeySecureP7_JNIEnvP7_jclassP11_jbyteArrayP8_jobjectPS4_", fixed_bytes("getKeySecure", b"SECURE_KEY"))
        self.install_helper("_Z20getIVLengthByteArrayP7_JNIEnvP11_jbyteArray", fixed_long("getIVLengthByteArray", 16))
        self.install_helper("_Z11getDeviceIdP7_JNIEnvP7_jclass", fixed_bytes("getDeviceId", b"DEVICE_ID"))
        self.install_helper("_Z11currentTimeP7_JNIEnvP7_jclass", fixed_long("currentTime", 1700000000))
        self.install_helper("_Z11currentTimeP7_JNIEnvP7_jclassPl", fixed_long("currentTime(long*)", 1700000000))

    def write_jni_env(self) -> None:
        self.ql.mem.map(self.env_base, 0x2000, info="[fake-jni-env]")
        self.ql.mem.map(self.vm_base, 0x2000, info="[fake-jvm]")
        self.ql.mem.write(self.env_base, struct.pack("<Q", self.jni_env_table()))
        self.ql.mem.write(self.vm_base, struct.pack("<Q", self.vm_table()))
        for off in range(0, 0x1000, 8):
            self.ql.mem.write(self.jni_env_table() + off, struct.pack("<Q", 0))
            self.ql.mem.write(self.vm_table() + off, struct.pack("<Q", 0))
        # make the common JNI slots point to handlers
        slot_handlers = {
            0x30: 0x30,
            0x388: 0x388,
            0x558: 0x558,
            0x580: 0x580,
            0x640: 0x640,
            0x680: 0x680,
            0xA8: 0xA8,
            0xF8: 0xF8,
            0x108: 0x108,
        }
        for slot, _ in slot_handlers.items():
            self.ql.mem.write(self.jni_env_table() + slot, struct.pack("<Q", self.jni_slots[slot]))
        # the VM is only passed around as an opaque handle
        self.ql.arch.regs.write("x0", self.vm_base)

    def prepare_root_inputs(self, symbol: str) -> tuple[int, int, int, int, int, int]:
        if symbol == "JNI_OnLoad":
            return (self.vm_base, 0, 0, 0, 0, 0)
        path = self.alloc_bytes(b"/api/checksum")
        body = self.alloc_bytes(b'{"a":1}')
        uuid = self.alloc_bytes(b"12345678-1234-1234-1234-1234567890ab")
        obj = self.alloc_object("jobject", text="context")
        cls = self.alloc_object("jclass", text="EncryptionUtils")
        return (self.env_base, cls, path, body, uuid, obj)


def load_apk_member(apk_path: Path, member: str, out_dir: Path) -> Path:
    with zipfile.ZipFile(apk_path) as zf:
        zf.extract(member, path=out_dir)
    return out_dir / member


def map_elf(manual: ManualRuntime, so_path: Path) -> dict[str, int]:
    with so_path.open("rb") as fp:
        elf = ELFFile(fp)
        dynsym = elf.get_section_by_name(".dynsym")
        if dynsym is None:
            raise RuntimeError("missing dynsym")

        symbols: dict[str, int] = {}
        for sym in dynsym.iter_symbols():
            if sym.name and sym.name not in symbols:
                symbols[sym.name] = int(sym.entry["st_value"])

        load_base = manual.base
        for seg in elf.iter_segments():
            if seg["p_type"] != "PT_LOAD":
                continue
            vaddr = load_base + int(seg["p_vaddr"])
            map_start = align_down(vaddr)
            map_end = align_up(vaddr + int(seg["p_memsz"]))
            size = map_end - map_start
            perms = 0
            if seg["p_flags"] & 0x1:
                perms |= 1
            if seg["p_flags"] & 0x2:
                perms |= 2
            if seg["p_flags"] & 0x4:
                perms |= 4
            manual.map_region(map_start, size, 7, info=f"[{so_path.name}]")
            data = seg.data()
            manual.ql.mem.write(vaddr, data)
            if len(data) < int(seg["p_memsz"]):
                manual.ql.mem.write(vaddr + len(data), b"\x00" * (int(seg["p_memsz"]) - len(data)))

        # Stub imported functions and selected app-specific helpers first.
        manual.install_common_stubs()
        manual.install_jni_table()
        manual.install_helper_overrides()

        # Relocations.
        for sec in elf.iter_sections():
            if sec.name not in {".rela.dyn", ".rela.plt"}:
                continue
            for rel in sec.iter_relocations():
                rtype = rel.entry.r_info_type
                sym = dynsym.get_symbol(rel.entry.r_info_sym) if rel.entry.r_info_sym else None
                sym_name = sym.name if sym and sym.name else ""
                target = 0
                if rtype == 1027:  # R_AARCH64_RELATIVE
                    target = load_base + int(rel.entry.r_addend)
                else:
                    if sym and sym_name:
                        if sym.entry["st_shndx"] == "SHN_UNDEF":
                            target = manual.import_stubs.get(sym_name) or manual.helper_stubs.get(sym_name) or 0
                        else:
                            target = load_base + int(sym.entry["st_value"])
                        target += int(rel.entry.r_addend)
                loc = load_base + int(rel.entry.r_offset)
                manual.write_u64(loc, target)

        return symbols


def run_symbol(apk: Path, member: str, symbol: str, keystone_path: str | None, count: int) -> int:
    vendor_root = Path(__file__).resolve().parent / "vendor"
    if vendor_root.is_dir() and str(vendor_root) not in sys.path:
        sys.path.insert(0, str(vendor_root))
    if keystone_path and keystone_path not in sys.path:
        sys.path.insert(0, keystone_path)

    from qiling import Qiling
    from qiling.const import QL_ARCH, QL_OS, QL_VERBOSE

    with tempfile.TemporaryDirectory(prefix="qiling-manual-rootfs-") as rootfs_td:
        ql = Qiling(
            code=b"\xc0\x03\x5f\xd6",
            rootfs=rootfs_td,
            ostype=QL_OS.LINUX,
            archtype=QL_ARCH.ARM64,
            verbose=QL_VERBOSE.OFF,
            console=False,
        )

        manual = ManualRuntime(ql, base=0x5000_0000)
        manual.write_canary()
        manual.ql.mem.map(manual.heap_base, manual.heap_limit - manual.heap_base, info="[manual-heap]")
        manual.map_region(manual.stub_base, manual.stub_limit - manual.stub_base, info="[manual-stubs]")
        manual.map_region(manual.table_base, manual.table_limit - manual.table_base, info="[manual-jni-table]")

        with tempfile.TemporaryDirectory(prefix="qiling-manual-probe-") as td:
            so_path = load_apk_member(apk, member, Path(td))
            symbols = map_elf(manual, so_path)

            print_kv("apk", apk)
            print_kv("member", member)
            print_kv("so_path", so_path)
            print_kv("python", sys.version.split()[0])
            print_kv("platform", platform.platform())
            print_kv("dynsym_has_JNI_OnLoad", "JNI_OnLoad" in symbols)
            print_kv("dynsym_has_nmcs", "nmcs" in symbols)
            if "JNI_OnLoad" in symbols:
                print_kv("JNI_OnLoad_offset", hex(symbols["JNI_OnLoad"]))
            if "nmcs" in symbols:
                print_kv("nmcs_offset", hex(symbols["nmcs"]))

            manual.write_jni_env()

            if symbol not in symbols:
                raise RuntimeError(f"symbol not found: {symbol}")

            entry = manual.base + symbols[symbol]
            end = manual.base + 0x100000  # safe stop sentinel
            args = manual.prepare_root_inputs(symbol)

            manual.ql.arch.regs.write("x0", args[0])
            manual.ql.arch.regs.write("x1", args[1])
            manual.ql.arch.regs.write("x2", args[2])
            manual.ql.arch.regs.write("x3", args[3])
            manual.ql.arch.regs.write("x4", args[4])
            manual.ql.arch.regs.write("x5", args[5])
            manual.ql.arch.regs.write("sp", manual.heap_base + 0x10000)
            manual.ql.arch.regs.write("x30", end)

            seen: list[int] = []

            def trace(_ql, address, size):
                if len(seen) < 120:
                    seen.append(address)
                    print(
                        f"pc={hex(address)} size={size} "
                        f"x0={hex(_ql.arch.regs.read('x0'))} x1={hex(_ql.arch.regs.read('x1'))} "
                        f"x2={hex(_ql.arch.regs.read('x2'))} x3={hex(_ql.arch.regs.read('x3'))}"
                    )

            manual.ql.hook_code(trace)

            print_kv("entry_symbol", symbol)
            print_kv("entry_addr", hex(entry))
            print_kv("emu_end", hex(end))
            try:
                manual.ql.emu_start(entry, end, count=count)
                print_kv("emu", "OK")
            except Exception as exc:
                print_kv("emu", f"FAIL:{type(exc).__name__}:{exc}")

            result = manual.ql.arch.regs.read("x0")
            print_kv("final_x0", hex(result))
            if result in manual.objects:
                obj = manual.objects[result]
                if obj.data_ptr and obj.length:
                    data = bytes(manual.ql.mem.read(obj.data_ptr, obj.length))
                    print_kv("final_bytes", data.hex())
                    try:
                        print_kv("final_text", data.decode("utf-8"))
                    except Exception:
                        pass
            print_kv("trace_hits", len(seen))
            print_kv("jni_slots_seen", ",".join(sorted({manual.stub_meta[a][0] for a in manual.stub_meta if manual.stub_meta[a][0].startswith("jni_slot_")})))
            return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Manual Qiling probe for patched_signed.apk")
    parser.add_argument("--apk", required=True)
    parser.add_argument(
        "--member",
        required=True,
        help="APK member to load, e.g. lib/arm64-v8a/liba41935.so",
    )
    parser.add_argument(
        "--symbol",
        default=None,
        help="Entry symbol to execute. Defaults to JNI_OnLoad for liba41935.so and nmcs wrapper for phonepe cryptography library.",
    )
    parser.add_argument("--keystone-path", default=os.environ.get("QILING_KEYSTONE_PATH"))
    parser.add_argument("--count", type=int, default=3000)
    args = parser.parse_args()

    apk = Path(args.apk).expanduser().resolve()
    if not apk.is_file():
        eprint(f"APK not found: {apk}")
        return 2

    with tempfile.TemporaryDirectory(prefix="qiling-manual-auto-") as td:
        member_tmp = load_apk_member(apk, args.member, Path(td))
        with member_tmp.open("rb") as fp:
            elf = ELFFile(fp)
            dynsym = elf.get_section_by_name(".dynsym")
            if dynsym is None:
                eprint("missing dynsym")
                return 2
            names = {s.name: int(s.entry["st_value"]) for s in dynsym.iter_symbols() if s.name}
        symbol = args.symbol
        if symbol is None:
            symbol = "JNI_OnLoad" if "JNI_OnLoad" in names else "Java_com_phonepe_networkclient_rest_EncryptionUtils_nmcs"
        if symbol not in names:
            eprint(f"symbol not found in ELF: {symbol}")
            return 2

    return run_symbol(apk, args.member, symbol, args.keystone_path, args.count)


if __name__ == "__main__":
    raise SystemExit(main())
