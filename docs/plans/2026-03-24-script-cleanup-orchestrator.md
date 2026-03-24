# Script Cleanup And Orchestrator Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove obsolete script entrypoints, align all remaining module tooling with the orchestrator-first build model, and keep profile smoke tests passing after cleanup.

**Architecture:** The orchestrator remains the only supported top-level build/test pipeline. Each module keeps only the minimal artifact builder plus injector entrypoints that the orchestrator directly references. Hidden fallback compilation inside injectors is removed so build work happens once in the artifact stage, improving determinism and compile speed.

**Tech Stack:** Python 3 orchestrator, Bash module scripts, Android build tools (`apktool`, `d8`, `apksigner`, `adb`), `unittest`.

---

### Task 1: Define the supported script surface

**Files:**
- Modify: `src/build-orchestrator/cache_manifest.json`
- Modify: `src/pipeline/tools/README.md`
- Modify: `src/README.md`
- Test: `src/build-orchestrator/tests/test_module_artifact_planning.py`

**Step 1: Write the failing test**

```python
def test_resolve_module_spec_points_only_to_supported_scripts():
    manifest = cache_manager.load_manifest()
    supported = {
        "phonepe_sigbypass": "src/apk/signature_bypass/tools/build_artifacts.sh",
        "phonepe_https_interceptor": "src/apk/https_interceptor/scripts/build_smali_artifacts.sh",
        "phonepe_phonepehelper": "src/apk/phonepehelper/scripts/build_artifacts.sh",
    }
    for module, command in supported.items():
        spec = cache_manager.resolve_module_spec(manifest, module)
        assert spec["builder"]["command"] == command
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/build-orchestrator/tests/test_module_artifact_planning.py -v`
Expected: FAIL if manifest/docs still point to unsupported or duplicate script entrypoints.

**Step 3: Write minimal implementation**

```json
{
  "phonepe_sigbypass": { "builder": { "command": "src/apk/signature_bypass/tools/build_artifacts.sh" } },
  "phonepe_https_interceptor": { "builder": { "command": "src/apk/https_interceptor/scripts/build_smali_artifacts.sh" } },
  "phonepe_phonepehelper": { "builder": { "command": "src/apk/phonepehelper/scripts/build_artifacts.sh" } }
}
```

Document that the supported surface is:
- orchestrator commands in `src/build-orchestrator/orchestrator.py`
- module artifact builders
- module injectors consumed by orchestrator
- smoke wrappers in `src/pipeline/tools/`

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest src/build-orchestrator/tests/test_module_artifact_planning.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/build-orchestrator/cache_manifest.json src/pipeline/tools/README.md src/README.md src/build-orchestrator/tests/test_module_artifact_planning.py
git commit -m "docs: define supported orchestrator script surface"
```

### Task 2: Remove hidden compile fallbacks from module injectors

**Files:**
- Modify: `src/apk/signature_bypass/scripts/inject.sh`
- Modify: `src/apk/phonepehelper/scripts/inject.sh`
- Modify: `src/apk/https_interceptor/scripts/inject.sh`
- Test: `src/build-orchestrator/tests/test_manifest_decoupling.py`
- Test: `src/build-orchestrator/tests/test_module_artifact_planning.py`

**Step 1: Write the failing test**

```python
def test_injectors_do_not_trigger_module_local_builds():
    for path in (
        Path("src/apk/signature_bypass/scripts/inject.sh"),
        Path("src/apk/phonepehelper/scripts/inject.sh"),
        Path("src/apk/https_interceptor/scripts/inject.sh"),
    ):
        text = path.read_text(encoding="utf-8")
        assert "compile.sh" not in text
        assert "build_smali_artifacts.sh" not in text
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/build-orchestrator/tests/test_manifest_decoupling.py -v`
Expected: FAIL because current injectors still include local build fallback logic.

**Step 3: Write minimal implementation**

```bash
# inject.sh behavior
if [ -z "$ARTIFACT_DIR" ] || [ ! -d "$ARTIFACT_DIR" ]; then
  log_error "artifact-dir required"
  exit 1
fi
```

For `https_interceptor`, keep only artifact consumption and patching logic.
For `signature_bypass` and `phonepehelper`, make injectors artifact-only and remove local compile fallback branches.

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest src/build-orchestrator/tests/test_manifest_decoupling.py src/build-orchestrator/tests/test_module_artifact_planning.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/apk/signature_bypass/scripts/inject.sh src/apk/phonepehelper/scripts/inject.sh src/apk/https_interceptor/scripts/inject.sh src/build-orchestrator/tests/test_manifest_decoupling.py src/build-orchestrator/tests/test_module_artifact_planning.py
git commit -m "refactor: make module injectors artifact-only"
```

