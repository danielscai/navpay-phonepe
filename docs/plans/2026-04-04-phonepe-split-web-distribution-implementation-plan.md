# PhonePe Split Web Distribution (navpay-admin + navpay-android) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace single-link payment app distribution with release-manifest-driven split APK distribution, served by `navpay-admin` and installed by `navpay-android` via `PackageInstaller.Session`.

**Architecture:** Use an `app -> release -> artifact` model in `navpay-admin`, with local disk artifact storage and `/api/personal` installer-facing APIs (app list, manifest, artifact download, install events). In `navpay-android`, replace direct `downloadUrl` opening in Install Payment App flow with device-aware split selection, hash verification, and one-session install commit.

**Tech Stack:** Next.js Route Handlers, Prisma/Postgres, local filesystem streaming, Kotlin Android client, `PackageInstaller.Session`, SHA-256 verification, unit/integration tests.

---

### Task 1: Introduce release data model and migration gates (one-shot replacement)

**Files:**
- Modify: `navpay-admin/prisma/schema.prisma`
- Create: `navpay-admin/drizzle/` migration for release tables and constraints
- Create: `navpay-admin/tests/unit/payment-app-release-schema.test.ts`

**Step 1: Write failing schema validation tests**

```ts
describe("payment app release schema", () => {
  it("allows only one active release per app", async () => {
    // insert 2 active releases for same app -> expect unique violation
  });
});
```

**Step 2: Run tests to verify failure**

Run: `cd navpay-admin && yarn test tests/unit/payment-app-release-schema.test.ts`
Expected: FAIL because tables/constraints do not exist.

**Step 3: Implement schema + migration**
- Re-define `payment_apps` as app master only.
- Add `payment_app_releases`, `payment_app_release_artifacts`, `payment_app_release_events`.
- Add unique constraint: one `active` release per app.

**Step 4: Re-run tests**

Run: `cd navpay-admin && yarn test tests/unit/payment-app-release-schema.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git -C navpay-admin add prisma/schema.prisma drizzle tests/unit/payment-app-release-schema.test.ts
git -C navpay-admin commit -m "feat(admin): add payment app release schema"
```

### Task 2: Build local artifact storage module with integrity metadata

**Files:**
- Create: `navpay-admin/src/lib/payment-app-artifact-store.ts`
- Create: `navpay-admin/tests/unit/payment-app-artifact-store.test.ts`

**Step 1: Write failing tests for store/load/hash behavior**

```ts
it("stores artifact file and returns sha256 + size", async () => {
  // write temp apk -> expect path/sha256/size
});
```

**Step 2: Run tests to verify failure**

Run: `cd navpay-admin && yarn test tests/unit/payment-app-artifact-store.test.ts`
Expected: FAIL.

**Step 3: Implement minimal storage module**
- Root path: `public/uploads/payment-apps/<appId>/<releaseId>/`.
- Return relative path, byte size, sha256, content type.
- Validate filenames and block path traversal.

**Step 4: Re-run tests**

Run: `cd navpay-admin && yarn test tests/unit/payment-app-artifact-store.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git -C navpay-admin add src/lib/payment-app-artifact-store.ts tests/unit/payment-app-artifact-store.test.ts
git -C navpay-admin commit -m "feat(admin): add local artifact store for payment app releases"
```

### Task 3: Add admin release CRUD and activation APIs

**Files:**
- Create: `navpay-admin/src/app/api/admin/payment-apps/[appId]/releases/route.ts`
- Create: `navpay-admin/src/app/api/admin/payment-apps/[appId]/releases/[releaseId]/route.ts`
- Create: `navpay-admin/src/app/api/admin/payment-apps/[appId]/releases/[releaseId]/activate/route.ts`
- Create: `navpay-admin/tests/unit/admin-payment-app-releases-route.test.ts`

**Step 1: Write failing route tests**

```ts
it("blocks activation when required artifacts are missing", async () => {
  // activate draft without base/required splits -> 400 gate_failed
});
```

**Step 2: Run tests to verify failure**

Run: `cd navpay-admin && yarn test tests/unit/admin-payment-app-releases-route.test.ts`
Expected: FAIL.

**Step 3: Implement APIs with release gates**
- Draft create/update/delete.
- Activate endpoint validates required files and manifest consistency.
- Write `payment_app_release_events` on each state change.

**Step 4: Re-run tests**

Run: `cd navpay-admin && yarn test tests/unit/admin-payment-app-releases-route.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git -C navpay-admin add src/app/api/admin/payment-apps tests/unit/admin-payment-app-releases-route.test.ts
git -C navpay-admin commit -m "feat(admin): add payment app release management APIs"
```

### Task 4: Implement installer-facing `/api/personal` distribution APIs

