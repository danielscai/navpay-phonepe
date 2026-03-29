# Heartbeat Bridge Isolation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone heartbeat module (same level as `https_interceptor`) that owns both heartbeat transport and content-provider entrypoint, and remove heartbeat responsibilities from `https_interceptor`.

**Architecture:** Introduce a new `src/apk/heartbeat_bridge` artifact module containing provider + scheduler + OkHttp sender. Inject this module into `navpay_phonepe` independently from `https_interceptor`, and let provider heartbeat calls trigger immediate send while scheduler emits every 30 seconds. Keep `https_interceptor` focused on log capture only.

**Tech Stack:** Java 8, Android ContentProvider APIs, OkHttp3 (runtime classes in target app), shell injection scripts, orchestrator profile verification tests.

---

### Task 1: Create standalone `heartbeat_bridge` module skeleton

**Files:**
- Create: `src/apk/heartbeat_bridge/README.md`
- Create: `src/apk/heartbeat_bridge/scripts/compile.sh`
- Create: `src/apk/heartbeat_bridge/scripts/merge.sh`
- Create: `src/apk/heartbeat_bridge/src/main/java/com/heartbeatbridge/HeartbeatBridgeContract.java`
- Create: `src/apk/heartbeat_bridge/src/main/java/com/heartbeatbridge/HeartbeatBridgeProvider.java`
- Create: `src/apk/heartbeat_bridge/src/main/java/com/heartbeatbridge/HeartbeatSender.java`
- Create: `src/apk/heartbeat_bridge/src/main/java/com/heartbeatbridge/HeartbeatScheduler.java`

**Step 1: Write the failing test**

Create a pipeline contract test that asserts these files exist and `HeartbeatBridgeProvider` class is referenced by merge script.

```python
# src/pipeline/orch/tests/test_heartbeat_bridge_layout.py

def test_heartbeat_bridge_layout_exists():
    ...
```

**Step 2: Run test to verify it fails**

Run: `cd src/pipeline/orch && pytest tests/test_heartbeat_bridge_layout.py -q`
Expected: FAIL with missing module paths.

**Step 3: Write minimal implementation**

Add module directories/files with placeholders and provider class declaration.

```java
public final class HeartbeatBridgeProvider extends ContentProvider { ... }
```

**Step 4: Run test to verify it passes**

Run: `cd src/pipeline/orch && pytest tests/test_heartbeat_bridge_layout.py -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/apk/heartbeat_bridge src/pipeline/orch/tests/test_heartbeat_bridge_layout.py
git commit -m "feat(heartbeat-bridge): scaffold standalone heartbeat module"
```

### Task 2: Implement isolated heartbeat transport (OkHttp3) and payload builder

**Files:**
- Modify: `src/apk/heartbeat_bridge/src/main/java/com/heartbeatbridge/HeartbeatSender.java`
- Create: `src/apk/heartbeat_bridge/src/main/java/com/heartbeatbridge/HeartbeatPayload.java`
- Create: `src/apk/heartbeat_bridge/src/main/java/com/heartbeatbridge/HeartbeatEndpointResolver.java`
- Test: `src/pipeline/orch/tests/test_heartbeat_bridge_contract.py`

**Step 1: Write the failing test**

Add a contract test asserting sender payload keys and endpoint fallback order are present in source text.

```python
def test_heartbeat_sender_contract():
    # asserts appName=phonepe, clientDeviceId, timestamp, endpoint override support
    ...
```

**Step 2: Run test to verify it fails**

Run: `cd src/pipeline/orch && pytest tests/test_heartbeat_bridge_contract.py::test_heartbeat_sender_contract -q`
Expected: FAIL (missing symbols).

**Step 3: Write minimal implementation**

Implement `HeartbeatSender.sendOnce(...)` using OkHttp3 runtime class calls, endpoint override, and fallback endpoints.

```java
JSONObject payload = HeartbeatPayload.build("phonepe", clientDeviceId, nowMs);
int code = HeartbeatSender.sendOnce(context, payload);
```

**Step 4: Run test to verify it passes**

Run: `cd src/pipeline/orch && pytest tests/test_heartbeat_bridge_contract.py::test_heartbeat_sender_contract -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/apk/heartbeat_bridge/src/main/java/com/heartbeatbridge src/pipeline/orch/tests/test_heartbeat_bridge_contract.py
git commit -m "feat(heartbeat-bridge): add isolated okhttp heartbeat sender"
```

