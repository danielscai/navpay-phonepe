# Profile-Based Modular Build Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current linear layered build chain with a profile-based modular build flow that keeps module boundaries clear, supports independent module testing, and preserves behavior parity with the current APK pipeline.

**Architecture:** Keep `phonepe_decompiled/base_decompiled_clean` as the only shared baseline cache. Build each module in an isolated workspace from that baseline, then compose modules via explicit build profiles (`sigbypass-only`, `https-only`, `phonepehelper-only`, `full`) with deterministic apply order and conflict checks. Add strict quality gates: unit tests, emulator integration tests, and baseline-vs-new behavior comparison before acceptance.

**Tech Stack:** Python 3 (`src/cache-manager`), Bash scripts (`src/*/scripts`, `src/pipeline/tools`), adb/apktool/zipalign/apksigner, Android emulator.

---

## Core Milestone Gates (Must Pass Every Time)

### Gate A: Unit Gate (Required)
- All new/changed unit tests pass.
- Command: `python3 -m unittest discover -s src/cache-manager/tests -p 'test_*.py' -v`
- Acceptance: `OK` with `FAILED (failures=0, errors=0)` not present.

### Gate B: Module Integration Gate (Required)
- Each module profile installs and starts on emulator independently.
- Commands:
  - `yarn sigbypass --serial emulator-5554`
  - `yarn https --serial emulator-5554`
  - `yarn pehelp --serial emulator-5554`
- Acceptance: each run reaches cache-manager `TEST RESULT: SUCCESS` and no crash log is emitted.

### Gate C: Full Stack Integration Gate (Required)
- Combined profile (`full`) compiles, installs, starts, and emits expected module tags.
- Command: `python3 src/cache-manager/cache_manager.py profile full test --serial emulator-5554`
- Acceptance: success status + expected tags detected (`SigBypass`, `HttpInterceptor`, `PPHelper`).

### Gate D: Behavior Parity Gate (Required)
- New flow behavior matches the preserved baseline APK behavior for selected probes.
- Required probes: app launch path, login activity reachability, interceptor tag emission, helper initialization tag emission, no crash in `logcat -b crash`.
- Acceptance: no probe regression; differences must be explained and approved.

### Gate E: Artifact Retention Gate (Required)
- Baseline and candidate APKs, hashes, and test evidence are archived for diff.
- Acceptance: both versions have metadata, SHA256, and test logs in artifact store.

---

### Task 1: Freeze Current Baseline and Evidence Harness

**Files:**
- Create: `artifacts/baseline/.gitkeep`
- Create: `artifacts/runs/.gitkeep`
- Create: `src/pipeline/tools/archive_apk.sh`
- Create: `src/pipeline/tools/behavior_probe.sh`
- Create: `src/pipeline/tools/compare_behavior.sh`
- Modify: `package.json`
- Test: `src/pipeline/tools/README.md`

**Step 1: Write the failing test**

```python
# src/cache-manager/tests/test_artifact_contract.py
import json
from pathlib import Path


def test_archive_contract_files_exist():
    run_dir = Path("artifacts/runs/sample")
    required = ["apk.sha256", "meta.json", "probe.log"]
    for name in required:
        assert (run_dir / name).exists(), f"missing {name}"
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/cache-manager/tests/test_artifact_contract.py -v`
Expected: FAIL because artifact scripts/outputs do not exist yet.

**Step 3: Write minimal implementation**

```bash
# archive_apk.sh (core behavior)
# 1) create timestamped run dir
# 2) copy APK
# 3) write sha256 + meta.json
# 4) append notes/baseline label
```

```bash
# behavior_probe.sh (core behavior)
# 1) install apk
# 2) start app activity
# 3) capture tags/crash buffer
# 4) emit structured probe.log
```

```bash
# compare_behavior.sh (core behavior)
# compare baseline probe vs candidate probe and fail on mismatch keys
```

**Step 4: Run test to verify it passes**

Run:
- `python3 -m unittest src/cache-manager/tests/test_artifact_contract.py -v`
- `bash src/pipeline/tools/archive_apk.sh --help`
- `bash src/pipeline/tools/behavior_probe.sh --help`
- `bash src/pipeline/tools/compare_behavior.sh --help`
Expected: PASS and scripts return usage help with code 0.

**Step 5: Commit**

```bash
git add artifacts src/pipeline/tools package.json src/cache-manager/tests/test_artifact_contract.py
git commit -m "build: add baseline artifact archive and behavior probe tooling"
```

**Milestone Checkpoint:** Gate A + Gate E must pass.

