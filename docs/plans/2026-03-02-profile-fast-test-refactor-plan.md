# Profile Fast-Test Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement Scheme A fully (`baseline + independent module workspaces + profile composition`) and replace slow legacy cache-chained test flow with fast, independent test scripts.

**Architecture:** Keep a single baseline decompiled cache as immutable input, then build independent per-module workspaces and profile-composed workspaces from that baseline. Make `profile` commands the primary path, keep legacy module commands as compatibility wrappers, and add a new two-tier test pipeline (`smoke` fast checks vs `full` integration checks). Conflict detection remains explicit at compose time via reset-path rules.

**Tech Stack:** Python 3 (`src/cache-manager`), Bash (`src/pipeline/tools`, module scripts), adb/apktool/apksigner, unittest.

---

### Task 1: Lock New Command Contract and Deprecate Legacy Heavy Path

**Files:**
- Modify: `src/cache-manager/cache_manager.py`
- Modify: `src/cache-manager/README.md`
- Modify: `src/README.md`
- Test: `src/cache-manager/tests/test_cli_backcompat.py`

**Step 1: Write the failing test**

```python
# src/cache-manager/tests/test_cli_backcompat.py

def test_profile_is_primary_documented_contract():
    parser = cache_manager.build_parser()
    args = parser.parse_args(["profile", "full", "plan"])
    assert args.cmd == "profile"
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/cache-manager/tests/test_cli_backcompat.py -v`
Expected: FAIL if parser/dispatch behavior is not aligned to new contract.

**Step 3: Write minimal implementation**

```python
# cache_manager.py
# Keep legacy aliases but route through thin wrapper only.
# Ensure profile command paths are first-class and validated.
```

```markdown
# README docs
# Explicitly mark legacy commands as compatibility-only.
```

**Step 4: Run test to verify it passes**

Run:
- `python3 -m unittest src/cache-manager/tests/test_cli_backcompat.py -v`
- `python3 src/cache-manager/cache_manager.py profile full plan`
Expected: PASS + valid module JSON output.

**Step 5: Commit**

```bash
git add src/cache-manager/cache_manager.py src/cache-manager/README.md src/README.md src/cache-manager/tests/test_cli_backcompat.py
git commit -m "refactor: make profile pipeline primary and keep legacy as compatibility wrapper"
```

---

### Task 2: Remove Legacy Cache-Chain Assumptions from Build Source Resolution

**Files:**
- Modify: `src/cache-manager/cache_manifest.json`
- Modify: `src/cache-manager/cache_manager.py`
- Test: `src/cache-manager/tests/test_manifest_decoupling.py`

**Step 1: Write the failing test**

```python
# src/cache-manager/tests/test_manifest_decoupling.py

def test_all_injection_modules_source_from_baseline_subdir():
    data = json.loads(Path("src/cache-manager/cache_manifest.json").read_text())
    for name in ["phonepe_sigbypass", "phonepe_https_interceptor", "phonepe_phonepehelper"]:
        assert data[name]["source_cache"] == "phonepe_decompiled"
        assert data[name]["source_subdir"] == "base_decompiled_clean"
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/cache-manager/tests/test_manifest_decoupling.py -v`
Expected: FAIL if any module still relies on chained module cache source.

**Step 3: Write minimal implementation**

```json
// cache_manifest.json
// keep only baseline source for all module injection stages
```

```python
# cache_manager.py
# source resolution must fail fast if source_cache/source_subdir is invalid
```

**Step 4: Run test to verify it passes**

Run:
- `python3 -m unittest src/cache-manager/tests/test_manifest_decoupling.py -v`
- `python3 src/cache-manager/cache_manager.py graph`
Expected: PASS + branch graph under `phonepe_decompiled`.

**Step 5: Commit**

```bash
git add src/cache-manager/cache_manifest.json src/cache-manager/cache_manager.py src/cache-manager/tests/test_manifest_decoupling.py
git commit -m "refactor: enforce baseline-only module source resolution"
```

---

### Task 3: Promote Compose Engine to Required Execution Path

**Files:**
- Modify: `src/cache-manager/compose_engine.py`
- Modify: `src/cache-manager/cache_manager.py`
- Test: `src/cache-manager/tests/test_compose_engine.py`

**Step 1: Write the failing test**

```python
# src/cache-manager/tests/test_compose_engine.py

def test_profile_pre_cache_requires_conflict_free_modules():
    mods = {
        "a": {"reset_paths": ["AndroidManifest.xml"]},
        "b": {"reset_paths": ["AndroidManifest.xml"]},
    }
    with self.assertRaises(ValueError):
        detect_conflicts(mods, ["a", "b"])
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/cache-manager/tests/test_compose_engine.py -v`
Expected: FAIL if compose conflict gate is bypassed.

