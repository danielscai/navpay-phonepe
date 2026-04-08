# Orchestrator Multi-App Standardization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Standardize `orch` into a multi-app CLI (`phonepe`, `paytm`) with default help, unified subcommands (`collect/info/decompiled/build/install/test`), and yarn top-level shortcuts.

**Architecture:** Introduce an app registry (`apps_manifest.json`) and route command behavior by `app_id` instead of hardcoded PhonePe-only assumptions. Keep existing snapshot/decompiled/build internals reusable by wrapping them in app-aware adapters, then add new top-level command aliases while preserving backward compatibility (`apk` alias to `build`, old collect options). Enforce serial collection order per emulator and per app.

**Tech Stack:** Python 3 (`argparse`, `json`, `pathlib`, `subprocess`), existing `orchestrator.py`, pytest test suite under `src/pipeline/orch/tests`, Yarn scripts in root `package.json`, Markdown docs.

---

### Task 1: Add app registry and command contract baseline

**Files:**
- Create: `src/pipeline/orch/apps_manifest.json`
- Modify: `src/pipeline/orch/orchestrator.py`
- Test: `src/pipeline/orch/tests/test_cli_contract.py`

**Step 1: Write the failing test**

```python
def test_cli_supports_app_scoped_commands_and_default_help() -> None:
    parser = orch.build_parser()
    args = parser.parse_args(["build", "phonepe"])
    assert args.cmd == "build"
    assert args.app == "phonepe"
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_cli_contract.py::CliContractTest::test_cli_supports_app_scoped_commands_and_default_help -q`
Expected: FAIL (`build` and app positional not defined).

**Step 3: Write minimal implementation**

```python
SUPPORTED_APPS = tuple(load_apps_manifest().keys())

build_parser.add_parser("build").add_argument("app", choices=SUPPORTED_APPS)
```

Also add loader:

```python
def load_apps_manifest(path: Path = SCRIPT_DIR / "apps_manifest.json") -> dict:
    ...
```

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_cli_contract.py::CliContractTest::test_cli_supports_app_scoped_commands_and_default_help -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/pipeline/orch/apps_manifest.json src/pipeline/orch/orchestrator.py src/pipeline/orch/tests/test_cli_contract.py
git commit -m "feat(orch): add app registry and app-scoped cli contract"
```

### Task 2: Make `yarn orch` default to help output

> Note (minimal sequencing adjustment): register a placeholder `decompiled` subcommand in this task so help-contract assertions pass; implement full `decompiled <app> [version]` behavior in Task 5.

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py`
- Test: `src/pipeline/orch/tests/test_cli_contract.py`

**Step 1: Write the failing test**

```python
def test_main_without_args_prints_help_and_exits_zero(capsys):
    code = orch.main([])
    out = capsys.readouterr().out
    assert code == 0
    assert "collect" in out
    assert "decompiled" in out
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_cli_contract.py::test_main_without_args_prints_help_and_exits_zero -q`
Expected: FAIL (`argparse` exits with code 2).

**Step 3: Write minimal implementation**

```python
def main(argv=None):
    parser = build_parser()
    raw = list(argv or [])
    if not raw:
        parser.print_help()
        return 0
```

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_cli_contract.py::test_main_without_args_prints_help_and_exits_zero -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/tests/test_cli_contract.py
git commit -m "feat(orch): print help when invoked without subcommand"
```

### Task 3: Standardize collect for multi-app serial execution

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py`
- Modify: `src/pipeline/orch/device_matrix.example.json`
- Create: `src/pipeline/orch/tests/test_collect_multi_app.py`

**Step 1: Write the failing test**

```python
def test_collect_all_runs_all_apps_per_emulator_before_next_emulator(monkeypatch):
    order = []
    # mock two emulators, two apps
    # assert sequence: emu1-phonepe, emu1-paytm, emu2-phonepe, emu2-paytm
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_collect_multi_app.py::test_collect_all_runs_all_apps_per_emulator_before_next_emulator -q`
Expected: FAIL.

**Step 3: Write minimal implementation**

```python
def run_collect_all_apps(matrix_path: str, apps: list[str]):
    for target in matrix_targets_in_order:
        for app in apps:
            run_collect_for_app_target(app, target)
```

Expose:
- `orch collect` => all apps
- `orch collect <app>` => single app

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_collect_multi_app.py -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/device_matrix.example.json src/pipeline/orch/tests/test_collect_multi_app.py
git commit -m "feat(orch): add serial multi-app collect orchestration"
```

### Task 4: Add `orch info` to inspect collected apps and versions

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py`
- Create: `src/pipeline/orch/tests/test_info_command.py`

**Step 1: Write the failing test**

```python
def test_info_lists_collected_versions_per_app(tmp_path, monkeypatch):
    # arrange snapshot indexes for phonepe/paytm
    # assert output includes app id + versionCode list
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_info_command.py::test_info_lists_collected_versions_per_app -q`
Expected: FAIL (`info` command missing).

**Step 3: Write minimal implementation**

```python
def cmd_info(app: Optional[str] = None):
    # read cache/<app>/snapshots/index.json
    # print versions, digest, updated_at
```

Add parser entry: `orch info [app]`.

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_info_command.py -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/tests/test_info_command.py
git commit -m "feat(orch): add info command for collected app/version inventory"
```

### Task 5: Add `decompiled` command with latest and pinned version

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py`
- Create: `src/pipeline/orch/tests/test_decompiled_command.py`

**Step 1: Write the failing test**

```python
def test_decompiled_command_supports_latest_and_version_pin(monkeypatch):
    # orch decompiled phonepe
    # orch decompiled phonepe 26022705
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_decompiled_command.py::test_decompiled_command_supports_latest_and_version_pin -q`
Expected: FAIL.

