# Heartbeat Bridge Validation

This document covers the minimal verification for the standalone `heartbeat_bridge` module wiring.

## Targeted checks

Run the orchestrator tests that cover profile resolution and static injection verification:

```bash
cd src/pipeline/orch
pytest tests/test_profile_resolver.py tests/test_profile_injection_verification.py tests/test_validation_doc_links.py -q
```

## Expected result

- `resolve_profile("heartbeat_bridge")` returns `["heartbeat_bridge"]`
- `verify_profile_injection(...)` accepts the heartbeat bridge smali markers
- The docs wiring test confirms this validation note exists

