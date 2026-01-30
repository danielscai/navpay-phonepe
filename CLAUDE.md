# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **security research and reverse engineering project** analyzing a coordinated malware ecosystem targeting Indian UPI payment applications. It contains APK binaries, decompiled sources, and detailed analysis reports — not a software development project with build/test systems.

## Repository Structure

```
.
├── samples/                    # APK 样本文件 (git tracked)
│   ├── pev70.apk              # 恶意注入的 PhonePe
│   ├── Mov 4.5.3.apk          # MovPay 主控应用
│   ├── ip4.6.apk              # InstallPlugin 插件
│   └── PhonePe APK v24.08.23.apk  # 原版 PhonePe
├── docs/                       # 分析文档 (git tracked, 中文)
├── tools/                      # 工具脚本 (git tracked)
│   └── decompile.sh           # 反编译脚本
├── src/                        # 源代码 (git tracked)
│   └── signature_bypass/      # 签名绕过模块
├── decompiled/                 # 反编译产物 (git ignored)
│   ├── *_apktool/             # Smali + 资源文件
│   └── *_jadx/                # Java 源码
└── temp/                       # 临时文件 (git ignored)
```

### Regenerating Decompiled Files

```bash
./tools/decompile.sh --all        # 反编译所有 APK
./tools/decompile.sh pev70        # 仅反编译 pev70.apk
./tools/decompile.sh -f pev70     # 强制重新反编译
./tools/decompile.sh -t ip mov    # 仅用 apktool 反编译
```

For reading decompiled logic, prefer `*_jadx/` directories. Use `*_apktool/` for manifest details, resource files, and smali-level analysis.

### Analysis Reports (docs/)
- `pev70分析.md` — PhonePe repackaging: architecture, permissions, device fingerprinting
- `pev70注入代码详细分析.md` — Line-by-line breakdown of 80+ injected classes in classes14.dex
- `pev70_PayList接口与交易记录获取分析.md` — Transaction data exfiltration mechanisms
- `ip4.6分析.md` — Plugin architecture, FRP tunnel config, proxy setup
- `mov分析.md` — Host app structure, Flutter framework, AIDL IPC, plugin management

## Malware Ecosystem Architecture

Three applications work together as a coordinated attack platform:

```
MovPay (Host App)          InstallPlugin             Injected PhonePe
─────────────────          ─────────────             ─────────────────
Flutter UI frontend        Device fingerprinting     Repackaged with classes14.dex
AIDL IPC coordinator       APK install/upgrade       OkHttp interception
SOCKS5 proxy service       SOCKS5 proxy (Go)         UPI PIN/MPIN/OTP capture
Plugin lifecycle mgmt      FRP reverse tunnel        Token extraction & sync
C2 communication hub       Persistence service       Multi-channel exfiltration
```

**Data flow**: User opens injected PhonePe → Hook framework (libpine.so) activates → interceptors capture credentials/tokens/transactions → data exfiltrated via 6 independent channels (AIDL IPC, WebSocket, OTLP gRPC, Azure Blob/Table, Sentry, HTTP).

## Key Technical Components

| Component | Technology | Location |
|-----------|-----------|----------|
| ART method hooking | Pine framework (libpine.so) | pev70 native libs |
| Network interception | OkHttp3 custom Interceptor | pev70 classes14.dex |
| Proxy/tunnel | Go binary (libgoproxy.so) + FRP | ip4.6 native libs |
| Cross-process IPC | AIDL (IPayService) | MovPay ↔ pev70 |
| Host app UI | Flutter/Dart (libapp.so) | Mov 4.5.3 |
| Cloud exfiltration | Azure Blob + Table Storage | pev70 injected code |
| Telemetry | OpenTelemetry (OTLP) over gRPC | pev70 injected code |

## C2 Infrastructure

- **Proxy/Tunnel**: proxy.techru.cc, f.dlcenter.net, 20.205.26.238:7000
- **Logging**: log.financeforge.win, otlp.techru.cc:443
- **API servers**: appssy.movxx.net, testzf.rushcard.top
- **Storage**: techrures.blob.core.windows.net, techrures.table.core.windows.net
- **Error tracking**: o4510013278519296.ingest.us.sentry.io

## Working with This Repository

- All analysis reports are in **Chinese (Simplified)**
- The JADX-decompiled Java in `decompiled/*_jadx/sources/` is the primary reference for understanding application logic
- AndroidManifest.xml in `decompiled/*_apktool/` directories contains permission declarations, component registrations, and intent filters
- pev70 has 15 DEX files; the injected malicious code is concentrated in **classes14.dex**
