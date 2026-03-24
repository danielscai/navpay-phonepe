# Build Orchestrator (`src/pipeline/orch`)

This directory contains the unified build orchestrator for composed PhonePe APK testing. Cached runtime data still lives under the repository root `cache/` directory.

## Canonical Commands

- Plan active modules:
  - `python3 src/pipeline/orch/orchestrator.py plan`
- Refresh the clean workspace:
  - `python3 src/pipeline/orch/orchestrator.py pre-cache`
- Build module artifacts:
  - `python3 src/pipeline/orch/orchestrator.py compile-modules`
- Inject artifacts into the workspace:
  - `python3 src/pipeline/orch/orchestrator.py merge`
- Build and sign the final APK:
  - `python3 src/pipeline/orch/orchestrator.py compile`
- Reuse the final signed APK when inputs have not changed:
  - `python3 src/pipeline/orch/orchestrator.py compile --reuse-artifacts`
- Run the full integration test:
  - `python3 src/pipeline/orch/orchestrator.py test --serial emulator-5554`
- Run the smoke test:
  - `python3 src/pipeline/orch/orchestrator.py test --smoke --serial emulator-5554`

Default profile is `full`. For other profiles, append `--profile <name>`, for example:

- `python3 src/pipeline/orch/orchestrator.py test --profile sigbypass-only --smoke --serial emulator-5554`

## Unified Pipeline

1. `pre-cache`
   - Refreshes `cache/profiles/<name>/workspace` from `cache/phonepe/decompiled/base_decompiled_clean`.
2. `compile-modules`
   - Builds per-module artifacts into `cache/module_artifacts/<module>/`.
   - Rebuilds only when declared `fingerprint_inputs` change.
3. `merge`
   - Merges each module from its artifact directory via `--artifact-dir`.
4. `compile`
   - Produces the final signed APK once in `cache/profiles/<name>/build/patched_signed.apk`.
5. `test`
   - Ensures module artifacts exist.
   - Reuses the final APK when possible.
   - Installs the APK and validates startup on device.

Current artifact-backed modules:

- `phonepe_sigbypass`
- `phonepe_https_interceptor`
- `phonepe_phonepehelper`

## Manual Verification

Run these commands in order if you want to inspect the real build behavior.

1. `python3 src/pipeline/orch/orchestrator.py plan`
   Meaning: prints the exact module order used by the default composed build. This confirms the orchestrator will build `sigbypass`, then `https_interceptor`, then `phonepehelper`.

2. `python3 src/pipeline/orch/orchestrator.py pre-cache`
   Meaning: recreates a clean profile workspace from the decompiled baseline. This guarantees later injection happens on a fresh tree instead of a dirty previous run.

3. `python3 src/pipeline/orch/orchestrator.py compile-modules`
   Meaning: builds the three module artifacts once into `cache/module_artifacts/`. This is the step that replaces the old “each module compiles during inject” behavior.

4. `python3 src/pipeline/orch/orchestrator.py merge`
   Meaning: merges module artifacts into the workspace once, without APK packaging.

5. `python3 src/pipeline/orch/orchestrator.py compile`
   Meaning: builds and signs the final APK from the merged workspace.

6. `python3 src/pipeline/orch/orchestrator.py compile --reuse-artifacts`
   Meaning: re-runs final APK packaging with reuse enabled. If nothing changed, you should see a cache hit and no full rebuild of the signed APK.

7. `python3 src/pipeline/orch/orchestrator.py test --smoke --serial emulator-5554`
   Meaning: runs the fastest real device validation path. It uses the built artifacts, reuses the final APK if possible, installs it, and verifies the app reaches the expected activity.

8. Run the same smoke command again:
   `python3 src/pipeline/orch/orchestrator.py test --smoke --serial emulator-5554`
   Meaning: validates incremental speedup. The second run should show artifact reuse and final APK reuse if no inputs changed.

9. `python3 src/pipeline/orch/orchestrator.py test --serial emulator-5554`
   Meaning: runs the full integration path. This keeps the same unified build flow but also checks the non-smoke validation behavior.

## Package Shortcuts

See root [`package.json`](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/package.json) for shortcuts:

- `yarn flow:plan`
- `yarn flow:pre-cache`
- `yarn flow:smali`
- `yarn flow:merge`
- `yarn flow:apk`
- `yarn flow:apk:fresh`
- `yarn flow:compile` (alias of `flow:apk`, default reuse)
- `yarn flow:compile:fresh` (force full rebuild)
- `yarn flow:test`
- `yarn flow:test:smoke`
- `yarn flow:test:sigbypass`
- `yarn flow:test:https`
- `yarn flow:test:phonepehelper`

## Notes

- All dependency rules are defined in `src/pipeline/orch/cache_manifest.json`.
- Module artifact builders are declared in `src/pipeline/orch/cache_manifest.json` under `builder`.
- Module mergers are artifact-only and must not compile during merge.
- Cache reset removes the selected cache and all downstream caches.