---

### Task 2: Add Profile Model to Cache Manager (No Runtime Switch Yet)

**Files:**
- Create: `src/cache-manager/cache_profiles.json`
- Create: `src/cache-manager/profile_resolver.py`
- Create: `src/cache-manager/tests/test_profile_resolver.py`
- Modify: `src/cache-manager/cache_manager.py`
- Modify: `src/cache-manager/README.md`

**Step 1: Write the failing test**

```python
# src/cache-manager/tests/test_profile_resolver.py
import unittest
from src.cache_manager.profile_resolver import resolve_profile


class TestProfileResolver(unittest.TestCase):
    def test_full_profile_order(self):
        steps = resolve_profile("full")
        self.assertEqual(steps, ["phonepe_sigbypass", "phonepe_https_interceptor", "phonepe_phonepehelper"])
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/cache-manager/tests/test_profile_resolver.py -v`
Expected: FAIL due to missing resolver/profile file.

**Step 3: Write minimal implementation**

```python
# profile_resolver.py
# load cache_profiles.json
# validate profile exists
# validate deterministic module order and no duplicates
# return module list
```

```json
// cache_profiles.json
{
  "sigbypass-only": ["phonepe_sigbypass"],
  "https-only": ["phonepe_https_interceptor"],
  "phonepehelper-only": ["phonepe_phonepehelper"],
  "full": ["phonepe_sigbypass", "phonepe_https_interceptor", "phonepe_phonepehelper"]
}
```

**Step 4: Run test to verify it passes**

Run:
- `python3 -m unittest src/cache-manager/tests/test_profile_resolver.py -v`
- `python3 src/cache-manager/cache_manager.py profile full plan`
Expected: PASS and deterministic printed plan.

**Step 5: Commit**

```bash
git add src/cache-manager/cache_profiles.json src/cache-manager/profile_resolver.py src/cache-manager/tests/test_profile_resolver.py src/cache-manager/cache_manager.py src/cache-manager/README.md
git commit -m "build: add profile model and resolver for modular pipeline"
```

**Milestone Checkpoint:** Gate A must pass.

---

### Task 3: Decouple Module Source from Layered Cache Chain

**Files:**
- Modify: `src/cache-manager/cache_manifest.json`
- Modify: `src/cache-manager/cache_manager.py`
- Create: `src/cache-manager/tests/test_manifest_decoupling.py`

**Step 1: Write the failing test**

```python
# src/cache-manager/tests/test_manifest_decoupling.py
import json
from pathlib import Path


def test_all_modules_source_from_decompiled():
    data = json.loads(Path("src/cache-manager/cache_manifest.json").read_text())
    assert data["phonepe_sigbypass"]["deps"] == ["phonepe_decompiled"]
    assert data["phonepe_https_interceptor"]["deps"] == ["phonepe_decompiled"]
    assert data["phonepe_phonepehelper"]["deps"] == ["phonepe_decompiled"]
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/cache-manager/tests/test_manifest_decoupling.py -v`
Expected: FAIL because current deps are linear.

**Step 3: Write minimal implementation**

```json
// cache_manifest.json target dependency shape
"phonepe_sigbypass": { "deps": ["phonepe_decompiled"], ... }
"phonepe_https_interceptor": { "deps": ["phonepe_decompiled"], ... }
"phonepe_phonepehelper": { "deps": ["phonepe_decompiled"], ... }
```

```python
# cache_manager.py
# for module pre-cache, always source from decompiled baseline unless explicit profile composition stage
```

**Step 4: Run test to verify it passes**

Run:
- `python3 -m unittest src/cache-manager/tests/test_manifest_decoupling.py -v`
- `python3 src/cache-manager/cache_manager.py graph`
Expected: PASS and graph shows three module branches from `phonepe_decompiled`.

**Step 5: Commit**

```bash
git add src/cache-manager/cache_manifest.json src/cache-manager/cache_manager.py src/cache-manager/tests/test_manifest_decoupling.py
git commit -m "build: decouple module caches from linear chain"
```

**Milestone Checkpoint:** Gate A + Gate B (module independent runs) must pass.

---

### Task 4: Implement Profile Compose Pipeline with Conflict Detection

**Files:**
- Create: `src/cache-manager/compose_engine.py`
- Create: `src/cache-manager/tests/test_compose_engine.py`
- Modify: `src/cache-manager/cache_manager.py`
- Modify: `src/cache-manager/cache_manifest.json`

**Step 1: Write the failing test**

