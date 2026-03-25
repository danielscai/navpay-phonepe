#!/usr/bin/env python3
from __future__ import annotations

import collections
import gzip
import math
import re
import subprocess
import sys
import zlib
import zipfile
from pathlib import Path


APK_REL = Path("samples/pev70.apk")
OUT_REL = Path("cache/unpack_probe")

TARGETS = [
    "lib/arm64-v8a/libphonepe-cryptography-support-lib.so",
    "lib/arm64-v8a/libe755b7.so",
    "assets/chimera_asset_file",
]


def entropy(data: bytes) -> float:
    counts = collections.Counter(data)
    total = len(data)
    score = 0.0
    for count in counts.values():
        p = count / total
        score -= p * math.log2(p)
    return score


def classify(data: bytes) -> str:
    if data.startswith(b"\x7fELF"):
        return "ELF"
    if data.startswith(b"PK\x03\x04"):
        return "ZIP"
    if data.startswith(b"\x1f\x8b\x08"):
        return "GZIP"
    if data.startswith(b"\x78\x9c"):
        return "ZLIB"
    if data.startswith(b"\x78\xda"):
        return "ZLIB"
    if all(32 <= b < 127 or b in (9, 10, 13) for b in data[:128]):
        return "ASCII/text"
    return "data"


def carve_and_probe(blob: bytes) -> dict[str, str]:
    findings: dict[str, str] = {}
    for sig, name in [(b"\x1f\x8b", "gzip"), (b"\x78\x9c", "zlib_9c"), (b"\x78\xda", "zlib_da")]:
        for m in re.finditer(re.escape(sig), blob):
            off = m.start()
            try:
                if name == "gzip":
                    payload = gzip.decompress(blob[off:])
                else:
                    payload = zlib.decompress(blob[off:])
                findings[f"{name}@{off}"] = f"ok:{len(payload)}:{classify(payload)}"
            except Exception as exc:  # noqa: BLE001
                findings[f"{name}@{off}"] = f"fail:{exc.__class__.__name__}"
    return findings


def extract_targets(apk: Path, outdir: Path) -> list[Path]:
    extracted: list[Path] = []
    with zipfile.ZipFile(apk) as zf:
        for name in zf.namelist():
            if name in TARGETS or name.startswith("assets/com/phonepe/cryptography/"):
                dest = outdir / "extracted" / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(zf.read(name))
                extracted.append(dest)
        for name in ("classes2.dex", "classes3.dex"):
            dest = outdir / "dex" / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(zf.read(name))
            extracted.append(dest)
    return extracted


def scan_bytes(data: bytes, needles: list[bytes]) -> list[str]:
    hits = []
    for needle in needles:
        if needle in data:
            hits.append(needle.decode("ascii", errors="ignore"))
    return hits


def main() -> int:
    repo_root = Path(__file__).resolve().parents[3]
    apk = repo_root / APK_REL
    outdir = repo_root / OUT_REL
    outdir.mkdir(parents=True, exist_ok=True)
    extract_targets(apk, outdir)

    report: list[str] = []
    report.append("# unpack_probe report")
    report.append("")
    report.append(f"- APK: `{APK_REL}`")
    report.append("- Scope: extracted only `lib/arm64-v8a/*`, `assets/com/phonepe/cryptography/*`, `assets/chimera_asset_file`, `classes2.dex`, `classes3.dex`")
    report.append("")

    for rel in TARGETS:
        p = outdir / "extracted" / rel
        data = p.read_bytes()
        report.append(f"## {rel}")
        report.append(f"- size: {len(data)} bytes")
        report.append(f"- class: {classify(data)}")
        report.append(f"- entropy: {entropy(data):.3f}")
        report.append(f"- head: `{data[:16].hex()}`")
        if rel.endswith("libphonepe-cryptography-support-lib.so"):
            probe = carve_and_probe(data)
            report.append(f"- embedded signatures: {', '.join(f'{k}={v}' for k, v in probe.items()) or 'none'}")
        if rel.endswith("libe755b7.so"):
            hits = scan_bytes(data, [
                b"JNI_OnLoad",
                b"pipe2",
                b"read",
                b"write",
                b"close",
                b"libe755b7.so",
                b"Cyj2iNNbWdeNolQ@P6X9V8fPsOgS9D9",
            ])
            report.append(f"- strings: {', '.join(hits) if hits else 'none'}")
        report.append("")

    for dex_name in ("classes2.dex", "classes3.dex"):
        p = outdir / "dex" / dex_name
        data = p.read_bytes()
        hits = scan_bytes(data, [
            b"loadLibrary",
            b"phonepe-cryptography-support-lib",
            b"PhonePeEncryptionManager",
            b"CryptoExtensionsKt",
            b"System.loadLibrary",
        ])
        report.append(f"## {dex_name}")
        report.append(f"- hits: {', '.join(hits) if hits else 'none'}")
        report.append("")

    report.append("## Conclusion")
    report.append("- `libphonepe-cryptography-support-lib.so` is not a loadable ELF in the APK extraction; it is classified as opaque data with near-max entropy.")
    report.append("- `libe755b7.so` is a real ELF and carries native-loader indicators (`JNI_OnLoad`, `pipe2`, `read`, `write`), but no direct file-output path strings were recovered.")
    report.append("- Current evidence does not yet recover a second-stage ELF that `file`/ELF tooling can load from `libphonepe-cryptography-support-lib.so`.")
    report.append("")

    (outdir / "report.md").write_text("\n".join(report), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