### Task 3: Implement 30s scheduler independent of log module

**Files:**
- Modify: `src/apk/heartbeat_bridge/src/main/java/com/heartbeatbridge/HeartbeatScheduler.java`
- Modify: `src/apk/heartbeat_bridge/src/main/java/com/heartbeatbridge/HeartbeatSender.java`
- Test: `src/pipeline/orch/tests/test_heartbeat_bridge_contract.py`

**Step 1: Write the failing test**

Add contract assertions for `30_000L` interval and `startIfNeeded` idempotency markers.

```python
def test_heartbeat_scheduler_interval_and_idempotency():
    ...
```

**Step 2: Run test to verify it fails**

Run: `cd src/pipeline/orch && pytest tests/test_heartbeat_bridge_contract.py::test_heartbeat_scheduler_interval_and_idempotency -q`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement single-thread scheduled executor with `scheduleAtFixedRate(..., 30_000L, 30_000L, ...)` and immediate first send.

**Step 4: Run test to verify it passes**

Run: `cd src/pipeline/orch && pytest tests/test_heartbeat_bridge_contract.py::test_heartbeat_scheduler_interval_and_idempotency -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/apk/heartbeat_bridge/src/main/java/com/heartbeatbridge/HeartbeatScheduler.java src/pipeline/orch/tests/test_heartbeat_bridge_contract.py
git commit -m "feat(heartbeat-bridge): add independent 30s heartbeat scheduler"
```

### Task 4: Move provider entrypoint to heartbeat bridge and trigger immediate send on provider heartbeat call

**Files:**
- Modify: `src/apk/heartbeat_bridge/src/main/java/com/heartbeatbridge/HeartbeatBridgeProvider.java`
- Modify: `src/apk/heartbeat_bridge/src/main/java/com/heartbeatbridge/HeartbeatBridgeContract.java`
- Modify: `src/apk/heartbeat_bridge/scripts/merge.sh`
- Test: `src/pipeline/orch/tests/test_heartbeat_bridge_injection.py`

**Step 1: Write the failing test**

Add an injection verification test that checks merge script injects provider authority and heartbeat methods.

```python
def test_merge_injects_heartbeat_provider():
    ...
```

**Step 2: Run test to verify it fails**

Run: `cd src/pipeline/orch && pytest tests/test_heartbeat_bridge_injection.py::test_merge_injects_heartbeat_provider -q`
Expected: FAIL.

**Step 3: Write minimal implementation**

In provider `call(...)`, when method is heartbeat-family:
- build response bundle (`ok/timestamp/status`)
- invoke `HeartbeatSender.sendAsync(...)` immediately
- return bundle

**Step 4: Run test to verify it passes**

Run: `cd src/pipeline/orch && pytest tests/test_heartbeat_bridge_injection.py::test_merge_injects_heartbeat_provider -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/apk/heartbeat_bridge/src/main/java/com/heartbeatbridge src/apk/heartbeat_bridge/scripts/merge.sh src/pipeline/orch/tests/test_heartbeat_bridge_injection.py
git commit -m "feat(heartbeat-bridge): provider heartbeat triggers immediate send"
```

### Task 5: Remove heartbeat ownership from `https_interceptor` log module

**Files:**
- Modify: `src/apk/https_interceptor/app/src/main/java/com/httpinterceptor/interceptor/LogSender.java`
- Delete: `src/apk/https_interceptor/app/src/test/java/com/httpinterceptor/interceptor/LogSenderHeartbeatTest.java`
- Create: `src/apk/https_interceptor/app/src/test/java/com/httpinterceptor/interceptor/LogSenderNoHeartbeatTest.java`

**Step 1: Write the failing test**

Add `LogSenderNoHeartbeatTest` asserting no heartbeat scheduler members/methods remain.

```java
@Test
public void logSenderShouldNotOwnHeartbeatScheduler() {
    // reflection/text-level assertion for removed heartbeat-specific APIs
}
```

**Step 2: Run test to verify it fails**

Run: `cd src/apk/https_interceptor && ./gradlew test --tests "*LogSenderNoHeartbeatTest"`
Expected: FAIL before cleanup.

