# PhonePeHelper Token E2E Validation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 完整验证 `https_interceptor -> phonepehelper -> navpay-admin /api/intercept/phonepe/snapshot -> 设备详情页` 的 token 端到端链路，确认不再出现空 token 快照。

**Architecture:** 先在本地以最小范围回归单测保证改动有效，再通过 orchestrator 在模拟器上执行 `phonepehelper-only` smoke 流程。随后对 admin 端进行 API 与页面双重验证，并保留 log/HTTP/DB 证据形成闭环。若环境阻断（模拟器、端口、服务未起），在同次执行中完成排障并重试，不以“中间状态”结束。

**Tech Stack:** Android Gradle, Python orchestrator, ADB/logcat, Next.js API (navpay-admin), PostgreSQL/Prisma, Bash

---

### Task 1: Preflight & Baseline Verification

**Files:**
- Modify: `src/apk/https_interceptor/app/src/test/java/com/httpinterceptor/interceptor/RemoteLoggingCaptureContractTest.java`
- Modify: `src/apk/https_interceptor/app/src/main/java/com/httpinterceptor/interceptor/RemoteLoggingInterceptor.java`
- Create: `src/apk/https_interceptor/app/src/main/java/com/httpinterceptor/interceptor/PhonePeTokenCapture.java`
- Create: `cache/verification/phonepehelper/e2e_preflight_env.txt`

**Step 1: Write/confirm the failing contract test**

```java
@Test
public void interceptorMustBridgeTrafficToPhonePeTokenCapture() throws Exception {
    String src = new String(
        Files.readAllBytes(Paths.get("src/main/java/com/httpinterceptor/interceptor/RemoteLoggingInterceptor.java")),
        StandardCharsets.UTF_8
    );
    assertTrue(src.contains("PhonePeTokenCapture.captureFromTraffic("));
}
```

**Step 2: Run test to verify it fails (if bridge absent)**

Run: `./gradlew :app:testDebugUnitTest --tests com.httpinterceptor.interceptor.RemoteLoggingCaptureContractTest`
Expected: FAIL at `interceptorMustBridgeTrafficToPhonePeTokenCapture`

**Step 3: Implement minimal bridge and token-capture class**

```java
PhonePeTokenCapture.captureFromTraffic(url, requestHeaders, responseBody);
```

```java
Class<?> helperClass = Class.forName("com.PhonePeTweak.Def.PhonePeHelper");
set1faMethod = helperClass.getMethod("set1faToken", JSONObject.class);
setSsoMethod = helperClass.getMethod("saveSSOToken", JSONObject.class);
setAuthMethod = helperClass.getMethod("saveAuthToken", JSONObject.class);
setAccountsMethod = helperClass.getMethod("saveAccountsToken", JSONObject.class);
```

**Step 4: Run tests to verify pass**

Run: `./gradlew :app:testDebugUnitTest`
Expected: PASS

**Step 5: Capture preflight environment evidence**

Run:
```bash
{
  echo "date=$(date -Iseconds)"
  echo "adb_devices:"; adb devices
  echo "admin_3000:"; lsof -iTCP:3000 -sTCP:LISTEN || true
} > cache/verification/phonepehelper/e2e_preflight_env.txt
```
Expected: 文件存在，包含设备与 3000 端口监听信息。

**Step 6: Commit**

```bash
git add src/apk/https_interceptor/app/src/main/java/com/httpinterceptor/interceptor/RemoteLoggingInterceptor.java \
  src/apk/https_interceptor/app/src/main/java/com/httpinterceptor/interceptor/PhonePeTokenCapture.java \
  src/apk/https_interceptor/app/src/test/java/com/httpinterceptor/interceptor/RemoteLoggingCaptureContractTest.java \
  cache/verification/phonepehelper/e2e_preflight_env.txt
git commit -m "fix(https_interceptor): bridge token capture into phonepehelper"
```

### Task 2: Emulator Smoke E2E Execution

**Files:**
- Create: `cache/verification/phonepehelper/e2e_orch_test.log`
- Create: `cache/verification/phonepehelper/e2e_pphelper_logcat.log`
- Create: `cache/verification/phonepehelper/e2e_httpinterceptor_logcat.log`

**Step 1: Clear logcat and run phonepehelper smoke**

