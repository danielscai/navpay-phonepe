# NavPay Android + PhonePe Environment Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable single-APK multi-environment switching with custom env support in navpay-android, and conditionally enforce strong consistency with navpay-phonepe based on bridge availability.

**Architecture:** navpay-android is the source of truth for selected environment. During switch, navpay-android probes navpay-phonepe bridge version provider. If bridge is reachable and bridgeVersion is non-empty, switching must be strongly consistent (phonepe apply must succeed or rollback navpay-android). If bridge is unreachable, navpay-android switch still succeeds but shows unsynced warning for phonepe.

**Tech Stack:** Android (Kotlin/Java), ContentProvider IPC, SQLite/Room (or existing local config store), existing navpay-phonepe provider module.

---

### Task 1: Define environment contract and error model

**Files:**
- Modify: `docs/plans/2026-04-10-phonepe-env-sync-conditional-consistency.md`
- Create (navpay-android repo): `<navpay-android>/docs/contracts/environment-sync.md`
- Create (navpay-phonepe repo): `docs/checksum_content_provider_api.md` (append env methods)

**Step 1: Write the failing test (contract-level checklist)**

```text
Given bridge is reachable and setEnvironment fails,
when user switches env in navpay-android,
then navpay-android current env must rollback and show failure.
```

**Step 2: Run test to verify it fails**

Run: `Manual contract review against current implementation`
Expected: FAIL because env sync methods are not yet defined.

**Step 3: Write minimal implementation**

Define provider method names and bundle fields:
- Probe: query `content://com.phonepe.navpay.bridge.version.provider/version`, require non-empty `bridge_version`
- Set: `call(..., method="setEnvironment", extras={envName, baseUrl, updatedAt})`
- Get: `call(..., method="getEnvironment", extras={})`
- Result fields: `ok`, `code`, `message`, `envName`, `updatedAt`

**Step 4: Run verification**

Run: `Design/contract review with team`
Expected: PASS with agreed enum codes and field names.

**Step 5: Commit**

```bash
git add docs/contracts/environment-sync.md docs/checksum_content_provider_api.md
git commit -m "docs: define navpay env sync provider contract"
```

### Task 2: Add phonepe environment state storage and provider methods

**Files:**
- Modify: `src/apk/phonepehelper/src/main/java/com/phonepehelper/NavpayBridgeContract.java`
- Modify: `src/apk/phonepehelper/src/main/java/com/phonepehelper/NavpayBridgeDbHelper.java`
- Modify: `src/apk/phonepehelper/src/main/java/com/phonepehelper/NavpayBridgeProvider.java`
- Modify: `src/apk/phonepehelper/src/main/java/com/phonepehelper/NavpaySnapshotUploader.java`

**Step 1: Write the failing test**

Create/Modify tests (orch/provider contract test suite):
- `setEnvironment` persists `envName/baseUrl/updatedAt`
- `getEnvironment` returns latest persisted envName
- invalid envName/baseUrl returns `ok=false`

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_phonepehelper_bridge_manifest_injection.py -q`
Expected: FAIL (no env API yet).

**Step 3: Write minimal implementation**

- Add DB columns/table for env state (single-row latest):
  - `env_name` (TEXT)
  - `base_url` (TEXT)
  - `updated_at` (INTEGER)
- Implement provider call handlers:
  - `setEnvironment`: validate and upsert
  - `getEnvironment`: return bundle
- Update uploader resolution order:
  1. provider-persisted `base_url`
  2. `System.getProperty(ENDPOINT_PROPERTY)`
  3. existing emulator/device fallback

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests -k "phonepehelper and env" -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/apk/phonepehelper/src/main/java/com/phonepehelper/NavpayBridgeContract.java \
  src/apk/phonepehelper/src/main/java/com/phonepehelper/NavpayBridgeDbHelper.java \
  src/apk/phonepehelper/src/main/java/com/phonepehelper/NavpayBridgeProvider.java \
  src/apk/phonepehelper/src/main/java/com/phonepehelper/NavpaySnapshotUploader.java
git commit -m "feat(phonepehelper): add provider-based environment set/get"
```

### Task 3: Implement conditional strong consistency in navpay-android switch flow

**Files:**
- Modify (navpay-android repo): `<navpay-android>/.../EnvironmentRepository.kt`
- Modify (navpay-android repo): `<navpay-android>/.../EnvironmentSwitchUseCase.kt`
- Modify (navpay-android repo): `<navpay-android>/.../PhonepeBridgeClient.kt`

**Step 1: Write the failing test**

```kotlin
@Test
fun switch_rolls_back_when_bridge_available_and_phonepe_set_fails() { /* ... */ }

@Test
fun switch_succeeds_with_warning_when_bridge_unavailable() { /* ... */ }
```