```python
# src/cache-manager/tests/test_compose_engine.py
import unittest
from src.cache_manager.compose_engine import detect_conflicts


class TestComposeEngine(unittest.TestCase):
    def test_conflict_on_same_reset_path(self):
        mods = {
            "m1": {"reset_paths": ["AndroidManifest.xml"]},
            "m2": {"reset_paths": ["AndroidManifest.xml"]},
        }
        with self.assertRaises(ValueError):
            detect_conflicts(mods, ["m1", "m2"])
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/cache-manager/tests/test_compose_engine.py -v`
Expected: FAIL due to missing compose engine.

**Step 3: Write minimal implementation**

```python
# compose_engine.py
# 1) compose profile to temp workspace from baseline
# 2) apply module inject in explicit order
# 3) detect path conflicts before apply
# 4) output composed workspace path + metadata
```

```python
# cache_manager.py
# add command: profile <name> [pre-cache|inject|compile|test]
# compile/test uses composed workspace not chained cache
```

**Step 4: Run test to verify it passes**

Run:
- `python3 -m unittest src/cache-manager/tests/test_compose_engine.py -v`
- `python3 src/cache-manager/cache_manager.py profile full pre-cache`
Expected: PASS and composed workspace generated with metadata.

**Step 5: Commit**

```bash
git add src/cache-manager/compose_engine.py src/cache-manager/tests/test_compose_engine.py src/cache-manager/cache_manager.py src/cache-manager/cache_manifest.json
git commit -m "build: add profile compose pipeline with conflict checks"
```

**Milestone Checkpoint:** Gate A + Gate B + Gate C must pass.

---

### Task 5: Align Module Entry Contract on Dispatcher (Remove Hidden Coupling)

**Files:**
- Modify: `src/apk/phonepehelper/scripts/merge.sh`
- Modify: `src/apk/signature_bypass/scripts/inject.sh`
- Modify: `src/pipeline/tools/lib/dispatcher.sh`
- Create: `src/cache-manager/tests/test_entry_contract.py`
- Modify: `docs/hook_runtime_architecture.md`

**Step 1: Write the failing test**

```python
# src/cache-manager/tests/test_entry_contract.py
from pathlib import Path


def test_phonepehelper_does_not_patch_hookentry_directly():
    text = Path("src/apk/phonepehelper/scripts/merge.sh").read_text()
    assert "com/sigbypass/HookEntry.smali" not in text
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/cache-manager/tests/test_entry_contract.py -v`
Expected: FAIL because current script patches `HookEntry`.

**Step 3: Write minimal implementation**

```bash
# merge.sh target behavior
# inject helper smali only
# register ModuleInit via dispatcher manifest/rendering path
# never edit HookEntry directly
```

```bash
# signature_bypass inject keeps runtime/bootstrap responsibility only
# module registration handled by dispatcher contract
```

**Step 4: Run test to verify it passes**

Run:
- `python3 -m unittest src/cache-manager/tests/test_entry_contract.py -v`
- `python3 src/cache-manager/cache_manager.py profile phonepehelper-only test --serial emulator-5554`
Expected: PASS and `PPHelper` tag present after startup.

**Step 5: Commit**

```bash
git add src/apk/phonepehelper/scripts/merge.sh src/apk/signature_bypass/scripts/inject.sh src/pipeline/tools/lib/dispatcher.sh src/cache-manager/tests/test_entry_contract.py docs/hook_runtime_architecture.md
git commit -m "refactor: enforce dispatcher-only module entry contract"
```

**Milestone Checkpoint:** Gate A + Gate B must pass.

---

### Task 6: Behavior Parity Workflow (Baseline vs Candidate)

**Files:**
- Create: `docs/verification/behavior-parity-checklist.md`
- Create: `artifacts/baseline/<timestamp>/README.md` (generated by script)
- Modify: `src/pipeline/tools/README.md`
- Modify: `package.json`

**Step 1: Write the failing test**

```python
# src/cache-manager/tests/test_behavior_parity_schema.py
import json
from pathlib import Path


def test_probe_schema_keys():
    data = json.loads(Path("artifacts/runs/sample/probe.json").read_text())
    for key in ["launch_ok", "login_activity_seen", "sigbypass_tag", "https_tag", "pphelper_tag", "crash_detected"]:
        assert key in data
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/cache-manager/tests/test_behavior_parity_schema.py -v`
Expected: FAIL because schema/output not yet implemented.

**Step 3: Write minimal implementation**

