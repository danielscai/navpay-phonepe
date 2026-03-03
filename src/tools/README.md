# Injection Test Tools (src/tools)

This directory contains the unified injector and test helpers used during module migration.

## Quick start

- Inject a module into a decompiled APK:
  - `./inject.sh --decompiled /path/to/decompiled/base --module signature_bypass`

- Test signature_bypass end-to-end:
  - `./test_signature_bypass.sh --target-dir /path/to/decompiled/base`
  - or `./test_signature_bypass.sh --sample pev70`

- Archive an APK snapshot for baseline/candidate comparison:
  - `./archive_apk.sh --apk /path/to/app.apk --label baseline`
  - `./archive_apk.sh --apk /path/to/app.apk --label candidate --output-root artifacts`

- Probe behavior from APK or installed package:
  - `./behavior_probe.sh --apk /path/to/app.apk --package com.phonepe.app --no-launch`
  - `./behavior_probe.sh --package com.phonepe.app --wait-seconds 12`
  - `./behavior_probe.sh --package com.phonepe.app --output /path/to/archive_run_dir`

- Compare baseline/candidate probe outputs:
  - `./compare_behavior.sh --baseline artifacts/baseline/run1 --candidate artifacts/runs/run2`
  - `./compare_behavior.sh --baseline /path/to/baseline/probe.json --candidate /path/to/candidate/probe.json`
- Run independent module smoke loop via profile pipeline:
  - `./test_module_independent.sh`
  - `./test_module_independent.sh emulator-5554`
- Run full profile integration test:
  - `./test_profile_full.sh`
  - `./test_profile_full.sh emulator-5554`

## Unified artifact run directory

Use one run directory to hold both archive outputs and probe outputs:

1. `./archive_apk.sh --apk /path/to/app.apk --label baseline`
2. Read printed `Archived to: <run_dir>`
3. `./behavior_probe.sh --package com.phonepe.app --output <run_dir>`

This keeps `apk.sha256` + `meta.json` + `probe.log` in the same directory.

With package scripts (root `package.json`):

- `yarn artifact:archive -- --apk /path/to/app.apk --label baseline`
- `RUN_DIR=<run_dir> yarn artifact:probe:archive -- --package com.phonepe.app`
- `yarn artifact:compare -- --baseline <baseline_run_dir> --candidate <candidate_run_dir>`
- `yarn test:independent`
- `yarn test:full`

## Behavior parity workflow (baseline vs candidate)

1. Archive baseline APK:
   - `yarn baseline:archive --apk /path/to/baseline.apk`
   - Keep the printed `Archived to: <baseline_run_dir>`
2. Probe baseline behavior:
   - `BASELINE_RUN_DIR=<baseline_run_dir> yarn probe:baseline -- --package com.phonepe.app`
3. Archive candidate APK:
   - `yarn artifact:archive -- --apk /path/to/candidate.apk --label candidate`
   - Keep the printed `Archived to: <candidate_run_dir>`
4. Probe candidate behavior:
   - `CANDIDATE_RUN_DIR=<candidate_run_dir> yarn probe:candidate -- --package com.phonepe.app`
5. Compare behavior parity:
   - `yarn probe:compare -- --baseline <baseline_run_dir> --candidate <candidate_run_dir>`

`probe.json` now includes mandatory parity keys:
`launch_ok`, `login_activity_seen`, `sigbypass_tag`, `https_tag`, `pphelper_tag`, `crash_detected`.

## Notes

- `decompile.sh` is a wrapper for the repository root `tools/decompile.sh`.
- The injector writes `assets/inject_manifest.json` in the target APK directory.
