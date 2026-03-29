# Heartbeat Bridge

Standalone heartbeat bridge for the injected PhonePe app.

This module is intentionally independent from `https_interceptor`:

- `HeartbeatBridgeProvider` owns the content-provider entrypoint.
- `HeartbeatScheduler` owns the 30s cadence.
- `HeartbeatSender` owns the HTTP transport and uses runtime `okhttp3` classes via reflection.

## Build

```bash
cd src/apk/heartbeat_bridge
./scripts/compile.sh
```

Outputs:

- `build/classes.dex`
- `build/smali/`

## Merge

```bash
cd src/apk/heartbeat_bridge
./scripts/merge.sh --artifact-dir ./build/smali /path/to/decompiled/base
```

The merge step copies the bridge smali into the target APK workspace and injects the provider declaration.

## Heartbeat behavior

- `call("heartbeat", ...)` returns a local bundle immediately and triggers an async heartbeat upload.
- The scheduler sends once on start and then every 30 seconds.
- Endpoint override:
  - `-Dnavpay.heartbeat.endpoint=<url>`
- Default fallback:
  - emulator: `http://10.0.2.2:3000/api/device/heartbeat`
  - device: `http://127.0.0.1:3000/api/device/heartbeat`
