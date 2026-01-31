# Cache Management (src/cache-manager)

This directory contains the **cache management configuration and scripts**. The actual cached data is stored in the repository root `cache/` directory (gitignored).

## Commands

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

- Prepare signature_bypass workflow:
  - Pre-cache: `python3 src/cache-manager/cache_manager.py sigbypass pre-cache` (default only resets paths; full copy only if target missing)
  - Force re-copy: `python3 src/cache-manager/cache_manager.py sigbypass pre-cache --delete`
  - Inject: `python3 src/cache-manager/cache_manager.py sigbypass inject`
  - Compile: `python3 src/cache-manager/cache_manager.py sigbypass compile`
  - Test: `python3 src/cache-manager/cache_manager.py sigbypass test`

- Prepare https_interceptor workflow (depends on sigbypass cache):
  - Pre-cache: `python3 src/cache-manager/cache_manager.py https pre-cache` (default only resets paths; full copy only if target missing)
  - Force re-copy: `python3 src/cache-manager/cache_manager.py https pre-cache --delete`
  - Inject: `python3 src/cache-manager/cache_manager.py https inject`
  - Compile: `python3 src/cache-manager/cache_manager.py https compile`
  - Test: `python3 src/cache-manager/cache_manager.py https test`

## Notes

- All dependency rules are defined in `src/cache-manager/cache_manifest.json`.
- Cache directories are set to read-only after creation.
- Reset will remove a cache and **all downstream** caches that depend on it.
 - `phonepe_sigbypass` is kept writable for modification by signature_bypass scripts.