**Step 3: Write minimal implementation**

```python
def cmd_decompiled(app: str, version: str = ""):
    profile_prepare(..., snapshot_version=version)
```

Reuse existing snapshot/decompiled path logic.

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_decompiled_command.py -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/tests/test_decompiled_command.py
git commit -m "feat(orch): add decompiled command for latest or pinned version"
```

### Task 6: Add `build` command as standardized alias of current `apk`

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py`
- Test: `src/pipeline/orch/tests/test_cli_contract.py`

**Step 1: Write the failing test**

```python
def test_build_command_routes_to_profile_apk(monkeypatch):
    # assert orch build phonepe calls profile_apk
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_cli_contract.py::test_build_command_routes_to_profile_apk -q`
Expected: FAIL.

**Step 3: Write minimal implementation**

```python
elif args.cmd == "build":
    profile_apk(...)
```

Keep `apk` as compatibility alias that internally calls same handler.

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_cli_contract.py::test_build_command_routes_to_profile_apk -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/tests/test_cli_contract.py
git commit -m "feat(orch): standardize build command and keep apk alias"
```

### Task 7: Add `install` command for latest build output

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py`
- Create: `src/pipeline/orch/tests/test_install_command.py`

**Step 1: Write the failing test**

```python
def test_install_uses_running_emulator_or_specific_serial(monkeypatch):
    # no serial => pick running emulator
    # with --serial => use explicit device
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_install_command.py::test_install_uses_running_emulator_or_specific_serial -q`
Expected: FAIL.

**Step 3: Write minimal implementation**

```python
def cmd_install(app: str, serial: str = ""):
    device = resolve_install_target_serial(serial)
    if not device:
        raise RuntimeError("No running emulator found")
    unified_test(..., install-only mode)
```

Install source is latest/pinned build output for the app.

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_install_command.py -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/tests/test_install_command.py
git commit -m "feat(orch): add install command for running or specified emulator"
```

### Task 8: Add app-scoped `test` command behavior

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py`
- Create: `src/pipeline/orch/tests/test_app_test_command.py`

**Step 1: Write the failing test**

```python
def test_app_test_validates_launch_logs_and_unexpected_screen(monkeypatch):
    # orch test phonepe
    # assert expected log tags and activity checks are invoked
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_app_test_command.py::test_app_test_validates_launch_logs_and_unexpected_screen -q`
Expected: FAIL.

**Step 3: Write minimal implementation**

```python
def cmd_test(app: str, serial: str = "", smoke: bool = False):
    profile_test(...)
```

Add app-level wrappers for log-tag and unexpected-activity detection policy.

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_app_test_command.py -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/tests/test_app_test_command.py
git commit -m "feat(orch): add app-scoped test command"
```

### Task 9: Add Yarn top-level shortcuts for all orch subcommands

**Files:**
- Modify: `package.json`
- Create: `src/pipeline/orch/tests/test_package_scripts_contract.py`

**Step 1: Write the failing test**

```python
def test_package_scripts_expose_orch_shortcuts():
    # assert scripts: collect, info, decompiled, build, install, test, ...
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_package_scripts_contract.py -q`
Expected: FAIL (missing shortcuts).

**Step 3: Write minimal implementation**

```json
{
  "scripts": {
    "collect": "yarn orch collect",
    "info": "yarn orch info",
    "decompiled": "yarn orch decompiled",
    "build": "yarn orch build",
    "install": "yarn orch install"
  }
}
```

Keep existing scripts temporarily for compatibility.

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_package_scripts_contract.py -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add package.json src/pipeline/orch/tests/test_package_scripts_contract.py
git commit -m "chore(scripts): add yarn shortcuts for orch subcommands"
```

### Task 10: Update orchestrator design/usage docs

**Files:**
- Modify: `docs/orch_standardization_design.md`
- Modify: `src/pipeline/orch/README.md`
- Modify: `docs/编排统一规范.md`
- Test: `src/pipeline/orch/tests/test_validation_doc_links.py`

**Step 1: Write the failing docs test**

```python
def test_docs_reference_standardized_commands_and_multi_app_collect():
    # assert docs mention: yarn collect, yarn collect phonepe, orch info, orch decompiled phonepe 26022705
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_validation_doc_links.py -q`
Expected: FAIL until docs are updated.

**Step 3: Write minimal documentation updates**

- Add command matrix and examples.
- Document serial collect ordering rule across emulators and apps.
- Document app registry extension steps (`paytm` then more apps).

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_validation_doc_links.py -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add docs/orch_standardization_design.md src/pipeline/orch/README.md docs/编排统一规范.md src/pipeline/orch/tests/test_validation_doc_links.py
git commit -m "docs(orch): standardize multi-app command design and usage"
```

### Task 11: End-to-end verification matrix

**Files:**
- Verify only: `src/pipeline/orch/orchestrator.py`, `package.json`, `cache/*` outputs

**Step 1: Run full orch test suite**

Run: `python3 -m pytest src/pipeline/orch/tests -q`
Expected: PASS.

**Step 2: Verify default help**

Run: `yarn orch`
Expected: exit `0`, prints subcommands + examples + supported apps.

**Step 3: Verify collect/info/decompiled/build/install/test command paths**

Run:

```bash
yarn collect phonepe
yarn info
yarn decompiled phonepe
yarn decompiled phonepe 26022705
yarn build phonepe
yarn install phonepe --serial emulator-5554
yarn test phonepe --serial emulator-5554
```

Expected: all command routes execute expected handlers; failures only when environment missing (e.g., no emulator online).

**Step 4: Verify multi-app collect ordering**

Run: `yarn collect`
Expected: per emulator, collection order is `phonepe -> paytm`, then move to next emulator and repeat.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(orch): standardize multi-app CLI workflows and shortcuts"
```
