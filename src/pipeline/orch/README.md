# Build Orchestrator (`src/pipeline/orch`)

This directory contains the unified build orchestrator for composed PhonePe APK testing. Cached runtime data still lives under the repository root `cache/` directory, with versioned PhonePe APK inputs materialized under `cache/apps/phonepe/snapshot_seed`.

Install the CLI once with `yarn install:orch`, then use `orch <subcommand>` directly.

## Canonical Commands

- Plan active modules:
  - `python3 src/pipeline/orch/orchestrator.py plan`
- Refresh the clean workspace:
  - `python3 src/pipeline/orch/orchestrator.py prepare`
- Build module artifacts:
  - `python3 src/pipeline/orch/orchestrator.py smali`
- Inject artifacts into the workspace:
  - `python3 src/pipeline/orch/orchestrator.py merge`
- Build and sign the final APK (default reuses cache when inputs have not changed):
  - `python3 src/pipeline/orch/orchestrator.py apk`
- Build and sign the final APK from a specific snapshot version:
  - `python3 src/pipeline/orch/orchestrator.py apk --snapshot-version 26022705`
- Force full APK rebuild:
  - `python3 src/pipeline/orch/orchestrator.py apk --fresh`
- Run the full integration test (default split-session strategy):
  - `python3 src/pipeline/orch/orchestrator.py test --serial emulator-5554`
- Run the full integration test against a specific snapshot version:
  - `python3 src/pipeline/orch/orchestrator.py test --serial emulator-5554 --snapshot-version 26022705`
- Run the full integration test with explicit split-session install:
  - `python3 src/pipeline/orch/orchestrator.py test --serial emulator-5554 --install-mode split-session`
- Run the full integration test with clean reinstall:
  - `python3 src/pipeline/orch/orchestrator.py test --serial emulator-5554 --install-mode clean`
- Run the full integration test with keep-data reinstall (`pm uninstall -k --user 0`):
  - `python3 src/pipeline/orch/orchestrator.py test --serial emulator-5554 --install-mode keep`
- Run the smoke test (default split-session strategy):
  - `python3 src/pipeline/orch/orchestrator.py test --smoke --serial emulator-5554`
- Run the smoke test with clean reinstall:
  - `python3 src/pipeline/orch/orchestrator.py test --smoke --serial emulator-5554 --install-mode clean`
- Run the smoke test with keep-data reinstall:
  - `python3 src/pipeline/orch/orchestrator.py test --smoke --serial emulator-5554 --install-mode keep`
- Run PhonePe snapshot collection with matrix:
  - `python3 src/pipeline/orch/orchestrator.py collect --matrix src/pipeline/orch/device_matrix.example.json --package com.phonepe.app`
- Resume PhonePe snapshot collection from run id:
  - `python3 src/pipeline/orch/orchestrator.py collect --matrix src/pipeline/orch/device_matrix.example.json --resume <run_id> --package com.phonepe.app`

Top-level workflow supports only `full` profile to enforce composed testing.

## Multi-App Standard Commands

- `orch collect`
- `orch collect phonepe`
- `orch info`
- `orch decompile phonepe 26022705`

## Unified Pipeline

1. `prepare`
   - Refreshes `cache/apps/phonepe/profiles/<name>/workspace` from `cache/apps/phonepe/decompiled/base_decompiled_clean`, which is built from the selected `cache/apps/phonepe/snapshot_seed`.
2. `smali`
   - Builds per-module artifacts into `cache/apps/phonepe/modules/<module>/`.
   - Rebuilds only when declared `fingerprint_inputs` change.
3. `merge`
   - Merges each module from its artifact directory via `--artifact-dir`.
4. `apk`
   - Produces the final signed APK once in `cache/apps/phonepe/profiles/<name>/build/patched_signed.apk`.
   - Default behavior reuses existing signed APK when fingerprint is unchanged.
   - Use `--fresh` to force full rebuild.
5. `test`
   - Ensures module artifacts exist.
   - Uses the same APK cache-reuse logic as `apk`.
   - By default uses split-session install (`base.apk + required splits` in one `install-multiple` session), then validates startup on device.

Current artifact-backed modules:

- `phonepe_sigbypass`
- `phonepe_https_interceptor`
- `phonepe_phonepehelper`
- `heartbeat_bridge`

## Auto-discover Module Relationships

Module relationships are resolved automatically by the orchestrator from two files:

- `src/pipeline/orch/cache_profiles.json`
  - Defines modules in the only supported top-level profile (`full`).
- `src/pipeline/orch/orchestrator.py` (`MANIFEST_REGISTRY`)
  - Defines per-module dependency metadata (`deps`, `source_cache`, `source_subdir`, `builder`, `merger`).

How to auto-discover the active relationship graph for a profile:

1. Run `python3 src/pipeline/orch/orchestrator.py plan`
2. Or use shortcut `yarn plan`

Interpretation:

