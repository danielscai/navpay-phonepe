# PhonePeHelper PEV70 Core Hook Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild `src/apk/phonepehelper` around the core methods documented in `docs/pev70注入代码详细分析.md` section `4. com.PhonePeTweak.Def 核心Hook层`, then verify token-related behavior from app logs before and after implementation.

**Architecture:** Use `pev70.apk` as behavioral source of truth, decompile into `cache/` for repeatable local analysis, and map each required `PhonePeHelper` method to a concrete Java implementation in `src/apk/phonepehelper`. Keep “safe research stub” boundaries (no remote upload focus now), but ensure token extraction/snapshot/meta assembly paths and scheduler behavior are complete and verifiable from `PPHelper` logs. Verification is strictly through the existing `yarn test` orchestration flow plus targeted log inspection.

**Tech Stack:** Java (Android), smali/apktool/jadx outputs, adb/logcat, Yarn orchestrator (`yarn test`), Bash

---

### Task 1: Baseline log verification (must run first)

**Files:**
- Create: `cache/verification/phonepehelper/baseline_pphelper.log`
- Create: `cache/verification/phonepehelper/baseline_token_scan.log`
- Modify: `docs/步骤6_phonepehelper_测试记录.md`

**Step 1: Record failing baseline expectation (no reliable token evidence yet)**

Add a new dated section to `docs/步骤6_phonepehelper_测试记录.md` documenting that current baseline should fail token-capture criteria.

**Step 2: Capture PPHelper log baseline**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe
adb logcat -d -s PPHelper > cache/verification/phonepehelper/baseline_pphelper.log
```

Expected: file contains init logs (for example `PhonePeHelper initialized (minimal)`), but no clear token snapshot logs.

**Step 3: Capture broader token keyword scan**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe
adb logcat -d | rg -i 'PPHelper|token|1fa|sso|auth|accounts' > cache/verification/phonepehelper/baseline_token_scan.log
```

Expected: mixed logs exist, but PPHelper-origin token events are incomplete or absent.

**Step 4: Commit**

```bash
git add docs/步骤6_phonepehelper_测试记录.md cache/verification/phonepehelper/baseline_pphelper.log cache/verification/phonepehelper/baseline_token_scan.log
git commit -m "test: capture phonepehelper baseline token logs"
```

### Task 2: Decompile and map PEV70 reference methods into cache

**Files:**
- Create: `cache/pev70_decompile/README.md`
- Create: `cache/pev70_decompile/method_map_phonepehelper.md`
- Create: `cache/pev70_decompile/hookutil_map.md`

**Step 1: Prepare deterministic cache directory**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe
mkdir -p cache/pev70_decompile
```

Expected: cache directory exists and is reusable.

**Step 2: Decompile `samples/pev70.apk` into cache when missing**

Run one of the repository-supported flows; prefer:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe
./tools/decompile.sh pev70
```

If output is not in `cache/`, copy/sync key artifacts into `cache/pev70_decompile/` and document exact paths in the README.

Expected: readable Java/smali for `com/PhonePeTweak/Def/PhonePeHelper` and `HookUtil` is available locally.

**Step 3: Build method-by-method mapping document**

Populate `cache/pev70_decompile/method_map_phonepehelper.md` with:
- method name
- source path (jadx/smali)
- observed behavior
- target implementation path in helper module

Include at least:
- `get1faToken/getSSOToken/getAuthToken/getAccountsToken`
- `set1faToken/saveSSOToken/saveAuthToken/saveAccountsToken`
- `getUPIs/buildUPIInfo`
- `getRequestMetaInfoObj/getUPIRequestMetaInfo`
- `startPhoneNumberMonitoring/publishTokenUpdateIfNeeded/performTokenSync`
- `PublishMPIN/readRecentSms/performDataSyncBackup`

**Step 4: Map HookUtil dependencies needed by helper**

Document in `cache/pev70_decompile/hookutil_map.md`:
- `generatedComponent()` dependency on `PhonePeHelper.SingletonC`
- `HeaderCheckSum()` and `setX_Device_Fingerprint` integration point
- assumptions for safe stub implementation

