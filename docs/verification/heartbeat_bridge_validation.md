# Heartbeat Bridge Validation

This document covers the unified `full` build path where `heartbeat_bridge` is included as one of the injected modules.

## What to verify

- `cache_profiles.json` contains a single `full` profile.
- `full` includes `heartbeat_bridge` alongside the other injected modules.
- `verify_profile_injection(...)` accepts the full module set, including `com/heartbeatbridge/*` smali markers.
- `heartbeat_bridge` uses `HttpURLConnection` for heartbeat upload.

## Suggested checks

- `cd src/pipeline/orch && pytest tests/test_profile_resolver.py -q`
- `cd src/pipeline/orch && pytest tests/test_profile_injection_verification.py -q`
- `cd src/pipeline/orch && pytest tests/test_manifest_decoupling.py -q`
- `cd src/pipeline/orch && pytest tests/test_validation_doc_links.py -q`

## Build flow

- `python3 src/pipeline/orch/orchestrator.py plan`
- `python3 src/pipeline/orch/orchestrator.py smali`
- `python3 src/pipeline/orch/orchestrator.py merge`
- `python3 src/pipeline/orch/orchestrator.py test --smoke --serial emulator-5554 --install-mode reinstall`