Run:
```bash
adb -s emulator-5554 logcat -c
python3 src/pipeline/orch/orchestrator.py test --profile phonepehelper-only --smoke --serial emulator-5554 | tee cache/verification/phonepehelper/e2e_orch_test.log
```
Expected: orchestrator exit code 0。

**Step 2: Collect module logs**

Run:
```bash
adb -s emulator-5554 logcat -d -s PPHelper > cache/verification/phonepehelper/e2e_pphelper_logcat.log
adb -s emulator-5554 logcat -d -s HttpInterceptor:V PhonePeTokenCapture:V > cache/verification/phonepehelper/e2e_httpinterceptor_logcat.log
```
Expected: 日志里可见 token sync/bridge/capture 关键字。

**Step 3: If smoke fails, perform same-turn recovery and retry once**

Run (only on failure):
```bash
python3 src/pipeline/orch/orchestrator.py test --profile phonepehelper-only --smoke --serial emulator-5554 --install-mode clean | tee -a cache/verification/phonepehelper/e2e_orch_test.log
```
Expected: 至少一次成功执行或明确记录不可恢复根因（如模拟器离线）。

**Step 4: Commit**

```bash
git add cache/verification/phonepehelper/e2e_orch_test.log \
  cache/verification/phonepehelper/e2e_pphelper_logcat.log \
  cache/verification/phonepehelper/e2e_httpinterceptor_logcat.log
git commit -m "test(phonepehelper): run smoke e2e and collect module logs"
```

### Task 3: Admin Ingest & UI Verification

**Files:**
- Create: `cache/verification/phonepehelper/e2e_admin_snapshot_api.json`
- Create: `cache/verification/phonepehelper/e2e_admin_devices_page.txt`
- Modify: `docs/步骤6_phonepehelper_测试记录.md`

**Step 1: Query snapshot ingest API directly**

Run:
```bash
curl -s "http://localhost:3000/api/admin/resources/devices/dev_c5b8a148-f418-44b0-928d-874333d72e4b/phonepehelper" > cache/verification/phonepehelper/e2e_admin_snapshot_api.json
```
Expected: JSON 包含 `rows` 且最新 `payload.requestMeta.tokens` 非全空对象。

**Step 2: Capture page-level evidence for target tab**

Run:
```bash
curl -s "http://localhost:3000/admin/resources/devices/dev_c5b8a148-f418-44b0-928d-874333d72e4b?tab=phonepehelper" > cache/verification/phonepehelper/e2e_admin_devices_page.txt
```
Expected: 页面响应正常（非 500/重定向登录页）。

**Step 3: Update verification doc with exact timestamps and outcomes**

```markdown
## 2026-03-26 E2E token capture closure
- smoke command:
- orchestrator result:
- PPHelper log markers:
- HttpInterceptor/PhonePeTokenCapture markers:
- admin API snapshot keys:
- final status: pass/fail + root cause
```

**Step 4: Run targeted admin unit guard**

Run:
```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-admin
yarn test tests/unit/device-phonepehelper-route.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add cache/verification/phonepehelper/e2e_admin_snapshot_api.json \
  cache/verification/phonepehelper/e2e_admin_devices_page.txt \
  docs/步骤6_phonepehelper_测试记录.md
git commit -m "test(admin): verify phonepehelper snapshot tokens end-to-end"
```

### Task 4: Final Review & Handoff

**Files:**
- Modify: `docs/步骤6_phonepehelper_测试记录.md`

**Step 1: Run final full check commands**

Run:
```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe
./src/pipeline/tools/test_module_independent.sh emulator-5554
cd /Users/danielscai/Documents/workspace/navpay/navpay-admin
yarn test tests/unit/intercept/phonepe-snapshot-route.test.ts tests/unit/device-phonepehelper-route.test.ts
```
Expected: 全部通过；若失败需在文档中列出失败点与补救动作。

**Step 2: Final documentation pass**

在 `docs/步骤6_phonepehelper_测试记录.md` 追加最终结论（是否真正消除空 token 问题、仍存风险、下一步建议）。

**Step 3: Commit**

```bash
git add docs/步骤6_phonepehelper_测试记录.md
git commit -m "docs(phonepehelper): finalize e2e verification conclusion"
```

**References:** `@superpowers:test-driven-development` `@superpowers:systematic-debugging` `@superpowers:subagent-driven-development`