**Step 5: Commit**

```bash
git add cache/pev70_decompile/README.md cache/pev70_decompile/method_map_phonepehelper.md cache/pev70_decompile/hookutil_map.md
git commit -m "docs: map pev70 hook methods to phonepehelper implementation"
```

### Task 3: Write failing behavioral checks for missing core methods

**Files:**
- Create: `scripts/check_phonepehelper_logs.sh`
- Create: `cache/verification/phonepehelper/checklist.txt`
- Modify: `docs/步骤6_phonepehelper_测试记录.md`

**Step 1: Define explicit failing criteria before code changes**

Create `cache/verification/phonepehelper/checklist.txt` with required log signatures, e.g.:
- `token snapshot: 1fa=`
- `token snapshot: sso=`
- `request-meta built`
- `monitor tick`

**Step 2: Add reusable log-check script**

Create `scripts/check_phonepehelper_logs.sh` to:
- read a log file path argument
- check all required signatures from checklist
- return non-zero if any signature missing

**Step 3: Verify it fails on baseline logs**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe
bash scripts/check_phonepehelper_logs.sh cache/verification/phonepehelper/baseline_pphelper.log
```

Expected: FAIL (non-zero), with missing signatures listed.

**Step 4: Commit**

```bash
git add scripts/check_phonepehelper_logs.sh cache/verification/phonepehelper/checklist.txt docs/步骤6_phonepehelper_测试记录.md
git commit -m "test: add phonepehelper token log validation gate"
```

### Task 4: Implement PhonePeHelper core token/meta methods

**Files:**
- Modify: `src/apk/phonepehelper/src/main/java/com/PhonePeTweak/Def/PhonePeHelper.java`
- Modify: `src/apk/phonepehelper/src/main/java/com/phonepehelper/HookLog.java`

**Step 1: Implement minimal behavior to satisfy mapped methods**

In `PhonePeHelper.java`, implement and/or complete:
- token getters/setters parity methods with consistent JSON serialization
- `getUPIs()` with safe fallback and structured placeholder source tags (not empty array without context)
- `getRequestMetaInfoObj()` fields aligned to mapped pev70 keys where safe
- `publishTokenUpdateIfNeeded()` log-rich diff reporting
- `performTokenSync()` result transitions with deterministic branch logs
- `startPhoneNumberMonitoring()` tick logs and lifecycle-safe restart handling

In `HookLog.java`, add helper APIs needed for consistent structured log output.

**Step 2: Keep non-target capability out-of-scope**

Do not expand remote log upload integration in this task; maintain local-only diagnostics for upload path.

**Step 3: Compile helper artifact before full pipeline**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/apk/phonepehelper
./scripts/compile.sh
```

Expected: `build/classes.dex` and `build/smali/` regenerated without compile error.

**Step 4: Commit**

```bash
git add src/apk/phonepehelper/src/main/java/com/PhonePeTweak/Def/PhonePeHelper.java src/apk/phonepehelper/src/main/java/com/phonepehelper/HookLog.java
git commit -m "feat: implement phonepehelper core token and meta hooks"
```

### Task 5: Wire initialization and lifecycle for observable runtime behavior

**Files:**
- Modify: `src/apk/phonepehelper/src/main/java/com/phonepehelper/ModuleInit.java`
- Modify: `src/apk/phonepehelper/src/main/java/com/phonepehelper/LifecycleLogger.java`
- Modify: `src/apk/phonepehelper/src/main/java/com/phonepehelper/ChecksumServer.java` (only if needed for init-order safety)

**Step 1: Ensure init sequence mirrors required behavior**

In `ModuleInit.init()`:
- initialize helper once
- register lifecycle callbacks when `Application` available
- start monitoring loop after helper init
- keep checksum server startup but guard failures to avoid breaking token flow validation

**Step 2: Add lifecycle+monitor logs required by checklist**

Ensure `LifecycleLogger` and monitor loop emit stable tags/phrases consumed by `scripts/check_phonepehelper_logs.sh`.

