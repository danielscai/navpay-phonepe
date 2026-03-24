# Build Orchestrator (`src/pipeline/orch`)

This directory contains the unified build orchestrator for composed PhonePe APK testing. Cached runtime data still lives under the repository root `cache/` directory.

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
- Force full APK rebuild:
  - `python3 src/pipeline/orch/orchestrator.py apk --fresh`
- Run the full integration test:
  - `python3 src/pipeline/orch/orchestrator.py test --serial emulator-5554`
- Run the smoke test:
  - `python3 src/pipeline/orch/orchestrator.py test --smoke --serial emulator-5554`

Default profile is `full`. For other profiles, append `--profile <name>`, for example:

- `python3 src/pipeline/orch/orchestrator.py test --profile sigbypass-only --smoke --serial emulator-5554`

## Unified Pipeline

1. `prepare`
   - Refreshes `cache/profiles/<name>/workspace` from `cache/phonepe/decompiled/base_decompiled_clean`.
2. `smali`
   - Builds per-module artifacts into `cache/module_artifacts/<module>/`.
   - Rebuilds only when declared `fingerprint_inputs` change.
3. `merge`
   - Merges each module from its artifact directory via `--artifact-dir`.
4. `apk`
   - Produces the final signed APK once in `cache/profiles/<name>/build/patched_signed.apk`.
   - Default behavior reuses existing signed APK when fingerprint is unchanged.
   - Use `--fresh` to force full rebuild.
5. `test`
   - Ensures module artifacts exist.
   - Uses the same APK cache-reuse logic as `apk`.
   - Installs the APK and validates startup on device.

Current artifact-backed modules:

- `phonepe_sigbypass`
- `phonepe_https_interceptor`
- `phonepe_phonepehelper`

## Auto-discover Module Relationships

Module relationships are resolved automatically by the orchestrator from two files:

- `src/pipeline/orch/cache_profiles.json`
  - Defines which modules are included for each profile (`full`, `sigbypass-only`, `https-only`, `phonepehelper-only`).
- `src/pipeline/orch/cache_manifest.json`
  - Defines per-module dependency metadata (`deps`, `source_cache`, `source_subdir`, `builder`, `merger`).

How to auto-discover the active relationship graph for a profile:

1. Run `python3 src/pipeline/orch/orchestrator.py plan --profile <name>`
2. Or use shortcut `yarn plan` (defaults to `full`)

Interpretation:

- `plan` output gives the concrete module apply order for that profile.
- The orchestrator then resolves each module using manifest metadata, so merge/build dependencies are not guessed manually.
- If profile or module definitions change, rerun `plan`; no extra manual mapping docs are needed.

## Manual Verification

Run these commands in order if you want to inspect the real build behavior.

1. `python3 src/pipeline/orch/orchestrator.py plan`
   Meaning: prints the exact module order used by the default composed build. This confirms the orchestrator will build `sigbypass`, then `https_interceptor`, then `phonepehelper`.

2. `python3 src/pipeline/orch/orchestrator.py prepare`
   Meaning: recreates a clean profile workspace from the decompiled baseline. This guarantees later injection happens on a fresh tree instead of a dirty previous run.

3. `python3 src/pipeline/orch/orchestrator.py smali`
   Meaning: builds the three module artifacts once into `cache/module_artifacts/`. This is the step that replaces the old “each module compiles during inject” behavior.

4. `python3 src/pipeline/orch/orchestrator.py merge`
   Meaning: merges module artifacts into the workspace once, without APK packaging.

5. `python3 src/pipeline/orch/orchestrator.py apk`
   Meaning: builds/signs the final APK with cache reuse enabled by default.

6. `python3 src/pipeline/orch/orchestrator.py apk --fresh`
   Meaning: force full rebuild for the final APK packaging.

7. `python3 src/pipeline/orch/orchestrator.py test --smoke --serial emulator-5554`
   Meaning: runs the fastest real device validation path. It uses the built artifacts, reuses the final APK if possible, installs it, and verifies the app reaches the expected activity.

8. Run the same smoke command again:
   `python3 src/pipeline/orch/orchestrator.py test --smoke --serial emulator-5554`
   Meaning: validates incremental speedup. The second run should show artifact reuse and final APK reuse if no inputs changed.

9. `python3 src/pipeline/orch/orchestrator.py test --serial emulator-5554`
   Meaning: runs the full integration path. This keeps the same unified build flow but also checks the non-smoke validation behavior.

## Package Shortcuts

See root [`package.json`](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/package.json) for shortcuts:

- `yarn orch <subcommand> [options]`
- `yarn plan`
- `yarn prepare`
- `yarn smali`
- `yarn merge`
- `yarn apk`
- `yarn apk:fresh`
- `yarn test:full`
- `yarn test:smoke`
- `yarn test:sigbypass`
- `yarn test:https`
- `yarn test:phonepehelper`

## Notes

- All dependency rules are defined in `src/pipeline/orch/cache_manifest.json`.
- Module artifact builders are declared in `src/pipeline/orch/cache_manifest.json` under `builder`.
- Module mergers are artifact-only and must not compile during merge.
- Cache reset removes the selected cache and all downstream caches.
