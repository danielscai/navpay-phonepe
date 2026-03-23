# Build Orchestrator (`src/build-orchestrator`)

This directory contains the unified build orchestrator for composed PhonePe APK testing. Cached runtime data still lives under the repository root `cache/` directory.

## Canonical Commands

- Plan active modules:
  - `python3 src/build-orchestrator/orchestrator.py plan`
- Refresh the clean workspace:
  - `python3 src/build-orchestrator/orchestrator.py pre-cache`
- Build module artifacts:
  - `python3 src/build-orchestrator/orchestrator.py build-modules`
- Inject artifacts into the workspace:
  - `python3 src/build-orchestrator/orchestrator.py inject`
- Build and sign the final APK:
  - `python3 src/build-orchestrator/orchestrator.py compile`
- Reuse the final signed APK when inputs have not changed:
  - `python3 src/build-orchestrator/orchestrator.py compile --reuse-artifacts`
- Run the full integration test:
  - `python3 src/build-orchestrator/orchestrator.py test --serial emulator-5554`
- Run the smoke test:
  - `python3 src/build-orchestrator/orchestrator.py test --smoke --serial emulator-5554`

Default profile is `full`. For other profiles, append `--profile <name>`, for example:

- `python3 src/build-orchestrator/orchestrator.py test --profile sigbypass-only --smoke --serial emulator-5554`

## Unified Pipeline

1. `pre-cache`
   - Refreshes `cache/profile_<name>_workspace` from `cache/phonepe_decompiled/base_decompiled_clean`.
2. `build-modules`
   - Builds per-module artifacts into `cache/module_artifacts/<module>/`.
   - Rebuilds only when declared `fingerprint_inputs` change.
3. `compile`
   - Injects each module from its artifact directory via `--artifact-dir`.
   - Produces the final signed APK once in `cache/profile_<name>_build/patched_signed.apk`.
4. `test`
   - Ensures module artifacts exist.
   - Reuses the final APK when possible.
   - Installs the APK and validates startup on device.

Current artifact-backed modules:

- `phonepe_sigbypass`
- `phonepe_https_interceptor`
- `phonepe_phonepehelper`

## Manual Verification

Run these commands in order if you want to inspect the real build behavior.

1. `python3 src/build-orchestrator/orchestrator.py plan`
   Meaning: prints the exact module order used by the default composed build. This confirms the orchestrator will build `sigbypass`, then `https_interceptor`, then `phonepehelper`.

2. `python3 src/build-orchestrator/orchestrator.py pre-cache`
   Meaning: recreates a clean profile workspace from the decompiled baseline. This guarantees later injection happens on a fresh tree instead of a dirty previous run.

3. `python3 src/build-orchestrator/orchestrator.py build-modules`
   Meaning: builds the three module artifacts once into `cache/module_artifacts/`. This is the step that replaces the old “each module compiles during inject” behavior.

4. `python3 src/build-orchestrator/orchestrator.py compile`
   Meaning: injects the artifacts into the workspace and builds the final APK exactly once. This lets you verify that module build and APK packaging are now separate concerns.

5. `python3 src/build-orchestrator/orchestrator.py compile --reuse-artifacts`
   Meaning: re-runs final APK packaging with reuse enabled. If nothing changed, you should see a cache hit and no full rebuild of the signed APK.

6. `python3 src/build-orchestrator/orchestrator.py test --smoke --serial emulator-5554`
   Meaning: runs the fastest real device validation path. It uses the built artifacts, reuses the final APK if possible, installs it, and verifies the app reaches the expected activity.

7. Run the same smoke command again:
   `python3 src/build-orchestrator/orchestrator.py test --smoke --serial emulator-5554`
   Meaning: validates incremental speedup. The second run should show artifact reuse and final APK reuse if no inputs changed.

8. `python3 src/build-orchestrator/orchestrator.py test --serial emulator-5554`
   Meaning: runs the full integration path. This keeps the same unified build flow but also checks the non-smoke validation behavior.

## Package Shortcuts

See root [`package.json`](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/package.json) for shortcuts:

- `yarn orch:plan`
- `yarn orch:pre-cache`
- `yarn orch:build-modules`
- `yarn orch:compile`
- `yarn orch:compile:reuse`
- `yarn orch:test`
- `yarn orch:test:smoke`
- `yarn orch:test:sigbypass`
- `yarn orch:test:https`
- `yarn orch:test:phonepehelper`

## Compatibility

Legacy module aliases are still accepted:

- `python3 src/build-orchestrator/orchestrator.py sigbypass <action>`
- `python3 src/build-orchestrator/orchestrator.py https <action>`
- `python3 src/build-orchestrator/orchestrator.py phonepehelper <action>`

`cache_manager.py` remains only as a compatibility shim. New usage should call `orchestrator.py`.

## Notes

- All dependency rules are defined in `src/build-orchestrator/cache_manifest.json`.
- Module artifact builders are declared in `src/build-orchestrator/cache_manifest.json` under `builder`.
- Cache reset removes the selected cache and all downstream caches.
