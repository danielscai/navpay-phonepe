# Test Startup Stability Notes

Last updated: 2026-03-24

## 背景

在 `yarn test` 的保留数据模式（`reinstall` / `keep`）下，历史上出现“有时能拉起，有时失败”的不稳定现象。  
用户要求：**检测逻辑是正确的，不允许因为检测不到而放宽或修改检测条件**，必须定位并修复真实拉起问题。

## 问题现象

- 自动化启动偶发返回：
  - `Warning: Activity not started, intent has been delivered to currently running top-most instance.`
- 此时 `pidof com.phonepe.app` 可能为空，随后超时失败。
- 手动点击桌面图标通常可以成功进入 App。

## 根因分析

- 原流程以 `am start -W -n <package>/<activity>` 为主。
- 在 keep 模式、带历史任务栈的场景下，系统可能把 Intent 交给当前顶层任务（例如 GMS 相关中间页），导致自动启动链路被拦截。
- 手动点击图标是 `MAIN + LAUNCHER` 路径，与原自动路径行为不完全一致，因此表现出“手动能起、自动失败”。

## 修复策略（不改检测条件）

仅调整“拉起流程”和“安装鲁棒性”，**不放宽检测条件**：

1. 启动前强制停止目标进程并确认 `pidof` 为空。
2. 启动前回到桌面（`KEYCODE_HOME`）。
3. 使用 LAUNCHER 方式启动：
   - `am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n <package>/<activity>`
4. 若出现 top-most instance warning，则追加一次图标点击等价兜底：
   - `monkey -p <package> -c android.intent.category.LAUNCHER 1`
5. 安装阶段对瞬时失败增加 1 次自动重试（保留失败原因为最终报错）。
6. LAUNCHER 启动增加 `NEW_TASK | CLEAR_TASK`（`-f 0x10008000`），清理被 GMS 中间页占据的旧任务栈。
7. 将保留数据重装能力拆为独立模式：
   - `reinstall`：不卸载，直接 `install -r`
   - `keep`：`pm uninstall -k --user 0 <package>` 后再 fresh install（非 `-r`）

## 已修复的误判

- 之前会把 `monkey` 进程自身的 `AndroidRuntime` 日志当作 App crash。
- 现已改为仅识别与目标包相关的真实崩溃信号（如 `FATAL EXCEPTION`/`SIGSEGV`/`Process: <package>` 等）。
- `monkey` 噪声日志不再触发 crash 失败。

## 检测逻辑边界（保持不变）

以下检测均保持严格，不做放宽：

- Activity 检测（目标页/登录页可见）
- 进程存在性检测（`pidof`）
- 非 smoke 模式日志标签检测（如 `SigBypass`）

## 回归验证（本地）

- `yarn test smoke emulator-5554`：通过
- `yarn test emulator-5554` 连续 5 次：`5/5` 通过
- `yarn test clean emulator-5554`：通过
- 修复后复现场景回归：`yarn test emulator-5554` 连续 3 次：`3/3` 通过

## 相关文件

- `src/pipeline/orch/orchestrator.py`
- `src/pipeline/orch/README.md`
- `package.json`
