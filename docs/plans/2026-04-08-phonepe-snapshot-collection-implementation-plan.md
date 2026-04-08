# PhonePe Snapshot Collection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a serial, matrix-driven PhonePe snapshot collector that auto-upgrades on bootstrap device, anchors version/signing, archives APK artifacts by stable key, and produces resumable gap/blocker reports.

**Architecture:** Extend `orchestrator.py` with a new `collect` action that reads `device_matrix.json`, runs a single-device-at-a-time pipeline, and writes run/snapshot artifacts under `cache/phonepe/snapshots`. Use bootstrap-first anchor discovery, then enforce strict package/version/signing consistency for all targets. Persist run state and structured reports to support `--resume` after manual Play login intervention.

**Tech Stack:** Python 3 (`argparse`, `json`, `pathlib`, `subprocess`, `datetime`), existing orchestrator helpers, adb/apksigner/aapt runtime tools, Yarn script aliasing.

---

### Task 0: Prepare arm64-v8a multi-density emulator baseline

**Files:**
- Modify: `src/pipeline/orch/emulators.json` (if needed)
- Modify: `src/pipeline/orch/device_matrix.example.json`
- Test: runtime verification via `yarn device`

### Task 0.0: Emulator incident postmortem and hard requirements (must follow)

**Root cause of the previous mistake (why Home/Back/keyboard failed):**
- We treated collection emulators as headless/research-style instances, but the collection flow needs interactive control for login/recovery.
- Headless launch patterns (`-no-window`) and incomplete AVD interaction checks caused us to miss UI controllability gates.
- We did not enforce a preflight checklist for navigation keys, text input, and public network reachability before accepting new AVDs.

**Mandatory creation requirements for future collection emulators:**
1. Android system image must be API 35 (`android-35`) only, because this line is the current stable baseline.
2. Use Google Play-capable arm64 image for collection/login paths:
   - `system-images;android-35;google_apis_playstore;arm64-v8a`
3. AVD for collection must be **windowed** (do not use `-no-window` for these two collection devices).
4. Soft keyboard must be usable:
   - Ensure `show_ime_with_hard_keyboard=1` after boot.
   - Keep AVD config consistent to avoid hiding software IME by default.
5. Navigation controls must be verifiable:
   - Must pass both emulator UI navigation (Home/Back) and adb keyevent checks.
6. Public internet must be verifiable:
   - Device must resolve DNS and reach external HTTPS endpoint before use.

**Required preflight gate (both AVDs must pass):**
```bash
adb -s <serial> shell getprop ro.build.version.sdk                # expect 35
adb -s <serial> shell settings put secure show_ime_with_hard_keyboard 1
adb -s <serial> shell input keyevent KEYCODE_HOME
adb -s <serial> shell input keyevent KEYCODE_BACK
adb -s <serial> shell input text phonepe123
adb -s <serial> shell 'cmd connectivity airplane-mode disable'    # ensure not in airplane mode
adb -s <serial> shell ping -c 1 8.8.8.8
adb -s <serial> shell 'toybox nc -z -w 3 www.google.com 443'
```

If any check fails, emulator is rejected and must be recreated; do not proceed to matrix collection.

**Step 1: Define current achievable arm64-v8a density targets**

- Confirm the target density set supported by current host resources (for example `xhdpi`, `xxhdpi`, `xxxhdpi`).
- Add matching target entries in `device_matrix.example.json` with stable `target_id` and `serial_alias`.

**Step 2: Prepare emulator instances serially**

Run (example, one emulator at a time, windowed):

```bash
emulator -avd <name_xhdpi> -no-snapshot-load
adb -s <serial_xhdpi> wait-for-device
adb -s <serial_xhdpi> shell settings put secure show_ime_with_hard_keyboard 1
adb -s <serial_xhdpi> shell wm density 320
adb -s <serial_xhdpi> reboot
```

Repeat for each density target; never keep multiple emulator instances running in parallel.

**Step 3: Verify ABI and density per target**

Run per target:

```bash
yarn orch device --serial <serial>
```

Expected:
- `split_abi: arm64_v8a`
- `split_density` matches target density bucket

**Step 4: Persist mapping into matrix/emulator config**

- Ensure each prepared emulator has deterministic mapping in matrix/config.
- Keep `bootstrap_target_id` pointing to one stable arm64 target.

**Step 5: Commit**

```bash
git add src/pipeline/orch/emulators.json src/pipeline/orch/device_matrix.example.json
git commit -m "chore(orch): prepare arm64 emulator density baseline for collection"
```

### Task 1: Add matrix config model and CLI contract

