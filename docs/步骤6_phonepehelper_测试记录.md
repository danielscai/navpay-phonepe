# 步骤6：phonepehelper 注入测试记录

日期：2026-01-31
环境：emulator-5554（Android Emulator）
脚本：`tools/step6_verify_phonepehelper.sh`

## 结论

测试未通过：未捕获到 `PPHelper` 或 `SigBypass` 日志，应用进程未启动。

## 关键现象

- `PPHelper` 日志为空（`adb logcat -d -s PPHelper` 无输出）。
- `SigBypass` 日志为空。
- `pidof com.phonepe.app` 为空（应用进程未启动）。
- `am start` 返回 result code=3，Activity 未真正启动。
- 当前焦点 Activity 为 `com.google.android.gms/.auth.api.credentials.assistedsignin.ui.PhoneNumberHintActivity`。

## 诊断文件

生成于：`temp/phonepehelper_test/`

- `pidof.txt`：空
- `logcat_injection.txt`：空
- `logcat_phonepe.txt`：仅包含包替换/启动记录，无应用日志
- `dumpsys_activities.txt`：Activity 状态与当前焦点

## 可能原因（待验证）

1. 应用在模拟器上被阻止启动或被系统拦截（Play Integrity / 设备环境限制）。
2. 启动时立即退出，但未产生日志（需更深层级的 system/crash buffer 分析）。

## 下一步建议

- 在真实设备上重试步骤 6。
- 若仍失败，考虑扩展 Step6 脚本记录 crash buffer 与 system buffer。

---

## 2026-03-26 基线复测（执行改造前）

环境：`emulator-5554`  
目标：先确认当前注入后是否已具备 token 相关日志能力（仅检查 app 侧日志，不检查日志上传链路）。

### 执行命令

```bash
adb logcat -d -s PPHelper > cache/verification/phonepehelper/baseline_pphelper.log
adb logcat -d | rg -i 'PPHelper|token|1fa|sso|auth|accounts' > cache/verification/phonepehelper/baseline_token_scan.log
```

### 结果

- `baseline_pphelper.log` 仅 3 行，只有初始化日志：
  - `PhonePeHelper initialized (minimal)`（两次）
- 未看到 `PPHelper` 侧 1fa/sso/auth/accounts token 快照、token 变化上报、monitor tick 等关键日志。
- `baseline_token_scan.log` 虽有大量 token 关键字命中，但主要来自系统与 `HttpInterceptor`，不能证明 `PhonePeHelper` 核心 token 方法已完整生效。

### 结论

当前 `phonepehelper` 仅证明“模块初始化触发”，尚不能证明“核心 token Hook 能力可用且全面”。后续需要以 `docs/pev70注入代码详细分析.md` 的 `4. com.PhonePeTweak.Def 核心Hook层` 为基准补齐实现，并在改造后再次对比同口径日志。

---

## 2026-03-26 改造后复测（按固定流程）

执行顺序：
1. 基于 `samples/pev70.apk` 完成方法对照（缓存于 `cache/pev70_decompile/`）
2. 修改 `src/apk/phonepehelper`
3. 使用 `yarn test` 执行编译 + 注入 + 安装 + 拉起
4. 抓取并检查 `PPHelper` 日志

### 执行命令

```bash
yarn test
adb logcat -d -s PPHelper > cache/verification/phonepehelper/postchange_pphelper.log
adb logcat -d | rg -i 'PPHelper|token|1fa|sso|auth|accounts' > cache/verification/phonepehelper/postchange_token_scan.log
bash scripts/check_phonepehelper_logs.sh cache/verification/phonepehelper/postchange_pphelper.log
```

### `yarn test` 结果

- `orchestrator` 完成 full profile 产物构建、merge、打包、签名、安装、拉起。
- 最终输出包含：
  - `static injection verified: SIGBYPASS, HTTPS, PPHELPER`
  - `all required log tags detected: PPHelper`

### 关键日志证据（post-change）

来自 `cache/verification/phonepehelper/postchange_pphelper.log`：

- `PhonePeHelper.init ok`
- `Lifecycle logger registered`
- `startPhoneNumberMonitoring started`
- `publishTokenUpdateIfNeeded: changed=true, force=true`
- `token snapshot: 1fa=empty, sso=empty, auth=empty, accounts=empty`
- `request-meta built: {...}`
- `monitor tick: 1, result=NO_CHANGE`

### 日志 gate 结果

`scripts/check_phonepehelper_logs.sh` 对 post-change 日志检查结果：

- PASS: `PhonePeHelper initialized`
- PASS: `Lifecycle logger registered`
- PASS: `token snapshot: 1fa=`
- PASS: `request-meta built`
- PASS: `monitor tick`

结论：**本轮改造后，token 相关基础链路在 app 日志中已可观测并可重复验证。**

---

## 2026-03-26 E2E token capture closure（full profile + admin data layer）

目标：验证 `https_interceptor -> phonepehelper -> /api/intercept/phonepe/snapshot -> admin device tab` 全链路 token 非空。

### 执行命令（端到端）

```bash
# full profile smoke（包含 sigbypass + https_interceptor + phonepehelper）
python3 src/pipeline/orch/orchestrator.py test --profile full --smoke --serial emulator-5554 --install-mode clean

# 模块日志
adb -s emulator-5554 logcat -d -s PPHelper > cache/verification/phonepehelper/e2e_full_pphelper_logcat.log
adb -s emulator-5554 logcat -d -s HttpInterceptor:V PhonePeTokenCapture:V > cache/verification/phonepehelper/e2e_full_httpinterceptor_logcat.log

# admin 数据层验证（DB）
psql "$DATABASE_URL" -c "... PHONEPE_SNAPSHOT latest row ..."
```

### 结果摘要

- orchestrator：**PASS（smoke）**。
- 注入链路：`HttpInterceptor` 注入和 HTTPS 请求日志可见（说明 full profile 生效）。
- `PhonePeTokenCapture`：未观测到 `captured token bridge` 命中。
- `PPHelper`：仍为
  - `token snapshot: 1fa=empty, sso=empty, auth=empty, accounts=empty`
- admin 数据层（`payment_person_report_logs` 最新 `PHONEPE_SNAPSHOT`）：
  - `payload.requestMeta.tokens = {"1fa":{},"sso":{},"auth":{},"accounts":{}}`
  - `token/ssoToken/authToken/accountsToken` 均为空对象。

### 本轮新增修复（为保障 full e2e 可跑通）

- `src/apk/https_interceptor/scripts/compile.sh`：补入 `PhonePeTokenCapture.java` 编译输入。
- `src/apk/https_interceptor/scripts/merge.sh`：补入 `PhonePeTokenCapture*.smali` 注入清单。
- `src/pipeline/orch/orchestrator.py`：`am force-stop` 失败改为非致命，避免设备状态导致 smoke 中断。

### 结论

- **端到端测试流程已完整跑通并留档，不存在“中间停下”。**
- 但业务目标（页面 token 非空）**当前仍未达成**。
- 已确认问题不在 admin 展示层，而在采集侧：当前运行流量下 token 未被成功桥接写入 `PhonePeHelper` 存储。
