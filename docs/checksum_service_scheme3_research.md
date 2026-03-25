# Checksum Service Scheme3 Research (patched_signed)

Date: 2026-03-25
Target APK: `cache/profiles/full/build/patched_signed.apk`

## Goal

Validate whether Scheme 3 (native checksum extraction/emulation) can produce **real** `X-REQUEST-CHECKSUM-V4` values without relying on GUI emulator workflows.

## Scope

1. `unidbg` path with `liba41935.so` and `libphonepe-cryptography-support-lib.so`
2. Authenticity check against real in-app checksum service (`127.0.0.1:19090/checksum`)
3. Input-sensitivity checks (`path`/`body`/`uuid`)

## Key Findings

### 1) Native entrypoints in patched_signed

- `EncryptionUtils` now loads `a41935`:
  - `System.loadLibrary("a41935")`
- `libphonepe-cryptography-support-lib.so` is a real ELF in this APK (not opaque data as in older sample).
- `liba41935.so` is also a real ELF, but it does **not** directly register `nmcs`.

### 2) unidbg execution status

- `liba41935.so` path: `JNI_OnLoad` succeeds, but `nmcs` not directly callable from that library path.
- `libphonepe-cryptography-support-lib.so` path: `nmcs` symbol is callable in unidbg.
- To make call chain execute, multiple JNI/Android stubs were added (Context/PackageManager/Signature and CH helper fallbacks).
- With these stubs, unidbg returns non-empty checksum-like output.

New validation on `patched_signed`:

- `nm -D cache/retest_patched/libphonepe-cryptography-support-lib.so` shows direct exports:
  - `Java_com_phonepe_networkclient_rest_EncryptionUtils_nmcs`
  - `_Z17newChecksumSecure...`
  - `_Z12getSignature...`
  - `_Z11getDeviceId...`
  - `_Z11currentTime...`
- `objdump -d --demangle` confirms `Java_com_phonepe_networkclient_rest_EncryptionUtils_nmcs` directly calls `newChecksumSecure(...)`.
- `liba41935.so` only exposes/注册了一个混淆入口 `r(...)`；当前 unidbg 里没有发现它把 `nmcs` 注册到 `EncryptionUtils`。

### 3) Authenticity verdict

Current Scheme 3 output is **not authentic yet**.

Evidence:

- Real service output (same `path/body/uuid`) changes across repeated calls.
- Current unidbg output is template-like and not aligned with observed real service format/entropy.
- Path/body sensitivity under current unidbg stubs is insufficient (behavior dominated by stubs/fallbacks), indicating semantic drift from native production behavior.

This round's concrete evidence:

- Real service (`127.0.0.1:19090/checksum`) was online and returned valid data on `2026-03-25`.
- Same tuple, three consecutive calls, all different:
  - call #1 checksum starts with `OGU4ZjE2TWo3...`
  - call #2 checksum starts with `OGU4ZjE2TWs3...`
  - call #3 checksum starts with `OGU4ZjE2Mk83...`
- Decoding one real checksum from Base64 yields a 138-byte ASCII payload such as:
  - `8e8f16Mj7e5cMgN1-3f125x54-4cem0B2WmUE0...==OYOUwBmjZlgPXrsd`
- Current unidbg result for the same tuple is deterministic and only 48 bytes:
  - `8e8f124-7e5c4cst-3f1ub-s4-4cignature8e8f7e5c-3f1`
- Running unidbg twice with the same tuple returns the exact same checksum.
- New probe instrumentation shows the current fake success path depends on:
  - `5` Android/JNI stub hits (`PackageManager`, `PackageInfo.signatures`, `Signature.toByteArray`, etc.)
  - `12` `CH->*` fallback hits
- Critical verification:
  - with `PROBE_CH_MODE=disable`, the very first `CH->ba([B)[B` fallback removed causes `nmcs` to collapse to `null`
  - with `PROBE_CH_MODE=empty`, forcing `CH` byte-array helpers to return empty bytes also causes `nmcs` to fail
- Therefore the current 48-byte output is not a partially-correct native checksum. It is a fallback-driven artifact.
- Batch helpers on the patched target now reproduce the same issue consistently:
  - `run_matrix.sh` shows the same fake checksum across all tested load-order / `libc++` combinations
  - `run_input_sensitivity.sh` shows `path` and `body` changes do not alter the fake checksum, while `uuid` only changes a visible substring

## Repro Commands

### A. Real service sampling (ground truth)

```bash
adb -s emulator-5554 forward tcp:19090 tcp:19090
curl -sS http://127.0.0.1:19090/checksum \
  -H 'Content-Type: application/json' \
  -d '{"path":"/apis/tstore/v2/units/changes","body":"","uuid":"8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001"}'
```

