# Heartbeat Bridge Validation

This document validates the `navpay-phonepe` side of the shared heartbeat protocol and the `heartbeat_bridge` adapter.

## What to verify

- `full` is the only supported profile and it includes `heartbeat_bridge`.
- `heartbeat_bridge` exposes the canonical heartbeat protocol fields.
- `heartbeat_bridge` uses `HttpURLConnection` for transport.
- `heartbeat_bridge` keeps protocol logic separate from adapter/runtime concerns.
- `heartbeat_bridge` maintains its own command registry for supported downlink commands.
- `heartbeat_bridge` scheduler includes anti-thundering-herd controls:
  - deterministic initial offset by android id
  - bounded per-cycle jitter (current target: `+-2000ms`)
- `verify_profile_injection(...)` accepts the full module set, including `com/heartbeatbridge/*` smali markers.

## Protocol consistency checklist

Check the following against `docs/architecture/heartbeat/heartbeat-protocol-v1.md`:

- request carries an explicit protocol version
- request envelope includes `timestamp`, `appName`, and `androidId`
- response parser preserves `ok`, `timestamp`, and `error`
- command and ACK identifiers are stable and idempotent
- `ping` is the shared command type and must be present in the registry
- app-specific commands must be listed in the registry before adapter execution
- compatibility rules are enforced by the adapter, not by ad hoc caller logic

## Suggested checks

- `cd src/pipeline/orch && pytest tests/test_profile_resolver.py -q`
- `cd src/pipeline/orch && pytest tests/test_profile_injection_verification.py -q`
- `cd src/pipeline/orch && pytest tests/test_manifest_decoupling.py -q`
- `cd src/pipeline/orch && pytest tests/test_heartbeat_bridge_contract.py -q`
- `cd src/pipeline/orch && pytest tests/test_validation_doc_links.py -q`
- review `docs/architecture/heartbeat/heartbeat-command-registry.md`

## Build and runtime flow

- `python3 src/pipeline/orch/orchestrator.py plan`
- `python3 src/pipeline/orch/orchestrator.py smali`
- `python3 src/pipeline/orch/orchestrator.py merge`
- `python3 src/pipeline/orch/orchestrator.py test --smoke --serial emulator-5554 --install-mode reinstall`
- `python3 src/pipeline/orch/orchestrator.py test --serial emulator-5554 --install-mode reinstall`

## Acceptance criteria

- `HeartbeatBridge` logs appear during runtime.
- No deprecated heartbeat sender code is present in `phonepehelper`.
- Protocol-related changes are applied through the shared spec/core flow before adapter changes.
- Registry changes are reviewed before adapter code is merged.
- Redis heartbeat observation in `navpay-admin` matches runtime expectation:
  - `navpay-android` foreground: `navpay` + `phonepe` keys advance
  - `phonepe` foreground: only `phonepe` key advances