**Step 3: Write minimal implementation**

Remove heartbeat executor/timer/send methods from `LogSender`, keep log queue + runtime command logic only.

**Step 4: Run test to verify it passes**

Run: `cd src/apk/https_interceptor && ./gradlew test --tests "*LogSenderNoHeartbeatTest"`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/apk/https_interceptor/app/src/main/java/com/httpinterceptor/interceptor/LogSender.java src/apk/https_interceptor/app/src/test/java/com/httpinterceptor/interceptor/LogSenderNoHeartbeatTest.java
git rm src/apk/https_interceptor/app/src/test/java/com/httpinterceptor/interceptor/LogSenderHeartbeatTest.java
git commit -m "refactor(https-interceptor): remove heartbeat responsibilities from log sender"
```

### Task 6: Wire orchestrator and profiles to include new heartbeat module at same level as `https_interceptor`

**Files:**
- Modify: `src/pipeline/orch/cache_profiles.json`
- Modify: `src/pipeline/orch/orchestrator.py`
- Modify: `src/pipeline/orch/tests/test_profile_injection_verification.py`

**Step 1: Write the failing test**

Add profile verification expecting `heartbeat_bridge` in module list and injection checks.

```python
def test_profile_contains_heartbeat_bridge_module():
    ...
```

**Step 2: Run test to verify it fails**

Run: `cd src/pipeline/orch && pytest tests/test_profile_injection_verification.py::test_profile_contains_heartbeat_bridge_module -q`
Expected: FAIL.

**Step 3: Write minimal implementation**

Register new module in profile graph and verify merge artifacts in orchestrator health checks.

**Step 4: Run test to verify it passes**

Run: `cd src/pipeline/orch && pytest tests/test_profile_injection_verification.py::test_profile_contains_heartbeat_bridge_module -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/pipeline/orch/cache_profiles.json src/pipeline/orch/orchestrator.py src/pipeline/orch/tests/test_profile_injection_verification.py
git commit -m "feat(orchestrator): add heartbeat_bridge module in profile pipeline"
```

### Task 7: End-to-end validation in repo workflow (`yarn test`) and runtime checks

**Files:**
- Modify: `docs/verification/heartbeat_bridge_validation.md`
- Modify: `docs/编排统一规范.md` (module notes)

**Step 1: Write the failing test**

Create validation checklist doc with explicit PASS/FAIL gates for:
- provider heartbeat call
- independent 30s heartbeat cadence
- log sending unaffected

**Step 2: Run test to verify it fails**

Run:
- `yarn test`
- `adb logcat -s PPHelper HttpInterceptor`
- heartbeat endpoint capture on admin side

Expected: at least one gate FAIL before final wiring.

**Step 3: Write minimal implementation**

Fix only gaps found in module wiring/merge script/profile references (no extra refactors).

**Step 4: Run test to verify it passes**

Run the same commands again.
Expected: all validation gates PASS.

**Step 5: Commit**

```bash
git add docs/verification/heartbeat_bridge_validation.md docs/编排统一规范.md
git commit -m "docs(heartbeat-bridge): add isolation and e2e validation report"
```

### Task 8: Cleanup and migration safety

**Files:**
- Modify: `src/apk/phonepehelper/README.md`
- Modify: `src/apk/https_interceptor/README.md`
- Create: `docs/plans/2026-03-29-heartbeat-bridge-migration-notes.md`

**Step 1: Write the failing test**

Add checklist in migration notes requiring:
- no heartbeat scheduling code in `https_interceptor`
- provider authority owned by `heartbeat_bridge`
- heartbeat call path from navpay-android provider call verified

**Step 2: Run test to verify it fails**

Manual checklist review before docs updates.
Expected: FAIL due missing migration docs.

**Step 3: Write minimal implementation**

Document new ownership boundaries and rollback strategy.

**Step 4: Run test to verify it passes**

Re-check checklist with current codebase and validation outputs.
Expected: PASS.

**Step 5: Commit**

```bash
git add src/apk/phonepehelper/README.md src/apk/https_interceptor/README.md docs/plans/2026-03-29-heartbeat-bridge-migration-notes.md
git commit -m "docs: finalize heartbeat bridge ownership and migration notes"
```

