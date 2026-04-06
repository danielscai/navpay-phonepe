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

## Orchestrator E2E Result
### Smoke
Command:
`python3 src/pipeline/orch/orchestrator.py test --smoke --serial emulator-5554 --install-mode clean`

Result: PASS
- install path: split-session (`install-multiple --no-incremental`)
- selected splits logged:
  - `split_config.arm64_v8a.apk`
  - `split_config.xxhdpi.apk`
- launch evidence:
  - `Status: ok`
  - `Activity: com.phonepe.app/.login.ui.Navigator_LoginNavigationActivity`
  - `测试结果：成功（smoke）`

### Full
Command:
`python3 src/pipeline/orch/orchestrator.py test --serial emulator-5554 --install-mode clean`

Result: PASS
- install path: split-session (`install-multiple --no-incremental`)
- selected splits logged:
  - `split_config.arm64_v8a.apk`
  - `split_config.xxhdpi.apk`
- launch evidence:
  - `Status: ok`
  - `Activity: com.phonepe.app/.login.ui.Navigator_LoginNavigationActivity`
- static injection evidence:
  - `[PROFILE] static injection verified: SIGBYPASS, HTTPS, PPHELPER, HEARTBEAT`

## --fresh Workflow Check
Command:
`rg -n "apk --fresh|yarn orch apk --fresh" docs src/pipeline/orch -S`

Result:
- no new required `--fresh` workflow step was introduced by this implementation;
- existing historical references remain in README/规范/计划文档.

## Conclusion
Phase A and Phase B are both verified in this environment.
- External verifier can deterministically select required splits and validate one-session install + first launch.
- Orchestrator `test --install-mode clean` now uses split-session path and passes smoke/full e2e.
- Workflow remains compliant with repository constraint: no `yarn orch apk --fresh` usage was introduced in execution path.
