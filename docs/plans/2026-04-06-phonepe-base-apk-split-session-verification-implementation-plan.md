# PhonePe Base APK Split-Session Verification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a verifiable pre-integration workflow that proves `base.apk + required splits` can be installed in one session on a fresh device and launched successfully, then integrate the same flow into orchestrator after validation passes.

**Architecture:** Implement in two phases. Phase A adds an external verifier script and report flow without touching orchestrator behavior. Phase B ports the verified logic into `src/pipeline/orch/orchestrator.py` and updates `yarn test` path to use split-session install strategy by default. The same split selection and launch checks are shared to avoid behavior drift.

**Tech Stack:** Python 3, ADB, existing orchestrator utilities in `src/pipeline/orch/orchestrator.py`, Markdown docs under `docs/verification` and `docs/plans`.

---

### Task 1: Add external verification script skeleton (Phase A)

**Files:**
- Create: `scripts/verify_phonepe_split_session_install.py`
- Create: `docs/verification/2026-04-06-base-apk-split-session-validation.md`

**Step 1: Write the failing smoke test for CLI argument parsing**

```python
# src/pipeline/orch/tests/test_split_session_verifier.py
import subprocess

def test_verifier_requires_base_apk(tmp_path):
    cmd = [
        "python3",
        "scripts/verify_phonepe_split_session_install.py",
        "--base-apk", str(tmp_path / "missing-base.apk"),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    assert proc.returncode != 0
    assert "base apk not found" in (proc.stdout + proc.stderr).lower()
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_split_session_verifier.py::test_verifier_requires_base_apk -q`
Expected: FAIL because verifier script does not exist.

**Step 3: Write minimal verifier CLI skeleton**

```python
# scripts/verify_phonepe_split_session_install.py
import argparse
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--base-apk", required=True)
args = parser.parse_args()
if not Path(args.base_apk).exists():
    raise SystemExit("base apk not found")
print("TODO")
```

**Step 4: Re-run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_split_session_verifier.py::test_verifier_requires_base_apk -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/verify_phonepe_split_session_install.py src/pipeline/orch/tests/test_split_session_verifier.py docs/verification/2026-04-06-base-apk-split-session-validation.md
git commit -m "feat(verify): add split-session verifier skeleton"
```

### Task 2: Implement dynamic split selection in verifier

**Files:**
- Modify: `scripts/verify_phonepe_split_session_install.py`
- Modify: `src/pipeline/orch/tests/test_split_session_verifier.py`

**Step 1: Write failing tests for ABI/density selection**

```python
def test_select_required_splits_prefers_supported_abi_order(tmp_path):
    # input files include split_config.arm64_v8a.apk + split_config.armeabi_v7a.apk
    # device abi order: ["armeabi-v7a", "arm64-v8a"]
    # expect selected abi split is split_config.armeabi_v7a.apk
    ...

def test_select_required_density_split_exact_match(tmp_path):
    # density xxhdpi should match split_config.xxhdpi.apk
    ...
```

**Step 2: Run tests to verify they fail**

Run: `python3 -m pytest src/pipeline/orch/tests/test_split_session_verifier.py -q`
Expected: FAIL due to missing selection logic.

**Step 3: Implement minimal split selection functions**

```python
def select_abi_split(files, supported_abis):
    ...

def select_density_split(files, density_bucket):
    ...
```

**Step 4: Re-run tests to verify they pass**

Run: `python3 -m pytest src/pipeline/orch/tests/test_split_session_verifier.py -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/verify_phonepe_split_session_install.py src/pipeline/orch/tests/test_split_session_verifier.py
git commit -m "feat(verify): add dynamic split selection for abi and density"
```

### Task 3: Implement one-session install and launch validation in verifier

**Files:**
- Modify: `scripts/verify_phonepe_split_session_install.py`
- Modify: `src/pipeline/orch/tests/test_split_session_verifier.py`

**Step 1: Write failing tests for install command and failure mapping**

```python
def test_install_multiple_uses_three_apks_in_single_call(monkeypatch, tmp_path):
    # expect adb install-multiple --no-incremental base abi density
    ...

def test_install_failure_maps_to_install_multiple_failed(monkeypatch):
    # adb returns Failure[...] -> INSTALL_MULTIPLE_FAILED
    ...
