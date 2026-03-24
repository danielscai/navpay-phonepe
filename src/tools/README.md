# Injection Test Tools (src/tools)

This directory contains only orchestrator-facing wrappers and behavior verification helpers.

## Quick start

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
- Run full profile smoke test through the unified orchestrator:
  - `./test_profile_smoke.sh`
  - `./test_profile_smoke.sh full emulator-5554`

## Unified artifact run directory

Use one run directory to hold both archive outputs and probe outputs:

1. `./archive_apk.sh --apk /path/to/app.apk --label baseline`
2. Read printed `Archived to: <run_dir>`
3. `./behavior_probe.sh --package com.phonepe.app --output <run_dir>`

This keeps `apk.sha256` + `meta.json` + `probe.log` in the same directory.

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
- `test_profile_smoke.sh`, `test_profile_full.sh`, and `test_module_independent.sh` are thin delegators to `python3 src/orch/orchestrator.py`.
- Module-local compilation and injection details now live under each module directory and are consumed only through the orchestrator.