**Step 3: Write minimal implementation**

```python
# compose_engine.py
# treat compose as mandatory for profile inject/compile/test
# keep strict reset_paths conflict detection
```

```python
# cache_manager.py
# profile actions always call compose preconditions
```

**Step 4: Run test to verify it passes**

Run:
- `python3 -m unittest src/cache-manager/tests/test_compose_engine.py -v`
- `python3 src/cache-manager/cache_manager.py profile full pre-cache`
Expected: unit tests pass; CLI either builds workspace or fails with clear baseline-missing error.

**Step 5: Commit**

```bash
git add src/cache-manager/compose_engine.py src/cache-manager/cache_manager.py src/cache-manager/tests/test_compose_engine.py
git commit -m "refactor: make compose engine mandatory for profile execution"
```

---

### Task 4: Add Fast Smoke Test Mode for Independent Module Validation

**Files:**
- Modify: `src/cache-manager/cache_manager.py`
- Create: `src/pipeline/tools/test_profile_smoke.sh`
- Create: `src/cache-manager/tests/test_smoke_mode.py`
- Modify: `package.json`
- Modify: `src/cache-manager/README.md`

**Step 1: Write the failing test**

```python
# src/cache-manager/tests/test_smoke_mode.py

def test_smoke_mode_skips_heavy_runtime_checks():
    args = build_parser().parse_args(["profile", "full", "test", "--smoke"])
    assert args.smoke is True
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/cache-manager/tests/test_smoke_mode.py -v`
Expected: FAIL until smoke flag and behavior exist.

**Step 3: Write minimal implementation**

```python
# cache_manager.py
# add --smoke flag for profile test
# smoke: shorter timeout, no uninstall, minimal tag checks
# full: existing strict checks
```

```bash
# src/pipeline/tools/test_profile_smoke.sh
python3 src/cache-manager/cache_manager.py profile "$1" test --smoke --serial "${2:-emulator-5554}"
```

```json
// package.json
"test:smoke:full": "bash src/pipeline/tools/test_profile_smoke.sh full"
```

**Step 4: Run test to verify it passes**

Run:
- `python3 -m unittest src/cache-manager/tests/test_smoke_mode.py -v`
- `python3 src/cache-manager/cache_manager.py profile full plan`
Expected: PASS + smoke flag accepted by parser.

**Step 5: Commit**

```bash
git add src/cache-manager/cache_manager.py src/pipeline/tools/test_profile_smoke.sh src/cache-manager/tests/test_smoke_mode.py package.json src/cache-manager/README.md
git commit -m "feat: add fast smoke mode for profile test loop"
```

---

### Task 5: Add Artifact Reuse Flags to Avoid Rebuilds in Daily Loop

**Files:**
- Modify: `src/cache-manager/cache_manager.py`
- Create: `src/cache-manager/tests/test_reuse_artifacts.py`
- Modify: `src/apk/https_interceptor/scripts/inject.sh`
- Modify: `src/apk/signature_bypass/scripts/inject.sh`

**Step 1: Write the failing test**

```python
# src/cache-manager/tests/test_reuse_artifacts.py

def test_reuse_artifacts_flag_is_exposed_for_profile_compile():
    args = build_parser().parse_args(["profile", "full", "compile", "--reuse-artifacts"])
    assert args.reuse_artifacts is True
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/cache-manager/tests/test_reuse_artifacts.py -v`
Expected: FAIL until flag and logic are implemented.

**Step 3: Write minimal implementation**

```python
# cache_manager.py
# --reuse-artifacts: if signed apk already exists and inputs unchanged, skip rebuild
```

```bash
# inject scripts
# add --skip-build path for https demo build and sigbypass compile fallback
```

**Step 4: Run test to verify it passes**

Run:
- `python3 -m unittest src/cache-manager/tests/test_reuse_artifacts.py -v`
- `python3 src/cache-manager/cache_manager.py profile full compile --reuse-artifacts`
Expected: unit test pass; command accepted and logs whether cache hit/miss.

**Step 5: Commit**

```bash
git add src/cache-manager/cache_manager.py src/cache-manager/tests/test_reuse_artifacts.py src/apk/https_interceptor/scripts/inject.sh src/apk/signature_bypass/scripts/inject.sh
git commit -m "perf: add artifact reuse and skip-build controls"
```

---

### Task 6: Replace Legacy Slow Test Scripts with New Profile-Oriented Test Suite

**Files:**
- Create: `src/pipeline/tools/test_profile_full.sh`
- Create: `src/pipeline/tools/test_module_independent.sh`
- Modify: `package.json`
- Modify: `src/pipeline/tools/README.md`
- Create: `src/cache-manager/tests/test_new_test_scripts_contract.py`