Run twice with same payload; checksum differs.

### B. unidbg output on `patched_signed`

```bash
mvn -f src/research/unidbg_checksum_poc/pom.xml -q -DskipTests exec:java \
  -Dprobe.load.order=libcxx-first \
  -Dprobe.load.libcxx=true \
  -Dexec.args="$(pwd)/cache/retest_patched/extract/lib/arm64-v8a/libphonepe-cryptography-support-lib.so /apis/tstore/v2/units/changes 8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001"
```

### C. Native symbol / call-chain validation

```bash
nm -D cache/retest_patched/libphonepe-cryptography-support-lib.so | rg 'nmcs|getSignature|getDeviceId|currentTime|newChecksumSecure'
objdump -d --demangle cache/retest_patched/libphonepe-cryptography-support-lib.so | sed -n '190,340p'
```

### D. Batch validation helpers

```bash
src/research/unidbg_checksum_poc/scripts/run_matrix.sh
src/research/unidbg_checksum_poc/scripts/run_input_sensitivity.sh
```

Current status:

- `run_probe.sh` / `verify_feasibility.sh` / `run_matrix.sh` / `run_input_sensitivity.sh` now default to `cache/profiles/full/build/patched_signed.apk`.
- The old `samples/pev70.apk` default has been removed from the Scheme 3 probe path.

### E. Live-vs-unidbg compare helper

```bash
src/research/unidbg_checksum_poc/scripts/compare_with_live.sh
PROBE_CH_MODE=disable src/research/unidbg_checksum_poc/scripts/compare_with_live.sh
PROBE_CH_MODE=empty src/research/unidbg_checksum_poc/scripts/compare_with_live.sh
```

## Current Decision

- Scheme 3 is **partially executable** (can force non-empty return).
- Scheme 3 is **not production-usable** for real checksum generation yet.

## Relaxed Acceptance Check (Structure-Only)

User-updated acceptance rule on `2026-03-25`:

- No longer require parity with local live checksum service.
- If Scheme 3 can output a checksum with a **similar Base64 length / decoded ASCII structure**, it can be treated as successful for the current milestone.

Reference sample provided by user:

- sample checksum length: `200`
- sample decoded ASCII length: `148`
- sample decoded prefix: `2ac842Qa264dYj/I-648mG4n3-4dFu6xy3adb5HVWvduhUdswALxiMvvPYVTU6Bo`

Current `unidbg` status under `PROBE_CH_MODE=emulate`:

- checksum length: `184`
- decoded ASCII length: `138`
- decoded prefix: `8e8f16WT7e5cjV8l-3f1Mcft4-4c3mq2id5B73QFhBGg7qXjn4e/o40UzLfGZzwY`
- still produced by the real native `nmcs` entrypoint, with Java-side `CH` helpers emulated

Conclusion for this relaxed gate:

- Scheme 3 now **meets the structure-only success criterion**.
- It produces a Base64 checksum of the same general class:
  - similar total length (`184` vs `200`)
  - similar decoded ASCII payload length (`138` vs `148`)
  - similar tokenized payload shape (`prefix-segment-segment-...==suffix`)
- Therefore Scheme 3 can be considered **successful for “checksum-like output generation”**, while still remaining **not parity-accurate** with the real in-app generator.

## HTTP Packaging

Scheme 3 is now wrapped as a local HTTP service under the unidbg PoC module.

Default bind:

- `127.0.0.1:19190`

Endpoints:

- `GET /health`
  - returns service health
- `POST /checksum`
  - input: `{"path":"...","body":"...","uuid":"..."}`
  - output includes:
    - `checksum`
    - `length`
    - `decodedLength`
    - `mode`
    - `structureOk`
    - `decodedPreview`
- `POST /validate`
  - same input
  - returns the same structure fields, intended for manual verification

Manual startup:

```bash
src/research/unidbg_checksum_poc/scripts/start_http_service.sh
```

Manual verification:

```bash
curl -sS http://127.0.0.1:19190/health
curl -sS http://127.0.0.1:19190/checksum \
  -H 'Content-Type: application/json' \
  -d '{"path":"/apis/tstore/v2/units/changes","body":"","uuid":"8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001"}'
curl -sS http://127.0.0.1:19190/validate \
  -H 'Content-Type: application/json' \
  -d '{"path":"/apis/tstore/v2/units/changes","body":"","uuid":"8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001"}'
```

Success criterion for HTTP packaging:

- `/health` returns `ok=true`
- `/checksum` returns `ok=true`
- `/checksum.data.structureOk=true`
- `/validate.data.structureOk=true`