### Task 3: Collapse duplicate compile entrypoints to the fastest single path

**Files:**
- Modify: `src/apk/signature_bypass/tools/build_artifacts.sh`
- Modify: `src/apk/signature_bypass/tools/compile.sh`
- Modify: `src/apk/phonepehelper/scripts/build_artifacts.sh`
- Modify: `src/apk/phonepehelper/scripts/compile.sh`
- Test: `src/build-orchestrator/tests/test_module_artifact_planning.py`

**Step 1: Write the failing test**

```python
def test_builder_fingerprint_inputs_reference_single_build_entry_per_module():
    manifest = cache_manager.load_manifest()
    sig = cache_manager.resolve_module_spec(manifest, "phonepe_sigbypass")
    helper = cache_manager.resolve_module_spec(manifest, "phonepe_phonepehelper")
    assert cache_manager.REPO_ROOT / "src/apk/signature_bypass/tools/build_artifacts.sh" in sig["fingerprint_inputs"]
    assert cache_manager.REPO_ROOT / "src/apk/phonepehelper/scripts/build_artifacts.sh" in helper["fingerprint_inputs"]
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/build-orchestrator/tests/test_module_artifact_planning.py -v`
Expected: FAIL if builders still depend on unnecessary multi-hop shell wrappers.

**Step 3: Write minimal implementation**

```bash
# build_artifacts.sh
exec "$SCRIPT_DIR/compile.sh" "$@"
```

Then simplify `compile.sh` so it becomes the only heavy compilation body per module:
- auto-detect latest `build-tools/*/d8` instead of hardcoded `35.0.0`
- fail fast on missing prerequisites
- remove duplicate copy/download branches that are no longer needed

Keep `build_artifacts.sh` as the orchestrator-facing name and make it a thin `exec` shim if needed.

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest src/build-orchestrator/tests/test_module_artifact_planning.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/apk/signature_bypass/tools/build_artifacts.sh src/apk/signature_bypass/tools/compile.sh src/apk/phonepehelper/scripts/build_artifacts.sh src/apk/phonepehelper/scripts/compile.sh src/build-orchestrator/tests/test_module_artifact_planning.py
git commit -m "perf: streamline module artifact builders"
```

### Task 4: Delete obsolete legacy scripts and their test/docs references

**Files:**
- Delete: `src/apk/signature_bypass/tools/inject.sh`
- Delete: `src/apk/signature_bypass/tools/merge.sh`
- Delete: `src/apk/signature_bypass/tools/inject_hook.py`
- Delete: `src/apk/signature_bypass/scripts/verify_injection.sh`
- Delete: `src/apk/https_interceptor/build_and_install.sh`
- Delete: `src/pipeline/tools/inject.sh`
- Delete: `src/pipeline/tools/test_signature_bypass.sh`
- Modify: `src/pipeline/tools/README.md`
- Modify: `src/apk/signature_bypass/README.md`
- Test: `src/build-orchestrator/tests/test_new_test_scripts_contract.py`
- Test: `src/build-orchestrator/tests/test_entry_contract.py`

**Step 1: Write the failing test**

```python
def test_removed_legacy_scripts_no_longer_exist():
    removed = [
        Path("src/apk/signature_bypass/tools/inject.sh"),
        Path("src/apk/signature_bypass/tools/merge.sh"),
        Path("src/apk/signature_bypass/tools/inject_hook.py"),
        Path("src/apk/signature_bypass/scripts/verify_injection.sh"),
        Path("src/apk/https_interceptor/build_and_install.sh"),
        Path("src/pipeline/tools/inject.sh"),
        Path("src/pipeline/tools/test_signature_bypass.sh"),
    ]
    for path in removed:
        assert not path.exists()
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/build-orchestrator/tests/test_new_test_scripts_contract.py src/build-orchestrator/tests/test_entry_contract.py -v`
Expected: FAIL because files still exist and docs still mention them.

**Step 3: Write minimal implementation**

Delete the obsolete files.
Update docs to point only to:
- `yarn orch:*`
- `src/pipeline/tools/test_profile_smoke.sh`
- `src/pipeline/tools/test_profile_full.sh`
- `src/pipeline/tools/test_module_independent.sh`
- `src/pipeline/tools/archive_apk.sh`
- `src/pipeline/tools/behavior_probe.sh`
- `src/pipeline/tools/compare_behavior.sh`

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest src/build-orchestrator/tests/test_new_test_scripts_contract.py src/build-orchestrator/tests/test_entry_contract.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add -A src/apk/signature_bypass src/apk/https_interceptor src/pipeline/tools src/build-orchestrator/tests src/apk/signature_bypass/README.md
git commit -m "chore: remove legacy script entrypoints"
```

