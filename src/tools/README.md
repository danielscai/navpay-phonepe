# Injection Test Tools (src/tools)

This directory contains the unified injector and test helpers used during module migration.

## Quick start

- Inject a module into a decompiled APK:
  - `./inject.sh --decompiled /path/to/decompiled/base --module signature_bypass`

- Test signature_bypass end-to-end:
  - `./test_signature_bypass.sh --target-dir /path/to/decompiled/base`
  - or `./test_signature_bypass.sh --sample pev70`

## Notes

- `decompile.sh` is a wrapper for the repository root `tools/decompile.sh`.
- The injector writes `assets/inject_manifest.json` in the target APK directory.