## Blocking Reasons

1. `nmcs` in `patched_signed` is not standalone hashing; it enters `newChecksumSecure(...)`, which depends on runtime-derived values (`getSignature`, `getDeviceId`, `currentTime`).
2. unidbg currently stubs Android runtime objects too aggressively:
   - fake package signature
   - fake package/code/data paths
   - synthetic `Context` and `PackageManager`
3. `CH->*` fallbacks in `UnidbgChecksumProbe` are currently the decisive gap:
   - in `passthrough` mode they synthesize the fake 48-byte checksum
   - in `disable` / `empty` mode `nmcs` fails outright
   - this proves the current result is produced by fallback semantics, not by authentic native completion
4. Real service clearly contains state/time-sensitive behavior:
   - same tuple produces different outputs
   - output length/entropy profile is far from current unidbg result
5. Even after removing the old `pev70` default from the Scheme 3 tooling, the parity gap remains unchanged; the blocker is runtime semantics, not target selection.

## Root Cause Hypothesis

Most likely root cause is **not** that Scheme 3 chose the wrong library. The patched sample already exposes a callable `nmcs` in `libphonepe-cryptography-support-lib.so`.

The actual root cause is behavioral drift after entering `newChecksumSecure(...)`:

1. The native code expects real Android runtime state (signature/device/time).
2. The PoC supplies placeholder values and generic `CH` fallbacks.
3. Those fallbacks satisfy control flow enough to return bytes, but the returned bytes are not the real checksum construction.

Current evidence strongly supports this hypothesis because:

- `nmcs` is exported and callable.
- the result shape is human-readable/template-like instead of high-entropy Base64 payload.
- `path` and `body` changes do not materially affect current unidbg output.
- `uuid` only partially affects the output string.

## Possible Solutions

### Option 1: Keep real in-app checksum service as the production path

Status: **validated and immediately usable**

- `127.0.0.1:19090/checksum` is reachable and healthy on the current emulator.
- This path calls the real `EncryptionUtils.jnmcs(...)` inside app process.
- It already reproduces live variance behavior that Scheme 3 currently cannot emulate.

Conclusion:

- If the goal is reliable request replay today, this is the best path.
- Scheme 3 can continue as research, not as the mainline generator.

### Option 2: Turn Scheme 3 into a high-fidelity runtime emulation

Status: **possible, but not yet validated**

Required work:

1. Remove generic `CH->*` byte-array fallbacks.
2. Replace them with behaviorally accurate implementations, derived from decompiled Java/native call expectations.
3. Feed realistic package signature / device-id / filesystem / app metadata.
4. Reproduce time source semantics used by `currentTime(...)`.
5. Build parity tests against captured real tuples.

Acceptance gate:

- exact checksum match for at least 20 captured tuples
- plus repeated-call variance pattern consistent with real service

Assessment:

- Technically possible.
- Considerably more expensive than continuing to use the in-app checksum server.

### Option 3: Hybrid approach: hook/export the real native result instead of full emulation

Status: **highly practical**

Approach:

- Stay inside a real Android process.
- Hook or wrap `EncryptionUtils.jnmcs(...)` / `nmcs(...)`.
- Expose the result through the existing local HTTP service or another IPC surface.

Why this is attractive:

- It preserves real signature/device/time state automatically.
- It avoids rebuilding PhonePe's runtime semantics in unidbg.
- It is much closer to the already-working `phonepehelper` path.

Conclusion:

- If the user wants a “headless but still real” solution, this is the best alternative to full emulator GUI interaction.

### Option 4: Keep pushing generic unidbg stubs

Status: **not recommended**

- Current verification shows this produces deterministic template output, not authentic checksum material.
- Continuing in the current direction without parity instrumentation is likely to waste time.

## Next Work (Scheme 3)

1. Research tooling cleanup is now done for the Scheme 3 path:
   - `run_probe.sh` / `verify_feasibility.sh` / `run_matrix.sh` / `run_input_sensitivity.sh` now default to `patched_signed.apk`
   - the remaining work is no longer target selection; it is runtime parity
2. Capture a real checksum corpus from the live service:
   - same tuple repeated N times
   - path/body/uuid variants
   - timestamp window for each capture
3. Instrument the native dependency points:
   - `getSignature`
   - `getDeviceId`
   - `currentTime`
   - any `CH->*` helper actually reached in the `nmcs -> newChecksumSecure` chain
4. Only after the above, replace one dependency at a time and re-run parity checks.
5. If short-term deliverable matters more than pure emulation, keep using the real local checksum service as the operational solution.
