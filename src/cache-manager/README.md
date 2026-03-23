# Cache Management (src/cache-manager)

This directory contains the **cache management configuration and scripts**. The actual cached data is stored in the repository root `cache/` directory (gitignored).

## Commands

- Primary command contract (profile pipeline):
  - Plan modules: `python3 src/cache-manager/orchestrator.py profile full plan`
  - Pre-cache workspace: `python3 src/cache-manager/orchestrator.py profile full pre-cache`
  - Build module artifacts: `python3 src/cache-manager/orchestrator.py profile full build-modules`
  - Inject profile modules: `python3 src/cache-manager/orchestrator.py profile full inject`
  - Compile profile workspace: `python3 src/cache-manager/orchestrator.py profile full compile`
  - Compile profile workspace with final APK reuse: `python3 src/cache-manager/orchestrator.py profile full compile --reuse-artifacts`
  - Test profile build (full, requires adb/emulator): `python3 src/cache-manager/orchestrator.py profile full test --serial emulator-5554`
  - Test profile build (smoke, faster): `python3 src/cache-manager/orchestrator.py profile full test --smoke --serial emulator-5554`
  - Smoke helper script: `bash src/tools/test_profile_smoke.sh full [serial]`

Smoke vs full:
- `full`: existing strict path (default timeout, uninstall+reinstall, verify all profile module log tags).
- `smoke`: fast path (shorter timeout, still uninstall+reinstall today, skip secondary module log tag verification).

## Unified build pipeline

The canonical pipeline is now profile-based and split into four explicit stages:

1. `pre-cache`
   - Refresh `cache/profile_<name>_workspace` from `cache/phonepe_decompiled/base_decompiled_clean`.
2. `build-modules`
   - Build per-module artifacts once into `cache/module_artifacts/<module>/`.
   - Rebuild only when declared `fingerprint_inputs` change.
3. `compile`
   - Inject each module from its artifact directory via `--artifact-dir`.
   - Build and sign the final APK once into `cache/profile_<name>_build/patched_signed.apk`.
4. `test`
   - Run `build-modules`.
   - Run `compile` with final APK reuse enabled.
   - Install and verify on device.

Current artifact-backed modules:
- `phonepe_sigbypass`
- `phonepe_https_interceptor`
- `phonepe_phonepehelper`

`orchestrator.py` is the single orchestrator. `cache_manager.py` remains only as a compatibility shim. Module scripts are now artifact builders and injectors, not independent top-level build pipelines.

- View dependency graph:
  - `python3 src/cache-manager/orchestrator.py graph`

- Check cache status:
  - `python3 src/cache-manager/orchestrator.py status`

- Reset cache with downstream deletion:
  - `python3 src/cache-manager/orchestrator.py reset --from phonepe_merged`

- Full rebuild (pull -> merge -> decompile):
  - `python3 src/cache-manager/orchestrator.py rebuild`

- Rebuild one cache (and delete downstream automatically):
  - `python3 src/cache-manager/orchestrator.py rebuild --only phonepe_merged`

- Compatibility-only legacy module workflow (`sigbypass`):
  - Pre-cache: `python3 src/cache-manager/orchestrator.py sigbypass pre-cache` (default only resets paths; full copy only if target missing)
  - Force re-copy: `python3 src/cache-manager/orchestrator.py sigbypass pre-cache --delete`
  - Inject: `python3 src/cache-manager/orchestrator.py sigbypass inject`
  - Compile: `python3 src/cache-manager/orchestrator.py sigbypass compile`
  - Test: `python3 src/cache-manager/orchestrator.py sigbypass test`

- Compatibility-only legacy module workflow (`https`, depends on sigbypass cache):
  - Pre-cache: `python3 src/cache-manager/orchestrator.py https pre-cache` (default only resets paths; full copy only if target missing)
  - Force re-copy: `python3 src/cache-manager/orchestrator.py https pre-cache --delete`
  - Inject: `python3 src/cache-manager/orchestrator.py https inject`
  - Compile: `python3 src/cache-manager/orchestrator.py https compile`
  - Test: `python3 src/cache-manager/orchestrator.py https test`

## Compatibility

Legacy commands are compatibility-only wrappers and map to module-scoped runs:

| Legacy command | Status | Recommended replacement |
| --- | --- | --- |
| `python3 src/cache-manager/cache_manager.py sigbypass <action>` | Compatibility-only shim | `python3 src/cache-manager/orchestrator.py profile sigbypass-only {plan|pre-cache|build-modules|inject|compile|test}` |
| `python3 src/cache-manager/cache_manager.py https <action>` | Compatibility-only shim | `python3 src/cache-manager/orchestrator.py profile https-only {plan|pre-cache|build-modules|inject|compile|test}` |
| `python3 src/cache-manager/cache_manager.py phonepehelper <action>` | Compatibility-only shim | `python3 src/cache-manager/orchestrator.py profile phonepehelper-only {plan|pre-cache|build-modules|inject|compile|test}` |

For full composed build/test, use `profile full {plan|pre-cache|inject|compile|test}`.

## Notes

- All dependency rules are defined in `src/cache-manager/cache_manifest.json`.
- Module artifact builders are declared in `src/cache-manager/cache_manifest.json` under `builder`.
- Cache directories are set to read-only after creation.
- Reset will remove a cache and **all downstream** caches that depend on it.
 - `phonepe_sigbypass` is kept writable for modification by signature_bypass scripts.
