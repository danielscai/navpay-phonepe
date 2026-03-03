# Cache Management (src/cache-manager)

This directory contains the **cache management configuration and scripts**. The actual cached data is stored in the repository root `cache/` directory (gitignored).

## Commands

- Primary command contract (profile pipeline):
  - Plan modules: `python3 src/cache-manager/cache_manager.py profile full plan`
  - Pre-cache workspace: `python3 src/cache-manager/cache_manager.py profile full pre-cache`
  - Inject profile modules: `python3 src/cache-manager/cache_manager.py profile full inject`
  - Compile profile workspace: `python3 src/cache-manager/cache_manager.py profile full compile`
  - Test profile build (full, requires adb/emulator): `python3 src/cache-manager/cache_manager.py profile full test --serial emulator-5554`
  - Test profile build (smoke, faster): `python3 src/cache-manager/cache_manager.py profile full test --smoke --serial emulator-5554`
  - Smoke helper script: `bash src/tools/test_profile_smoke.sh full [serial]`

Smoke vs full:
- `full`: existing strict path (default timeout, uninstall+reinstall, verify all profile module log tags).
- `smoke`: fast path (shorter timeout, skip uninstall, only primary module log tag verification via unified test).

- View dependency graph:
  - `python3 src/cache-manager/cache_manager.py graph`

- Check cache status:
  - `python3 src/cache-manager/cache_manager.py status`

- Reset cache with downstream deletion:
  - `python3 src/cache-manager/cache_manager.py reset --from phonepe_merged`

- Full rebuild (pull -> merge -> decompile):
  - `python3 src/cache-manager/cache_manager.py rebuild`

- Rebuild one cache (and delete downstream automatically):
  - `python3 src/cache-manager/cache_manager.py rebuild --only phonepe_merged`

- Compatibility-only legacy module workflow (`sigbypass`):
  - Pre-cache: `python3 src/cache-manager/cache_manager.py sigbypass pre-cache` (default only resets paths; full copy only if target missing)
  - Force re-copy: `python3 src/cache-manager/cache_manager.py sigbypass pre-cache --delete`
  - Inject: `python3 src/cache-manager/cache_manager.py sigbypass inject`
  - Compile: `python3 src/cache-manager/cache_manager.py sigbypass compile`
  - Test: `python3 src/cache-manager/cache_manager.py sigbypass test`

- Compatibility-only legacy module workflow (`https`, depends on sigbypass cache):
  - Pre-cache: `python3 src/cache-manager/cache_manager.py https pre-cache` (default only resets paths; full copy only if target missing)
  - Force re-copy: `python3 src/cache-manager/cache_manager.py https pre-cache --delete`
  - Inject: `python3 src/cache-manager/cache_manager.py https inject`
  - Compile: `python3 src/cache-manager/cache_manager.py https compile`
  - Test: `python3 src/cache-manager/cache_manager.py https test`

## Compatibility

Legacy commands are compatibility-only wrappers and map to module-scoped runs:

| Legacy command | Status | Recommended replacement |
| --- | --- | --- |
| `python3 src/cache-manager/cache_manager.py sigbypass <action>` | Compatibility-only | `python3 src/cache-manager/cache_manager.py profile sigbypass-only {plan|pre-cache|inject|compile|test}` |
| `python3 src/cache-manager/cache_manager.py https <action>` | Compatibility-only | `python3 src/cache-manager/cache_manager.py profile https-only {plan|pre-cache|inject|compile|test}` |
| `python3 src/cache-manager/cache_manager.py phonepehelper <action>` | Compatibility-only | `python3 src/cache-manager/cache_manager.py profile phonepehelper-only {plan|pre-cache|inject|compile|test}` |

For full composed build/test, use `profile full {plan|pre-cache|inject|compile|test}`.

## Notes

- All dependency rules are defined in `src/cache-manager/cache_manifest.json`.
- Cache directories are set to read-only after creation.
- Reset will remove a cache and **all downstream** caches that depend on it.
 - `phonepe_sigbypass` is kept writable for modification by signature_bypass scripts.