**Files:**
- Modify: `navpay-admin/src/app/api/personal/payment-apps/route.ts`
- Create: `navpay-admin/src/app/api/personal/payment-apps/[appId]/releases/[releaseId]/manifest/route.ts`
- Create: `navpay-admin/src/app/api/personal/payment-apps/[appId]/releases/[releaseId]/artifacts/[artifactId]/download/route.ts`
- Create: `navpay-admin/src/app/api/personal/payment-apps/install-events/route.ts`
- Create: `navpay-admin/tests/unit/personal-payment-app-distribution-routes.test.ts`

**Step 1: Write failing personal API contract tests**

```ts
it("returns app list with active release and manifest url", async () => {
  // expect rows[].activeRelease.manifestUrl
});
```

**Step 2: Run tests to verify failure**

Run: `cd navpay-admin && yarn test tests/unit/personal-payment-app-distribution-routes.test.ts`
Expected: FAIL.

**Step 3: Implement routes**
- `/api/personal/payment-apps` returns active release summary.
- Manifest route returns deterministic JSON contract.
- Download route streams local file and verifies ownership.
- Install-events route persists diagnostics with minimal schema checks.

**Step 4: Re-run tests**

Run: `cd navpay-admin && yarn test tests/unit/personal-payment-app-distribution-routes.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git -C navpay-admin add src/app/api/personal/payment-apps tests/unit/personal-payment-app-distribution-routes.test.ts
git -C navpay-admin commit -m "feat(admin): add personal split distribution APIs"
```

### Task 5: Refactor payment app admin UI to release-centric management

**Files:**
- Modify: `navpay-admin/src/components/payment-apps-client.tsx`
- Modify: `navpay-admin/src/components/ops-settings-client.tsx` (if routing state adjustments needed)
- Create: `navpay-admin/tests/e2e/payment-app-release-management.spec.ts`

**Step 1: Write failing E2E flow test**

```ts
test("ops can create release, upload artifacts, activate, and view history", async ({ page }) => {
  // assert release status transition and history entries visible
});
```

**Step 2: Run test to verify failure**

Run: `cd navpay-admin && yarn test:e2e tests/e2e/payment-app-release-management.spec.ts`
Expected: FAIL.

**Step 3: Implement UI changes**
- App list + release list split panes.
- Release manifest/artifact/history tabs.
- Activation button with blocking validation feedback.

**Step 4: Re-run test**

Run: `cd navpay-admin && yarn test:e2e tests/e2e/payment-app-release-management.spec.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git -C navpay-admin add src/components/payment-apps-client.tsx src/components/ops-settings-client.tsx tests/e2e/payment-app-release-management.spec.ts
git -C navpay-admin commit -m "feat(admin): add release-centric payment app management UI"
```

### Task 6: Add Android manifest client and typed models

**Files:**
- Modify: `navpay-android/app/src/main/java/com/navpay/Models.kt`
- Modify: `navpay-android/app/src/main/java/com/navpay/ApiClient.kt`
- Create: `navpay-android/app/src/main/java/com/navpay/install/ReleaseManifestClient.kt`
- Create: `navpay-android/app/src/test/java/com/navpay/install/ReleaseManifestClientTest.kt`

**Step 1: Write failing parser/network tests**

```kotlin
@Test
fun `parse manifest with files and rules`() {
    // expect typed model and required fields
}
```

**Step 2: Run tests to verify failure**

Run: `cd navpay-android && ./gradlew testDebugUnitTest --tests '*ReleaseManifestClientTest*'`
Expected: FAIL.

**Step 3: Implement manifest client and model parsing**
- Add active release summary in payment app list model.
- Add API methods for manifest fetch and install event upload.

**Step 4: Re-run tests**

Run: `cd navpay-android && ./gradlew testDebugUnitTest --tests '*ReleaseManifestClientTest*'`
Expected: PASS.

**Step 5: Commit**

```bash
git -C navpay-android add app/src/main/java/com/navpay/Models.kt app/src/main/java/com/navpay/ApiClient.kt app/src/main/java/com/navpay/install/ReleaseManifestClient.kt app/src/test/java/com/navpay/install/ReleaseManifestClientTest.kt
git -C navpay-android commit -m "feat(android): add release manifest client"
```

### Task 7: Implement split selector + SHA-256 verifier

**Files:**
- Create: `navpay-android/app/src/main/java/com/navpay/install/SplitSelector.kt`
- Create: `navpay-android/app/src/main/java/com/navpay/install/ArtifactVerifier.kt`
- Create: `navpay-android/app/src/test/java/com/navpay/install/SplitSelectorTest.kt`

**Step 1: Write failing selection tests**

```kotlin
@Test
fun `abi falls back in supported_abis order`() {
    // expect first match by Build.SUPPORTED_ABIS
}
```

**Step 2: Run tests to verify failure**

Run: `cd navpay-android && ./gradlew testDebugUnitTest --tests '*SplitSelectorTest*'`
Expected: FAIL.

**Step 3: Implement selector and verifier**
- Enforce required base/abi/density presence.
- Compute file SHA-256 and compare to manifest value.
- Return explicit typed failure reasons.

**Step 4: Re-run tests**

Run: `cd navpay-android && ./gradlew testDebugUnitTest --tests '*SplitSelectorTest*'`
Expected: PASS.