### Task 5: Tighten remaining smoke wrappers to minimal orchestrator delegation

**Files:**
- Modify: `src/pipeline/tools/test_profile_smoke.sh`
- Modify: `src/pipeline/tools/test_profile_full.sh`
- Modify: `src/pipeline/tools/test_module_independent.sh`
- Modify: `package.json`
- Test: `src/build-orchestrator/tests/test_new_test_scripts_contract.py`

**Step 1: Write the failing test**

```python
def test_smoke_wrappers_delegate_only_to_orchestrator():
    for path in (
        Path("src/pipeline/tools/test_profile_smoke.sh"),
        Path("src/pipeline/tools/test_profile_full.sh"),
        Path("src/pipeline/tools/test_module_independent.sh"),
    ):
        text = path.read_text(encoding="utf-8")
        assert "orchestrator.py" in text
        assert "apktool" not in text
        assert "apksigner" not in text
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/build-orchestrator/tests/test_new_test_scripts_contract.py -v`
Expected: FAIL if wrappers still include redundant setup or duplicate orchestration steps.

**Step 3: Write minimal implementation**

```bash
# test_profile_smoke.sh
exec python3 src/build-orchestrator/orchestrator.py test --profile "$PROFILE_NAME" --smoke --serial "$SERIAL"
```

```bash
# test_profile_full.sh
exec python3 src/build-orchestrator/orchestrator.py test --serial "$SERIAL"
```

Keep wrappers as thin command aliases only.

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest src/build-orchestrator/tests/test_new_test_scripts_contract.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/tools/test_profile_smoke.sh src/pipeline/tools/test_profile_full.sh src/pipeline/tools/test_module_independent.sh package.json src/build-orchestrator/tests/test_new_test_scripts_contract.py
git commit -m "refactor: slim smoke wrapper scripts"
```

### Task 6: Full verification after cleanup

**Files:**
- Modify: `src/build-orchestrator/README.md`
- Modify: `src/pipeline/tools/README.md`
- Test: `src/build-orchestrator/tests/test_cli_backcompat.py`
- Test: `src/build-orchestrator/tests/test_module_artifact_planning.py`
- Test: `src/build-orchestrator/tests/test_smoke_mode.py`
- Test: `src/build-orchestrator/tests/test_reuse_artifacts.py`
- Test: `src/build-orchestrator/tests/test_profile_injection_verification.py`

**Step 1: Write the failing test**

```python
def test_docs_reference_orchestrator_first_workflow():
    readme = Path("src/build-orchestrator/README.md").read_text(encoding="utf-8")
    assert "orchestrator.py test --smoke" in readme
    assert "build_and_install.sh" not in readme
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/build-orchestrator/tests/test_cli_backcompat.py src/build-orchestrator/tests/test_smoke_mode.py src/build-orchestrator/tests/test_reuse_artifacts.py src/build-orchestrator/tests/test_profile_injection_verification.py -v`
Expected: FAIL if docs/contracts still describe deleted paths or stale flow.

**Step 3: Write minimal implementation**

Update docs to reflect:
- orchestrator-first workflow
- artifact-only injectors
- smoke wrappers as convenience aliases
- no hidden script-local compile path during injection

**Step 4: Run test to verify it passes**

Run:
- `python3 -m unittest src/build-orchestrator/tests/test_cli_backcompat.py src/build-orchestrator/tests/test_module_artifact_planning.py src/build-orchestrator/tests/test_smoke_mode.py src/build-orchestrator/tests/test_reuse_artifacts.py src/build-orchestrator/tests/test_profile_injection_verification.py -v`
- `yarn orch:test:smoke`
- `yarn orch:test`

Expected:
- unit tests PASS
- smoke test PASS
- full orchestrator test PASS

**Step 5: Commit**

```bash
git add src/build-orchestrator/README.md src/pipeline/tools/README.md src/build-orchestrator/tests
git commit -m "test: verify orchestrator-first script cleanup"
```