```

**Step 2: Run tests to verify they fail**

Run: `python3 -m pytest src/pipeline/orch/tests/test_split_session_verifier.py -q`
Expected: FAIL.

**Step 3: Implement install and launch checks**

```python
def install_multiple(adb, serial, apks):
    ...

def verify_launch(adb, serial, package, activity, timeout_sec):
    ...
```

**Step 4: Re-run tests to verify they pass**

Run: `python3 -m pytest src/pipeline/orch/tests/test_split_session_verifier.py -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/verify_phonepe_split_session_install.py src/pipeline/orch/tests/test_split_session_verifier.py
git commit -m "feat(verify): add split-session install and first-launch validation"
```

### Task 4: Execute Phase A validation on emulator and publish report

**Files:**
- Modify: `docs/verification/2026-04-06-base-apk-split-session-validation.md`

**Step 1: Write report template with required sections**

```md
## Device Info
## Selected Artifacts
## Fresh Install Result
## Replay Result
## Negative Case Result
## Conclusion
```

**Step 2: Run fresh install validation (main gate)**

Run:
`python3 scripts/verify_phonepe_split_session_install.py --serial emulator-5554 --base-apk cache/phonepe/from_device/base.apk --splits-dir cache/phonepe/from_device --target-apk cache/profiles/full/build/patched_signed.apk --package com.phonepe.app --activity com.phonepe.app/com.phonepe.app.ui.activity.SplashScreenActivity`
Expected: PASS with install + first launch success.

**Step 3: Run replay stability (twice)**

Run command twice with same arguments.
Expected: PASS both runs.

**Step 4: Run negative case (missing required split)**

Run with one split intentionally removed or alternate temp directory.
Expected: FAIL with `SELECT_SPLIT_FAILED` or `INSTALL_MULTIPLE_FAILED` and clear diagnostics.

**Step 5: Commit**

```bash
git add docs/verification/2026-04-06-base-apk-split-session-validation.md
git commit -m "docs(verification): record phase-a split-session install results"
```

### Task 5: Integrate verified flow into orchestrator (Phase B)

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py`
- Modify: `src/pipeline/orch/README.md`
- Modify: `src/pipeline/orch/tests/test_reuse_artifacts.py`
- Create: `src/pipeline/orch/tests/test_split_session_install_mode.py`

**Step 1: Write failing orchestrator tests for split-session install mode**

```python
def test_unified_test_uses_install_multiple_when_mode_split_session(...):
    ...

def test_split_session_mode_requires_base_and_selected_splits(...):
    ...
```

**Step 2: Run tests to verify failure**

Run: `python3 -m pytest src/pipeline/orch/tests/test_split_session_install_mode.py -q`
Expected: FAIL because mode does not exist.

**Step 3: Implement orchestrator support**

```python
# in unified_test(...)
# add mode: split-session
# resolve base + selected split apks
# run adb install-multiple --no-incremental in one transaction
```

**Step 4: Re-run targeted tests**

Run:
- `python3 -m pytest src/pipeline/orch/tests/test_split_session_install_mode.py -q`
- `python3 -m pytest src/pipeline/orch/tests/test_reuse_artifacts.py -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/README.md src/pipeline/orch/tests/test_split_session_install_mode.py src/pipeline/orch/tests/test_reuse_artifacts.py
git commit -m "feat(orch): add split-session install strategy for phonepe"
```

### Task 6: End-to-end verification through orchestrator test entry

**Files:**
- Modify: `docs/verification/2026-04-06-base-apk-split-session-validation.md`

**Step 1: Run orchestrator smoke test with split-session mode**

Run: `python3 src/pipeline/orch/orchestrator.py test --smoke --serial emulator-5554 --install-mode clean`
Expected: PASS and logs indicate split-session install path.

**Step 2: Run full test once**

Run: `python3 src/pipeline/orch/orchestrator.py test --serial emulator-5554 --install-mode clean`
Expected: PASS.

**Step 3: Capture command outputs and artifact paths in report**

```md
- install command summary
- selected splits
- launch validation evidence
```

**Step 4: Confirm no `--fresh` usage in workflow**

Run: `rg -n "apk --fresh|yarn orch apk --fresh" docs src/pipeline/orch -S`
Expected: no new required `--fresh` steps introduced.

**Step 5: Commit**

```bash
git add docs/verification/2026-04-06-base-apk-split-session-validation.md
git commit -m "docs(verification): add orchestrator e2e evidence for split-session install"
```