```bash
# package.json scripts
"baseline:archive": "bash src/pipeline/tools/archive_apk.sh --label baseline",
"probe:baseline": "bash src/pipeline/tools/behavior_probe.sh --input artifacts/baseline/latest/apk.apk --out artifacts/runs/baseline",
"probe:candidate": "bash src/pipeline/tools/behavior_probe.sh --input cache/profile_full_build/patched_signed.apk --out artifacts/runs/candidate",
"probe:compare": "bash src/pipeline/tools/compare_behavior.sh --base artifacts/runs/baseline --cand artifacts/runs/candidate"
```

```markdown
# behavior-parity-checklist.md
# defines mandatory probes, acceptable deltas, and fail criteria
```

**Step 4: Run test to verify it passes**

Run:
- `python3 -m unittest src/cache-manager/tests/test_behavior_parity_schema.py -v`
- `yarn baseline:archive`
- `yarn probe:baseline`
- `yarn probe:candidate`
- `yarn probe:compare`
Expected: PASS and compare exits 0.

**Step 5: Commit**

```bash
git add docs/verification/behavior-parity-checklist.md src/pipeline/tools/README.md package.json src/cache-manager/tests/test_behavior_parity_schema.py src/pipeline/tools/archive_apk.sh src/pipeline/tools/behavior_probe.sh src/pipeline/tools/compare_behavior.sh
git commit -m "test: add baseline-vs-candidate behavior parity workflow"
```

**Milestone Checkpoint:** Gate A + Gate D + Gate E must pass.

---

### Task 7: Final End-to-End Validation and Migration Sign-Off

**Files:**
- Modify: `src/cache-manager/README.md`
- Modify: `src/README.md`
- Create: `docs/plans/2026-03-02-profile-based-build-refactor-validation.md`

**Step 1: Write the failing test**

```python
# src/cache-manager/tests/test_cli_backcompat.py
import subprocess


def test_old_alias_commands_still_work():
    for cmd in [
        ["python3", "src/cache-manager/cache_manager.py", "sigbypass", "test", "--serial", "emulator-5554"],
        ["python3", "src/cache-manager/cache_manager.py", "https", "test", "--serial", "emulator-5554"],
        ["python3", "src/cache-manager/cache_manager.py", "phonepehelper", "test", "--serial", "emulator-5554"],
    ]:
        assert subprocess.run(cmd).returncode == 0
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/cache-manager/tests/test_cli_backcompat.py -v`
Expected: FAIL if compatibility wrappers are not complete.

**Step 3: Write minimal implementation**

```python
# cache_manager.py
# keep old module commands as wrappers to profile pipeline
# map legacy aliases to new internals without behavior break
```

```markdown
# README updates
# canonical profile commands + legacy command compatibility table
```

**Step 4: Run test to verify it passes**

Run (strict order):
1. `python3 -m unittest discover -s src/cache-manager/tests -p 'test_*.py' -v`
2. `yarn sigbypass --serial emulator-5554`
3. `yarn https --serial emulator-5554`
4. `yarn pehelp --serial emulator-5554`
5. `python3 src/cache-manager/cache_manager.py profile full test --serial emulator-5554`
6. `yarn probe:compare`

Expected:
- Unit test suite: PASS
- All emulator integration runs: PASS
- Behavior compare: PASS

**Step 5: Commit**

```bash
git add src/cache-manager/README.md src/README.md docs/plans/2026-03-02-profile-based-build-refactor-validation.md src/cache-manager/tests/test_cli_backcompat.py src/cache-manager/cache_manager.py
git commit -m "docs: finalize profile pipeline migration and validation evidence"
```

**Milestone Checkpoint:** Gate A + Gate B + Gate C + Gate D + Gate E must all pass together.

---

## Rollback and Safety Rules

1. Keep legacy commands operational until Task 7 is complete and validated.
2. Do not delete old cache directories until parity gate passes for two consecutive runs.
3. For any integration regression, rollback to last green commit and restore baseline APK from `artifacts/baseline/latest/`.
4. No milestone is considered complete without attached command outputs for all required gates.

## Evidence Required Per Milestone

1. Unit test command output (`unittest -v`).
2. Emulator command output with success markers.
3. Archived APK SHA256 for baseline/candidate.
4. Probe logs and compare result.
5. Commit hash for the milestone.

## Definition of Done

1. New profile pipeline is the primary path and produces stable APKs.
2. Module-level independent testing is reproducible.
3. Full profile integration test is reproducible.
4. Behavior parity with old pipeline is demonstrated through retained artifacts and probe comparison.
5. Documentation is updated and actionable for a new engineer.
