# Heartbeat Bridge HttpURLConnection + Full-Only Orchestrator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate heartbeat transport to `HttpURLConnection`, remove heartbeat ownership from `phonepehelper`, and collapse orchestrator into a single full-profile path with no standalone heartbeat profile behavior.

**Architecture:** Keep one heartbeat owner module (`heartbeat_bridge`) for scheduling + transport, and keep `phonepehelper` as checksum/token/snapshot bridge only. In orchestrator, remove dedicated `heartbeat_bridge` profile and compose `heartbeat_bridge` into `full` so all build/test paths use one unified module set.

**Tech Stack:** Java 8 (Android injected modules), Python 3 (orchestrator), pytest/unittest, adb/emulator integration via `yarn test`.

---

### Task 1: Convert `heartbeat_bridge` transport to `HttpURLConnection`

**Files:**
- Modify: `src/apk/heartbeat_bridge/src/main/java/com/heartbeatbridge/HeartbeatSender.java`
- Test: `src/pipeline/orch/tests/test_heartbeat_bridge_contract.py`

**Step 1: Write failing contract test update**

```python
assert "HttpURLConnection" in sender
assert "openConnection()" in sender
assert 'Class.forName("okhttp3.OkHttpClient")' not in sender
```

**Step 2: Run test to verify it fails**

Run: `cd src/pipeline/orch && pytest tests/test_heartbeat_bridge_contract.py::test_heartbeat_bridge_contract_mentions_async_send_and_scheduler -q`
Expected: FAIL because sender still contains okhttp reflection markers.

**Step 3: Implement minimal transport migration**

```java
HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
connection.setRequestMethod("POST");
connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
connection.setDoOutput(true);
```

**Step 4: Run test to verify it passes**

Run: `cd src/pipeline/orch && pytest tests/test_heartbeat_bridge_contract.py::test_heartbeat_bridge_contract_mentions_async_send_and_scheduler -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/apk/heartbeat_bridge/src/main/java/com/heartbeatbridge/HeartbeatSender.java src/pipeline/orch/tests/test_heartbeat_bridge_contract.py
git commit -m "refactor(heartbeat-bridge): switch transport to httpurlconnection"
```

### Task 2: Remove heartbeat ownership from `phonepehelper`

**Files:**
- Delete: `src/apk/phonepehelper/src/main/java/com/phonepehelper/NavpayHeartbeatSender.java`
- Modify: `src/apk/phonepehelper/src/main/java/com/phonepehelper/ModuleInit.java`
- Modify: `src/apk/phonepehelper/src/main/java/com/phonepehelper/NavpayBridgeProvider.java`

**Step 1: Add/adjust behavior tests by contract assertions (text-level if no unit tests)**

```python
assert "NavpayHeartbeatSender" not in module_init_source
assert "sendHeartbeatAsync" not in provider_source
```

**Step 2: Run targeted contract tests (expected fail before changes)**

Run: `cd src/pipeline/orch && pytest tests/test_profile_injection_verification.py -q`
Expected: either FAIL or no coverage for new behavior yet.

**Step 3: Implement minimal ownership removal**

```java
// ModuleInit: remove NavpayHeartbeatSender.startIfNeeded(...)
// Provider heartbeat method: remove heartbeat branch entirely (no compatibility path)
```

**Step 4: Re-run targeted tests**

Run: `cd src/pipeline/orch && pytest tests/test_profile_injection_verification.py -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/apk/phonepehelper/src/main/java/com/phonepehelper/ModuleInit.java src/apk/phonepehelper/src/main/java/com/phonepehelper/NavpayBridgeProvider.java
git rm src/apk/phonepehelper/src/main/java/com/phonepehelper/NavpayHeartbeatSender.java
git commit -m "refactor(phonepehelper): remove heartbeat sender ownership"
```

### Task 3: Remove standalone heartbeat profile path and compose into full

