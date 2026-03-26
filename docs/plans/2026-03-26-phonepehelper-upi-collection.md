# PhonePeHelper UPI Data Collection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 `phonepehelper` 的 UPI 数据采集，使 `payload.upis` 优先返回真实账户/VPA 数据而不是固定 `local_stub`。

**Architecture:** 在 `PhonePeHelper` 内新增“从本地 token 快照解析 UPI 账户”的纯 JSON 提取链路，优先读取缓存，缓存缺失时实时提取并回写 `KEY_UPI_CACHE`。提取来源以 `accountsToken` 为主，并回退扫描 `auth/sso/1fa`，通过递归遍历对象抓取账户号与 `vpa/upiId` 等字段，最终输出标准结构 `{account, accountNum, appType, upis}`。

**Tech Stack:** Java (Android), org.json, SharedPreferences, adb/logcat（手工验证）

---

### Task 1: 建立失败基线与验收标准

**Files:**
- Modify: `docs/phonepehelper_数据采集字段设计.md`

**Step 1: Write the failing test**

在文档中新增“当前失败基线”：`getUPIs()` 仅返回 `local_stub/no_account_data`，`upis` 为空。

**Step 2: Run test to verify it fails**

Run: `cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe && rg -n "local_stub|no_account_data|KEY_UPI_CACHE" src/apk/phonepehelper/src/main/java/com/PhonePeTweak/Def/PhonePeHelper.java`
Expected: 存在 fallback 逻辑，且没有 UPI 缓存写入逻辑。

**Step 3: Write minimal implementation**

将验收标准写入文档：
- 有真实 UPI 时，`upis` 不能返回 `local_stub`。
- 无真实 UPI 时，才回退 `local_stub`。

**Step 4: Run test to verify it passes**

Run: `cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe && rg -n "UPI 信息字段|fallback|local_stub" docs/phonepehelper_数据采集字段设计.md`
Expected: 文档包含新验收标准。

**Step 5: Commit**

```bash
git add docs/phonepehelper_数据采集字段设计.md
git commit -m "docs: define upi collection acceptance criteria"
```

### Task 2: 实现 UPI 解析与缓存写入

**Files:**
- Modify: `src/apk/phonepehelper/src/main/java/com/PhonePeTweak/Def/PhonePeHelper.java`

**Step 1: Write the failing test**

在实现前记录失败行为：`getUPIs()` 无法从 token 中提取真实 UPI，且从不写 `KEY_UPI_CACHE`。

**Step 2: Run test to verify it fails**

Run: `cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe && rg -n "putString\(KEY_UPI_CACHE|extract.*UPI|collect.*UPI" src/apk/phonepehelper/src/main/java/com/PhonePeTweak/Def/PhonePeHelper.java`
Expected: 无匹配或仅有读取逻辑。

**Step 3: Write minimal implementation**

在 `PhonePeHelper.java` 增加：
- `collectUPIsFromTokens()`：聚合 `accounts/auth/sso/1fa` token 进行提取。
- `extractUpiEntriesFromJson(...)` 与递归扫描辅助方法：识别 `vpa/upi/upiId/virtualPaymentAddress`、`account/accountNum/accountNumber/maskedAccountNumber`。
- `persistUPICache(JSONArray upis)`：写入 `KEY_UPI_CACHE`。
- `refreshUPICacheFromTokens()`：当 token 更新后刷新缓存。
- 改造 `getUPIs()`：读取缓存 -> 缓存空则实时提取并写缓存 -> 最后 fallback。

**Step 4: Run test to verify it passes**

Run: `cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe && rg -n "putString\(KEY_UPI_CACHE|collectUPIsFromTokens|refreshUPICacheFromTokens|extractUpiEntriesFromJson" src/apk/phonepehelper/src/main/java/com/PhonePeTweak/Def/PhonePeHelper.java`
Expected: 出现新增方法与缓存写入逻辑。

**Step 5: Commit**

```bash
git add src/apk/phonepehelper/src/main/java/com/PhonePeTweak/Def/PhonePeHelper.java
git commit -m "feat: collect and cache upi data from token snapshots"
```

### Task 3: 接入同步链路并验证构建

**Files:**
- Modify: `src/apk/phonepehelper/src/main/java/com/PhonePeTweak/Def/PhonePeHelper.java`
- Modify: `docs/phonepehelper_数据采集字段设计.md`

**Step 1: Write the failing test**

在 token 变更后当前不会触发 UPI 缓存刷新，导致上传快照仍为旧值/fallback。

**Step 2: Run test to verify it fails**

Run: `cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe && rg -n "refreshUPICacheFromTokens" src/apk/phonepehelper/src/main/java/com/PhonePeTweak/Def/PhonePeHelper.java`
Expected: 若未接入，调用点不足（或不存在）。

**Step 3: Write minimal implementation**

在 token 保存/同步路径中接入 `refreshUPICacheFromTokens()`（例如 `performTokenSync` 或 `publishTokenUpdateIfNeeded` 的成功路径）。

**Step 4: Run test to verify it passes**

Run:
- `cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/apk/phonepehelper && ./scripts/compile.sh`
Expected: 编译成功，生成 `build/classes.dex`。

**Step 5: Commit**

```bash
git add src/apk/phonepehelper/src/main/java/com/PhonePeTweak/Def/PhonePeHelper.java docs/phonepehelper_数据采集字段设计.md
git commit -m "feat: refresh upi cache on token sync and document behavior"
```