**Step 2: Run test to verify it fails**

Run: `./gradlew testDebugUnitTest --tests "*EnvironmentSwitchUseCase*"`
Expected: FAIL.

**Step 3: Write minimal implementation**

- Probe bridge availability using version provider query + non-empty bridgeVersion.
- If available:
  - stage env change
  - call phonepe `setEnvironment`
  - commit on success
  - rollback on failure
- If unavailable:
  - commit local env
  - mark phonepe sync state as unsynced

**Step 4: Run test to verify it passes**

Run: `./gradlew testDebugUnitTest --tests "*EnvironmentSwitchUseCase*"`
Expected: PASS.

**Step 5: Commit**

```bash
git add <navpay-android>/.../EnvironmentRepository.kt \
  <navpay-android>/.../EnvironmentSwitchUseCase.kt \
  <navpay-android>/.../PhonepeBridgeClient.kt
git commit -m "feat(navpay-android): conditional strong consistency for phonepe env sync"
```

### Task 4: Add custom environment CRUD and selection UI in navpay-android

**Files:**
- Modify (navpay-android repo): `<navpay-android>/.../EnvironmentListViewModel.kt`
- Modify (navpay-android repo): `<navpay-android>/.../EnvironmentEditDialog.*`
- Modify (navpay-android repo): `<navpay-android>/.../EnvironmentStorage.*`

**Step 1: Write the failing test**

- save multiple custom env entries
- reject duplicate names (case-insensitive)
- select custom env triggers switch use case

**Step 2: Run test to verify it fails**

Run: `./gradlew testDebugUnitTest --tests "*Environment*"`
Expected: FAIL.

**Step 3: Write minimal implementation**

- support list of custom environments
- fields: `name`, `baseUrl`, `createdAt`, `updatedAt`
- baseUrl validation: non-empty + `http/https`
- keep built-ins visible and non-deletable

**Step 4: Run test to verify it passes**

Run: `./gradlew testDebugUnitTest --tests "*Environment*"`
Expected: PASS.

**Step 5: Commit**

```bash
git add <navpay-android>/.../EnvironmentListViewModel.kt \
  <navpay-android>/.../EnvironmentEditDialog.* \
  <navpay-android>/.../EnvironmentStorage.*
git commit -m "feat(navpay-android): support multiple custom environments"
```

### Task 5: Show app actual environment name in App Details page

**Files:**
- Modify (navpay-android repo): `<navpay-android>/.../AppDetailsViewModel.kt`
- Modify (navpay-android repo): `<navpay-android>/.../AppDetailsScreen.*`
- Modify (navpay-android repo): `<navpay-android>/.../PhonepeBridgeClient.kt`

**Step 1: Write the failing test**

- when `getEnvironment` succeeds, page shows env name only
- when provider read fails, page shows `未同步`
- ensure URL is not rendered

**Step 2: Run test to verify it fails**

Run: `./gradlew testDebugUnitTest --tests "*AppDetails*"`
Expected: FAIL.

**Step 3: Write minimal implementation**

- call phonepe `getEnvironment`
- map to display model: `actualEnvName`
- render only env name text; no URL field in UI

**Step 4: Run test to verify it passes**

Run: `./gradlew testDebugUnitTest --tests "*AppDetails*"`
Expected: PASS.

**Step 5: Commit**

```bash
git add <navpay-android>/.../AppDetailsViewModel.kt \
  <navpay-android>/.../AppDetailsScreen.* \
  <navpay-android>/.../PhonepeBridgeClient.kt
git commit -m "feat(navpay-android): show app actual environment name from provider"
```

### Task 6: Manual integration verification and release checklist

**Files:**
- Modify: `docs/步骤6_phonepehelper_测试记录.md`
- Create: `docs/reports/2026-04-10-phonepe-env-sync-validation.md`

**Step 1: Write the failing test (manual checklist)**

Checklist cases:
- bridge available + set success => both sides env changed
- bridge available + set fail => navpay-android rollback
- bridge unavailable => navpay-android success + unsynced warning
- app details only shows env name

**Step 2: Run verification commands**

Run:
- `yarn apk`
- `yarn test`
- `adb shell content query --uri content://com.phonepe.navpay.bridge.version.provider/version`
- `adb shell content call --uri content://com.phonepe.navpay.provider/user_data --method getEnvironment`

Expected:
- flows match conditional consistency policy
- app details shows env name only

**Step 3: Update docs with evidence**

Include command outputs summary and observed UI behavior.

**Step 4: Final regression run**

Run: `python3 -m pytest src/pipeline/orch/tests -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add docs/步骤6_phonepehelper_测试记录.md docs/reports/2026-04-10-phonepe-env-sync-validation.md
git commit -m "test: validate conditional consistency env sync flow"
```