**Files:**
- Modify: `src/pipeline/orch/cache_profiles.json`
- Modify: `src/pipeline/orch/cache_manifest.json`
- Modify: `src/pipeline/orch/orchestrator.py`
- Modify: `src/pipeline/orch/tests/test_profile_resolver.py`
- Modify: `src/pipeline/orch/tests/test_profile_injection_verification.py`
- Modify: `src/pipeline/orch/tests/test_manifest_decoupling.py`
- Modify: `src/pipeline/orch/README.md`
- Modify: `docs/verification/heartbeat_bridge_validation.md`

**Step 1: Write failing tests for unified full module order**

```python
self.assertEqual(modules, [
  "phonepe_sigbypass",
  "phonepe_https_interceptor",
  "phonepe_phonepehelper",
  "heartbeat_bridge",
])
```

**Step 2: Run test to verify it fails**

Run: `cd src/pipeline/orch && pytest tests/test_profile_resolver.py -q`
Expected: FAIL due old profile config.

**Step 3: Implement unified full-only module graph**

```json
{
  "full": [
    "phonepe_sigbypass",
    "phonepe_https_interceptor",
    "phonepe_phonepehelper",
    "heartbeat_bridge"
  ]
}
```

Plus:
- add `heartbeat_bridge` entry to manifest builder/merge config,
- add orchestrator defaults/injection support for this module,
- remove tests/docs that assume separate heartbeat profile.

**Step 4: Run tests**

Run: `cd src/pipeline/orch && pytest tests/test_profile_resolver.py tests/test_profile_injection_verification.py tests/test_manifest_decoupling.py -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/pipeline/orch/cache_profiles.json src/pipeline/orch/cache_manifest.json src/pipeline/orch/orchestrator.py src/pipeline/orch/tests/test_profile_resolver.py src/pipeline/orch/tests/test_profile_injection_verification.py src/pipeline/orch/tests/test_manifest_decoupling.py src/pipeline/orch/README.md docs/verification/heartbeat_bridge_validation.md
git commit -m "refactor(orchestrator): unify heartbeat bridge into full-only flow"
```

### Task 4: Delete standalone profile testing path artifacts

**Files:**
- Delete/Modify: profile-specific heartbeat validation references no longer needed
- Candidate: `src/pipeline/orch/tests/test_heartbeat_bridge_contract.py` (keep only transport/module contract, remove profile semantics)

**Step 1: Identify profile-specific assertions and remove them**

```python
# remove assertions that depend on resolve_profile("heartbeat_bridge")
```

**Step 2: Run targeted tests**

Run: `cd src/pipeline/orch && pytest tests/test_validation_doc_links.py -q`
Expected: PASS with updated doc links/assertions.

**Step 3: Commit**

```bash
git add src/pipeline/orch/tests/test_heartbeat_bridge_contract.py src/pipeline/orch/tests/test_validation_doc_links.py docs/verification/heartbeat_bridge_validation.md
git commit -m "test(orchestrator): remove standalone heartbeat profile validation path"
```

### Task 5: Full regression + emulator real verification

**Files:**
- No source changes expected (verification only)

**Step 1: Run Python orchestrator test suite (core scope)**

Run: `cd src/pipeline/orch && pytest -q`
Expected: PASS.

**Step 2: Build/check pipeline in unified full mode**

Run: `cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe && yarn plan && yarn smali && yarn merge && yarn apk`
Expected: full module order includes `heartbeat_bridge`; APK built successfully.

**Step 3: Emulator smoke/full verification**

Run: `cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe && yarn test smoke && yarn test`
Expected:
- APK installs and launches,
- required module injection markers verified,
- runtime heartbeat still uploading,
- checksum/tokenrefresh bridge still works.

**Step 4: Explicit heartbeat E2E evidence collection**

Run: `adb -s <serial> logcat -d -s HeartbeatBridge PPHelper HttpInterceptor`
Expected:
- `HeartbeatBridge` scheduler started,
- no phonepehelper heartbeat sender logs,
- no transport errors.

**Step 5: Final commit (if any verification-driven fixes)**

```bash
git add -A
git commit -m "test: verify unified heartbeat and full-only orchestrator on emulator"
```
