# 2026-04-06 PhonePe Base APK Split-Session Validation

## Device Info
- Date: 2026-04-06
- Serial: `emulator-5554`
- Model: `sdk_gphone64_arm64`
- Supported ABIs: `arm64-v8a`
- Physical density: `420` (mapped to `xxhdpi`)

## Selected Artifacts
- Base APK: `cache/phonepe/from_device/base.apk`
- Splits dir: `cache/phonepe/from_device`
- Target APK (existence check): `cache/profiles/full/build/patched_signed.apk`
- Selected install set (auto):
  - `cache/phonepe/from_device/base.apk`
  - `cache/phonepe/from_device/split_config.arm64_v8a.apk`
  - `cache/phonepe/from_device/split_config.xxhdpi.apk`

## Fresh Install Result
Command:
`python3 scripts/verify_phonepe_split_session_install.py --serial emulator-5554 --base-apk cache/phonepe/from_device/base.apk --splits-dir cache/phonepe/from_device --target-apk cache/profiles/full/build/patched_signed.apk --package com.phonepe.app --activity com.phonepe.app/com.phonepe.app.ui.activity.SplashScreenActivity`

Result: PASS
- install: `Success`
- launch: launcher fallback triggered (`am start` activity not present on this build), then `monkey` injected 1 event successfully.

## Replay Result
Same command executed twice.

Run #1: PASS
- install: `Success`
- launch: `Events injected: 1`

Run #2: PASS
- install: `Success`
- launch: `Events injected: 1`

## Negative Case Result
Setup: use temporary splits dir without `split_config.xxhdpi.apk`.

Command:
`python3 scripts/verify_phonepe_split_session_install.py --serial emulator-5554 --base-apk /var/folders/w_/l21n2b7x5jdc__pvl4wpfh2r0000gn/T/tmp.wEGa0fuh3t/base.apk --splits-dir /var/folders/w_/l21n2b7x5jdc__pvl4wpfh2r0000gn/T/tmp.wEGa0fuh3t --target-apk cache/profiles/full/build/patched_signed.apk --package com.phonepe.app --activity com.phonepe.app/com.phonepe.app.ui.activity.SplashScreenActivity`

Result: EXPECTED FAIL
- error: `SELECT_SPLIT_FAILED: missing density split for xxhdpi`

## Conclusion
Phase A external verifier is validated for this environment:
- can resolve required ABI+density splits dynamically;
- can install base+required splits in one `adb install-multiple --no-incremental` transaction;
- can validate first-launch success via launcher fallback path when configured activity component is unavailable;
- can fail fast with explicit `SELECT_SPLIT_FAILED` diagnostics for missing required splits.