**Step 5: Commit**

```bash
git -C navpay-android add app/src/main/java/com/navpay/install/SplitSelector.kt app/src/main/java/com/navpay/install/ArtifactVerifier.kt app/src/test/java/com/navpay/install/SplitSelectorTest.kt
git -C navpay-android commit -m "feat(android): add split selector and sha256 verification"
```

### Task 8: Implement PackageInstaller session pipeline and error mapping

**Files:**
- Create: `navpay-android/app/src/main/java/com/navpay/install/SessionInstaller.kt`
- Create: `navpay-android/app/src/main/java/com/navpay/install/InstallErrorMapper.kt`
- Create: `navpay-android/app/src/test/java/com/navpay/install/InstallErrorMapperTest.kt`

**Step 1: Write failing error mapping tests**

```kotlin
@Test
fun `maps INSTALL_FAILED_NO_MATCHING_ABIS to actionable remediation`() {
    // expect user-facing message + telemetry code
}
```

**Step 2: Run tests to verify failure**

Run: `cd navpay-android && ./gradlew testDebugUnitTest --tests '*InstallErrorMapperTest*'`
Expected: FAIL.

**Step 3: Implement session install and result receiver flow**
- Open session, stream all selected artifacts, commit once.
- Map platform status to domain errors.
- Upload install event per stage.

**Step 4: Re-run tests**

Run: `cd navpay-android && ./gradlew testDebugUnitTest --tests '*InstallErrorMapperTest*'`
Expected: PASS.

**Step 5: Commit**

```bash
git -C navpay-android add app/src/main/java/com/navpay/install/SessionInstaller.kt app/src/main/java/com/navpay/install/InstallErrorMapper.kt app/src/test/java/com/navpay/install/InstallErrorMapperTest.kt
git -C navpay-android commit -m "feat(android): add session installer and error mapping"
```

### Task 9: Replace Install Payment App UI flow to manifest-driven install

**Files:**
- Modify: `navpay-android/app/src/main/java/com/navpay/ui/paymentapps/PaymentAppsFragment.kt`
- Modify: `navpay-android/app/src/main/java/com/navpay/ui/paymentapps/PaymentAppsAdapter.kt` (if install state indicators needed)
- Create: `navpay-android/app/src/test/java/com/navpay/ui/paymentapps/PaymentAppsFlowTest.kt`

**Step 1: Write failing flow tests**

```kotlin
@Test
fun `clicking app triggers manifest install flow instead of opening browser`() {
    // assert no ACTION_VIEW fallback on happy path
}
```

**Step 2: Run tests to verify failure**

Run: `cd navpay-android && ./gradlew testDebugUnitTest --tests '*PaymentAppsFlowTest*'`
Expected: FAIL.

**Step 3: Implement UI flow replacement**
- Remove direct `Intent.ACTION_VIEW(downloadUrl)` main path.
- Orchestrate manifest fetch -> select -> download/verify -> session install.
- Keep guarded fallback only for unrecoverable API/protocol mismatch.

**Step 4: Re-run tests**

Run: `cd navpay-android && ./gradlew testDebugUnitTest --tests '*PaymentAppsFlowTest*'`
Expected: PASS.

**Step 5: Commit**

```bash
git -C navpay-android add app/src/main/java/com/navpay/ui/paymentapps/PaymentAppsFragment.kt app/src/main/java/com/navpay/ui/paymentapps/PaymentAppsAdapter.kt app/src/test/java/com/navpay/ui/paymentapps/PaymentAppsFlowTest.kt
git -C navpay-android commit -m "feat(android): switch payment app install to manifest-driven flow"
```

### Task 10: End-to-end verification and rollout checklist

**Files:**
- Create: `navpay-admin/docs/ops/payment-app-release-runbook.md`
- Create: `navpay-android/docs/plans/2026-04-04-payment-app-installer-e2e-checklist.md`

**Step 1: Write failing verification checklist tests/scripts references**

```md
- [ ] active release gate blocks missing required split
- [ ] real-device arm64 install succeeds
- [ ] install failure emits install-events telemetry
```

**Step 2: Run full quality gates**

Run:
- `cd navpay-admin && yarn lint && yarn typecheck && yarn test`
- `cd navpay-admin && yarn test:e2e`
- `cd navpay-android && ./gradlew test`

Expected: PASS.

**Step 3: Document runbook and rollback procedure**
- Activation checklist.
- Rollback to previous release.
- Artifact retention and cleanup policy.

**Step 4: Final verification rerun**

Run:
- `cd navpay-admin && yarn build`
- `cd navpay-android && ./gradlew assembleDebug`

Expected: PASS.

**Step 5: Commit**

```bash
git -C navpay-admin add docs/ops/payment-app-release-runbook.md
git -C navpay-android add docs/plans/2026-04-04-payment-app-installer-e2e-checklist.md
git -C navpay-admin commit -m "docs(admin): add payment app release runbook"
git -C navpay-android commit -m "docs(android): add installer e2e checklist"
```