**Files:**
- Create: `src/pipeline/orch/device_matrix.example.json`
- Modify: `src/pipeline/orch/orchestrator.py`
- Test: `src/pipeline/orch/tests/test_cli_contract.py`

**Step 1: Write the failing test**

```python
def test_collect_command_accepts_matrix_and_resume_args():
    parser = cache_manager.build_parser_for_test()
    args = parser.parse_args(["collect", "--matrix", "a.json", "--resume", "run_1"])
    assert args.action == "collect"
    assert args.matrix == "a.json"
    assert args.resume == "run_1"
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_cli_contract.py::test_collect_command_accepts_matrix_and_resume_args -q`
Expected: FAIL (missing `collect` args)

**Step 3: Write minimal implementation**

- Add `collect` action parser in `orchestrator.py`.
- Add args: `--matrix`, `--package`, `--resume`.
- Add matrix loader + schema validation (`bootstrap_target_id`, `targets[]`, required fields).

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_cli_contract.py::test_collect_command_accepts_matrix_and_resume_args -q`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/tests/test_cli_contract.py src/pipeline/orch/device_matrix.example.json
git commit -m "feat(orch): add collect cli and matrix schema"
```

### Task 2: Implement run directory, state machine, and resume support

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py`
- Test: `src/pipeline/orch/tests/test_reuse_artifacts.py` (or new `test_collect_run_state.py`)

**Step 1: Write the failing test**

```python
def test_collect_resume_skips_completed_targets(tmp_path):
    run_state = {
        "run_id": "r1",
        "status": "running",
        "completed_targets": ["emu_arm64_xxhdpi"],
        "failed_targets": [],
        "blocked_reason": None,
    }
    # arrange state on disk + matrix with 2 targets
    # assert only remaining target is executed
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_collect_run_state.py::test_collect_resume_skips_completed_targets -q`
Expected: FAIL (resume unsupported)

**Step 3: Write minimal implementation**

- Create helpers to initialize/read/write `cache/phonepe/snapshots/runs/<run_id>/run_state.json`.
- Implement target status transitions: `pending -> ... -> done/failed/blocked`.
- Implement `--resume` to continue from first incomplete target.

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_collect_run_state.py -q`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/tests/test_collect_run_state.py
git commit -m "feat(orch): add collect run-state and resume flow"
```

### Task 3: Add bootstrap anchor discovery and strict consistency checks

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py`
- Test: `src/pipeline/orch/tests/test_split_session_verifier.py` and new `test_collect_anchor.py`

**Step 1: Write the failing test**

```python
def test_collect_bootstrap_sets_version_anchor_from_first_upgraded_target():
    # mock bootstrap collection returns base metadata
    anchor = cache_manager.collect_bootstrap_anchor(...)
    assert anchor["packageName"] == "com.phonepe.app"
    assert anchor["versionCode"] == "26040100"
    assert anchor["signingDigest"] == "abc123"
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_collect_anchor.py::test_collect_bootstrap_sets_version_anchor_from_first_upgraded_target -q`
Expected: FAIL

**Step 3: Write minimal implementation**

- Implement bootstrap-first install/upgrade flow.
- Parse `package/versionCode/signingDigest` from pulled APK artifacts.
- Store `version_anchor` in `run_state.json`.
- Enforce anchor match for all non-bootstrap targets.

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_collect_anchor.py -q`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/tests/test_collect_anchor.py
git commit -m "feat(orch): add bootstrap version anchor and consistency gate"
```

### Task 4: Implement serial collection + archive layout + checksums

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py`
- Test: `src/pipeline/orch/tests/test_split_session_install_mode.py` and new `test_collect_archive.py`

**Step 1: Write the failing test**

```python
def test_collect_archives_target_artifacts_under_snapshot_key(tmp_path):
    # run collector with mocked pull outputs
    snapshot_dir = tmp_path / "cache/phonepe/snapshots/com.phonepe.app/26040100/abc123"
    assert (snapshot_dir / "captures/emu_arm64_xxhdpi/base.apk").exists()
    assert (snapshot_dir / "captures/emu_arm64_xxhdpi/capture_meta.json").exists()
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_collect_archive.py::test_collect_archives_target_artifacts_under_snapshot_key -q`
Expected: FAIL

**Step 3: Write minimal implementation**

- Build archive path: `cache/phonepe/snapshots/<package>/<versionCode>/<digest>/captures/<target_id>/`.
- Copy only `base.apk`, ABI split, density split.
- Write `device_meta.json` and `capture_meta.json` with sha256 + source path mapping.
- Keep execution strictly serial.

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_collect_archive.py -q`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/tests/test_collect_archive.py
git commit -m "feat(orch): archive collected snapshots by stable key"
```

### Task 5: Add Play-login blocker detection and exit code contract

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py`
- Test: `src/pipeline/orch/tests/test_collect_blocker.py`