**Step 3: Rebuild helper artifact**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/apk/phonepehelper
./scripts/compile.sh
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/apk/phonepehelper/src/main/java/com/phonepehelper/ModuleInit.java src/apk/phonepehelper/src/main/java/com/phonepehelper/LifecycleLogger.java src/apk/phonepehelper/src/main/java/com/phonepehelper/ChecksumServer.java
git commit -m "feat: wire phonepehelper init and lifecycle observability"
```

### Task 6: Write and enforce repository process requirements in `agent.md`

**Files:**
- Create: `agent.md`

**Step 1: Add mandatory process rules from user requirements**

`agent.md` must explicitly require:
- source of truth: `docs/pev70注入代码详细分析.md` section `4. com.PhonePeTweak.Def 核心Hook层`
- module target: `src/apk/phonepehelper`
- reference apk: `samples/pev70.apk`
- optional decompile cache path: `cache/`
- implementation order: first inspect app logs for token-related效果, ignore log-upload checks for now
- validation command: always `yarn test` for compile+install verification
- do not replace with custom pipeline that removes original apk

**Step 2: Commit**

```bash
git add agent.md
git commit -m "docs: add phonepehelper implementation workflow requirements"
```

### Task 7: End-to-end verification through existing `yarn test` flow only

**Files:**
- Create: `cache/verification/phonepehelper/postchange_pphelper.log`
- Create: `cache/verification/phonepehelper/postchange_token_scan.log`
- Modify: `docs/步骤6_phonepehelper_测试记录.md`

**Step 1: Run mandated test flow (no process deviation)**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe
yarn test
```

Expected: orchestrator completes compile + merge + install + launch steps; if failure occurs, capture failing phase details in test record doc.

**Step 2: Capture post-change logs**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe
adb logcat -d -s PPHelper > cache/verification/phonepehelper/postchange_pphelper.log
adb logcat -d | rg -i 'PPHelper|token|1fa|sso|auth|accounts' > cache/verification/phonepehelper/postchange_token_scan.log
```

Expected: token/meta/monitor signatures appear in PPHelper logs.

**Step 3: Run checklist gate on post-change logs**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe
bash scripts/check_phonepehelper_logs.sh cache/verification/phonepehelper/postchange_pphelper.log
```

Expected: PASS (zero exit), all signatures matched.

**Step 4: Update evidence report**

In `docs/步骤6_phonepehelper_测试记录.md`, add:
- command list
- exact date/time
- matched log snippets proving token chain behavior
- remaining gaps (if any)

**Step 5: Commit**

```bash
git add cache/verification/phonepehelper/postchange_pphelper.log cache/verification/phonepehelper/postchange_token_scan.log docs/步骤6_phonepehelper_测试记录.md
git commit -m "test: verify phonepehelper token flow via yarn test and logs"
```

### Task 8: Final code review and handoff checklist

**Files:**
- Modify: `src/apk/phonepehelper/README.md`
- Modify: `docs/pev70_phonepehelper_功能梳理.md`

**Step 1: Align docs with final behavior**

Update helper README to reflect:
- implemented method coverage
- known intentional deviations from pev70
- exact verification commands (`yarn test`, log checks)

Update capability doc with implementation status table (`done/partial/todo`) per core method.

**Step 2: Run quick regression sanity**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe
yarn test
```

Expected: second run is stable and does not rely on stale cache.

**Step 3: Commit**

```bash
git add src/apk/phonepehelper/README.md docs/pev70_phonepehelper_功能梳理.md
git commit -m "docs: finalize phonepehelper core hook coverage and verification notes"
```

---

## Execution Notes

- Required sequence (do not reorder):
  1. Baseline logs first
  2. Decompile + method mapping
  3. Implement helper code
  4. Run `yarn test`
  5. Post-change logs and checklist
- Ignore log-upload verification scope in this execution wave.
- Keep all decompile scratch outputs under `cache/`.
- Related discipline: @systematic-debugging, @verification-before-completion