**Step 1: Write the failing test**

```python
# src/cache-manager/tests/test_new_test_scripts_contract.py

def test_new_fast_test_scripts_exist_and_executable():
    for p in [
        Path("src/pipeline/tools/test_profile_full.sh"),
        Path("src/pipeline/tools/test_module_independent.sh"),
    ]:
        assert p.exists()
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/cache-manager/tests/test_new_test_scripts_contract.py -v`
Expected: FAIL until scripts exist.

**Step 3: Write minimal implementation**

```bash
# test_profile_full.sh
python3 src/cache-manager/cache_manager.py profile full test --serial "${1:-emulator-5554}"
```

```bash
# test_module_independent.sh
python3 src/cache-manager/cache_manager.py profile sigbypass-only test --smoke --serial "${1:-emulator-5554}"
python3 src/cache-manager/cache_manager.py profile https-only test --smoke --serial "${1:-emulator-5554}"
python3 src/cache-manager/cache_manager.py profile phonepehelper-only test --smoke --serial "${1:-emulator-5554}"
```

```json
// package.json
"test:independent": "bash src/pipeline/tools/test_module_independent.sh",
"test:full": "bash src/pipeline/tools/test_profile_full.sh"
```

**Step 4: Run test to verify it passes**

Run:
- `python3 -m unittest src/cache-manager/tests/test_new_test_scripts_contract.py -v`
- `bash -n src/pipeline/tools/test_profile_full.sh`
- `bash -n src/pipeline/tools/test_module_independent.sh`
Expected: PASS and syntax OK.

**Step 5: Commit**

```bash
git add src/pipeline/tools/test_profile_full.sh src/pipeline/tools/test_module_independent.sh package.json src/pipeline/tools/README.md src/cache-manager/tests/test_new_test_scripts_contract.py
git commit -m "test: introduce profile-based fast independent and full test scripts"
```

---

### Task 7: End-to-End Validation Matrix and Evidence Automation

**Files:**
- Modify: `docs/plans/2026-03-02-profile-based-build-refactor-validation.md`
- Create: `src/pipeline/tools/collect_validation_evidence.sh`
- Create: `src/cache-manager/tests/test_validation_doc_links.py`

**Step 1: Write the failing test**

```python
# src/cache-manager/tests/test_validation_doc_links.py

def test_validation_doc_references_new_test_commands():
    text = Path("docs/plans/2026-03-02-profile-based-build-refactor-validation.md").read_text()
    assert "test:independent" in text
    assert "test:full" in text
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/cache-manager/tests/test_validation_doc_links.py -v`
Expected: FAIL until doc references are updated.

**Step 3: Write minimal implementation**

```bash
# collect_validation_evidence.sh
# collect unit outputs, command logs, sha256, probe compare outputs into artifacts/runs/<timestamp>/
```

```markdown
# validation doc
# include quick path (smoke independent) and release path (full)
```

**Step 4: Run test to verify it passes**

Run:
- `python3 -m unittest src/cache-manager/tests/test_validation_doc_links.py -v`
- `bash -n src/pipeline/tools/collect_validation_evidence.sh`
Expected: PASS and script syntax valid.

**Step 5: Commit**

```bash
git add docs/plans/2026-03-02-profile-based-build-refactor-validation.md src/pipeline/tools/collect_validation_evidence.sh src/cache-manager/tests/test_validation_doc_links.py
git commit -m "docs: add final validation matrix and evidence automation"
```

---

## Final Verification Checklist (Before Merge)

1. Unit tests:
- `python3 -m unittest discover -s src/cache-manager/tests -p 'test_*.py' -v`

2. Fast independent module checks (adb required):
- `yarn test:independent`

3. Full profile integration (adb required):
- `yarn test:full`

4. Behavior parity workflow:
- `yarn baseline:archive --apk /path/to/baseline.apk`
- `BASELINE_RUN_DIR=<baseline_run_dir> yarn probe:baseline -- --package com.phonepe.app`
- `yarn artifact:archive -- --apk /path/to/candidate.apk --label candidate`
- `CANDIDATE_RUN_DIR=<candidate_run_dir> yarn probe:candidate -- --package com.phonepe.app`
- `yarn probe:compare --baseline <baseline_run_dir> --candidate <candidate_run_dir>`

5. Evidence bundle:
- `bash src/pipeline/tools/collect_validation_evidence.sh`

## Definition of Done

- Legacy cache chain is no longer required for day-to-day module testing.
- Profile pipeline is primary, legacy commands are compatibility wrappers only.
- Independent module smoke tests and full profile tests are both available and documented.
- Compose conflict rules are enforced and test-covered.
- Behavior parity artifacts are reproducible and retained.
