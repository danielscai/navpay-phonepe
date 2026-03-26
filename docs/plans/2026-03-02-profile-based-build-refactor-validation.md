# 2026-03-02 Profile-Based Build Refactor Validation

本文档用于 Task 7 收尾验证，按 Gate A-E 记录最终执行步骤与证据清单。

## 环境前提

- Python 3 可用。
- `src/cache-manager/cache_manager.py` 可直接运行。
- Gate B/C/D 涉及 `adb` 与模拟器（建议 `emulator-5554`），在无 adb 环境下仅保留可执行步骤，不在本地单测流程强制执行。

## 快速路径与发布路径

- 组合路径冒烟：`python3 src/pipeline/orch/orchestrator.py test --smoke --serial emulator-5554`
- 全链路发布集成：`python3 src/pipeline/orch/orchestrator.py test --serial emulator-5554`

## Gate A: Unit Gate（无需 adb）

执行：

```bash
python3 -m unittest src/cache-manager/tests/test_cli_backcompat.py -v
python3 -m unittest discover -s src/cache-manager/tests -p 'test_*.py' -v
python3 src/cache-manager/cache_manager.py profile full plan
```

通过标准：

- `test_cli_backcompat.py` 通过，且 `RUN_EMU_TESTS` 未开启时，真实集成测试用例显示 `skipped`。
- 全量 `test_*.py` 用例通过。
- `profile full plan` 输出合法 JSON 模块序列。

证据清单：

- 两条 `unittest` 命令输出日志。
- `profile full plan` 输出内容快照。

## Gate B: Smoke Integration Gate（需要 adb/模拟器）

执行：

```bash
python3 src/pipeline/orch/orchestrator.py test --smoke --serial emulator-5554
```

通过标准：

- 组合模块冒烟路径出现 `TEST RESULT: SUCCESS`。
- 无 `logcat -b crash` 崩溃证据。

证据清单：

- 冒烟命令终端输出。
- 对应的 logcat/crash 片段或路径。

## Gate C: Full Stack Integration Gate（需要 adb/模拟器）

执行：

```bash
python3 src/pipeline/orch/orchestrator.py test --serial emulator-5554
```

通过标准：

- `profile full` 流程完成并成功安装、启动。
- 日志包含目标模块标签（`SigBypass`、`HttpInterceptor`、`PPHelper`）。

证据清单：

- `profile full test` 终端输出。
- 关键日志标签命中片段。

## Gate D: Behavior Parity Gate（需要 adb/模拟器）

执行（示例）：

```bash
yarn probe:baseline
yarn probe:candidate
yarn probe:compare
```

通过标准：

- 启动路径、登录可达性、关键标签、crash 状态与基线一致。
- 若存在差异，需提供明确解释并获批准。

证据清单：

- baseline/candidate probe 日志。
- compare 结果（退出码与摘要）。

## Gate E: Artifact Retention Gate（哈希无需 adb，探针产物通常需要 adb）

执行（示例）：

```bash
yarn baseline:archive
yarn candidate:archive
```

通过标准：

- baseline 与 candidate 均保留 APK、`apk.sha256`、`meta.json`、probe 日志。

证据清单：

- 归档目录树（含时间戳 run 目录）。
- `apk.sha256` 与 `meta.json` 内容。

## 备注

- 在默认 CI/本地无 adb 场景，仅将 Gate A 作为强制门禁。
- Gate B/C/D/E 的 adb 步骤应在模拟器可用环境执行，并将输出附回本文件或关联报告。