- `plan` output gives the concrete module apply order for the composed full profile.
- The orchestrator then resolves each module using manifest metadata, so merge/build dependencies are not guessed manually.
- If profile or module definitions change, rerun `plan`; no extra manual mapping docs are needed.

## Manual Verification

Run these commands in order if you want to inspect the real build behavior.

1. `python3 src/pipeline/orch/orchestrator.py plan`
   Meaning: prints the exact module order used by the default composed build. This confirms the orchestrator will build `sigbypass`, then `https_interceptor`, then `phonepehelper`, then `heartbeat_bridge`.

2. `python3 src/pipeline/orch/orchestrator.py prepare`
   Meaning: recreates a clean profile workspace from the decompiled baseline. This guarantees later injection happens on a fresh tree instead of a dirty previous run.

3. `python3 src/pipeline/orch/orchestrator.py smali`
   Meaning: builds the four module artifacts once into `cache/apps/phonepe/modules/`. This is the step that replaces the old “each module compiles during inject” behavior.

4. `python3 src/pipeline/orch/orchestrator.py merge`
   Meaning: merges module artifacts into the workspace once, without APK packaging.

5. `python3 src/pipeline/orch/orchestrator.py apk`
   Meaning: builds/signs the final APK with cache reuse enabled by default.

6. `python3 src/pipeline/orch/orchestrator.py apk --fresh`
   Meaning: force full rebuild for the final APK packaging.

7. `python3 src/pipeline/orch/orchestrator.py test --smoke --serial emulator-5554`
   Meaning: runs the fastest real device validation path. It uses the built artifacts, reuses the final APK if possible, performs split-session install, and verifies the app reaches the expected activity.

8. Run the same smoke command again:
   `python3 src/pipeline/orch/orchestrator.py test --smoke --serial emulator-5554`
   Meaning: validates incremental speedup. The second run should show artifact reuse and final APK reuse if no inputs changed.

9. `python3 src/pipeline/orch/orchestrator.py test --serial emulator-5554 --install-mode keep`
   Meaning: runs the full integration path. This keeps the same unified build flow but also checks the non-smoke validation behavior.

## Package Shortcuts

See root [`package.json`](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/package.json) for shortcuts:

- `orch <subcommand> [options]`
- `yarn plan`
- `yarn prepare`
- `yarn smali`
- `yarn merge`
- `yarn apk`
- `yarn apk:fresh`
- `yarn collect:phonepe`
- `yarn log`
- `yarn logd`
- `yarn test` (default: reinstall mode, 不卸载直接 `install -r`)
- `yarn test` (default: split-session mode, one-session `install-multiple`)
- `yarn test reinstall` (full test + reinstall)
- `yarn test clean` (full test + clean install)
- `yarn test keep` (full test + `pm uninstall -k --user 0` + fresh install)
- `yarn test split-session` (full test + explicit split-session install)
- `yarn test smoke` (smoke + reinstall)
- `yarn test smoke clean` (smoke + clean install)
- `yarn test smoke keep` (smoke + keep-data reinstall)
- `yarn test smoke split-session` (smoke + explicit split-session install)
- Yarn 保留命令冲突：`yarn info`、`yarn install` 建议分别改用 `orch info` / `orch install`。

Keep-data mode note:
- `reinstall` 与 `keep` 都是保留数据语义模式，都会在拉起阶段使用更长等待窗口与重试策略。
- `reinstall`：不卸载，直接 `install -r`。
- `keep`：`pm uninstall -k --user 0` 后 fresh install。
- In preserve-data modes, runtime detection logic remains strict (activity + process + required log tags). To improve success rate without weakening checks, preserve-data modes use a longer wait window.
- Startup flow uses launcher-style entry (`MAIN` + `LAUNCHER`) and returns to Home before launch, matching manual icon tap behavior.
- If launcher start is intercepted by an existing top task, orchestrator triggers a launcher click simulation (`monkey`) fallback.
- APK install in test flow has one automatic retry for transient ADB install failures; detection criteria are unchanged.

## Notes

- All dependency rules are defined in in-code registry constants under `src/pipeline/orch/orchestrator.py`.
- Module artifact builders are declared in in-code module registry under `src/pipeline/orch/orchestrator.py` (`MANIFEST_REGISTRY`).
- Module mergers are artifact-only and must not compile during merge.
- Cache reset removes the selected cache and all downstream caches.
- Snapshot collection (`collect`) runs targets serially and writes run artifacts under `cache/apps/phonepe/snapshots/runs/<run_id>/`.
- `cache/apps/phonepe/snapshot_seed` is the active split/base seed for profile packaging; it is derived from `cache/apps/phonepe/snapshots/<package>/<versionCode>/<signingDigest>/captures/<target_id>/` and can be pinned with `--snapshot-version`.
- If Play login is blocked, `collect` returns exit code `20` and writes `blocker-report.json/.md`; complete Play login manually then rerun with `--resume <run_id>`.
- Collection workflow note: do not use `yarn orch apk --fresh` (or any fresh variant) in collection paths.