**Step 1: Write the failing test**

```python
def test_collect_exits_20_and_writes_blocker_report_when_play_not_logged_in(tmp_path):
    # mock play gate returns blocked
    code = cache_manager.run_collect(...)
    assert code == 20
    assert (tmp_path / "blocker-report.json").exists()
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_collect_blocker.py::test_collect_exits_20_and_writes_blocker_report_when_play_not_logged_in -q`
Expected: FAIL

**Step 3: Write minimal implementation**

- Add `detect_play_login_blocker(...)` hook.
- On blocker: write `blocker-report.json/.md`, set run status `blocked`, return code `20`.
- Ensure no downstream target runs after blocker.

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_collect_blocker.py -q`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/tests/test_collect_blocker.py
git commit -m "feat(orch): add play-login blocker handling and exit code 20"
```

### Task 6: Generate gap/summary reports and global snapshot index

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py`
- Test: `src/pipeline/orch/tests/test_collect_reports.py`

**Step 1: Write the failing test**

```python
def test_collect_writes_gap_and_summary_reports(tmp_path):
    # matrix has 3 targets; only 2 succeed
    assert (tmp_path / "gap-report.json").exists()
    assert (tmp_path / "summary.json").exists()
    data = json.loads((tmp_path / "gap-report.json").read_text())
    assert len(data["missing"]) == 1
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_collect_reports.py::test_collect_writes_gap_and_summary_reports -q`
Expected: FAIL

**Step 3: Write minimal implementation**

- Build matrix coverage map from `targets` vs archive index.
- Write `gap-report.json/.md`, `summary.json/.md` in run dir.
- Update global `cache/phonepe/snapshots/index.json`.

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_collect_reports.py -q`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/tests/test_collect_reports.py
git commit -m "feat(orch): add gap summary reports and global index"
```

### Task 7: Add package script alias and operator docs

**Files:**
- Modify: `package.json`
- Create: `docs/phonepe_snapshot_collection.md`
- Modify: `src/pipeline/orch/README.md`

**Step 1: Write the failing test/check**

```bash
rg -n "collect:phonepe|collect --matrix" package.json src/pipeline/orch/README.md docs/phonepe_snapshot_collection.md -S
```

Expected before change: no match or incomplete docs

**Step 2: Implement minimal docs and command alias**

- Add `collect:phonepe` script.
- Document matrix format, collect/resume commands, blocker recovery workflow.
- Document forbidden `apk --fresh` in collection workflow note.

**Step 3: Run verification check**

Run: `rg -n "collect:phonepe|collect --matrix|--resume|blocked" package.json src/pipeline/orch/README.md docs/phonepe_snapshot_collection.md -S`
Expected: all required references found

**Step 4: Commit**

```bash
git add package.json src/pipeline/orch/README.md docs/phonepe_snapshot_collection.md
git commit -m "docs(flow): add phonepe snapshot collection runbook and yarn alias"
```

### Task 8: Full verification and release gate

**Files:**
- Modify if needed: `src/pipeline/orch/tests/*`
- Optional docs update: `docs/verification/*`

**Step 1: Run targeted tests**

Run:

```bash
python3 -m pytest src/pipeline/orch/tests/test_cli_contract.py -q
python3 -m pytest src/pipeline/orch/tests/test_collect_run_state.py -q
python3 -m pytest src/pipeline/orch/tests/test_collect_anchor.py -q
python3 -m pytest src/pipeline/orch/tests/test_collect_archive.py -q
python3 -m pytest src/pipeline/orch/tests/test_collect_blocker.py -q
python3 -m pytest src/pipeline/orch/tests/test_collect_reports.py -q
```

Expected: PASS

**Step 2: Run baseline orchestrator checks**

Run:

```bash
python3 -m unittest discover -s src/pipeline/orch/tests -p 'test_*.py' -v
python3 src/pipeline/orch/orchestrator.py plan
```

Expected: no regression, profile planning still works

**Step 3: Manual dry run (no fresh)**

Run:

```bash
yarn collect:phonepe
```

Expected:
- serial processing of targets
- bootstrap anchor generated
- reports written under `cache/phonepe/snapshots/runs/<run_id>/`
- on Play login blocker: exit code `20`, blocker report present

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(orch): implement serial phonepe snapshot collection workflow"
```

## Notes

1. Keep all tasks DRY/YAGNI; avoid adding parallel scheduler or non-matrix auto-discovery.
2. Preserve existing orchestrator behavior for `plan/prepare/smali/merge/apk/test`.
3. Never introduce `apk --fresh` into the collection path.
4. Keep commits small and frequent as listed above.
