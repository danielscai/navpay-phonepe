# Orch Cache Layout Unification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify all `orch` cache paths under a single app-scoped layout and remove `src/pipeline/orch/cache_manifest.json` by replacing it with in-code registry definitions.

**Architecture:** Introduce a single in-code cache/module registry in `orchestrator.py` (or a small companion module) and route all path resolution through app-scoped helpers (`cache/apps/<app>/...`). Replace manifest loading with deterministic constants/functions, keep `apps_manifest.json` for app/package mapping only, and migrate tests/docs to the new source of truth.

**Tech Stack:** Python 3.9, pytest, existing `orch` CLI parser and module orchestration flow.

---

### Task 1: Define unified cache topology and in-code module registry

**Files:**
- Create: `src/pipeline/orch/cache_layout.py`
- Modify: `src/pipeline/orch/orchestrator.py`
- Test: `src/pipeline/orch/tests/test_cache_layout.py`

**Step 1: Write the failing test**

```python
from pathlib import Path
import cache_layout


def test_phonepe_paths_are_app_scoped(tmp_path, monkeypatch):
    monkeypatch.setattr(cache_layout, "REPO_ROOT", tmp_path)
    paths = cache_layout.paths_for_app("phonepe")
    assert paths.decompiled == tmp_path / "cache/apps/phonepe/decompiled"
    assert paths.snapshot_seed == tmp_path / "cache/apps/phonepe/snapshot_seed"
    assert paths.module_artifacts_root == tmp_path / "cache/apps/phonepe/modules"
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest -q src/pipeline/orch/tests/test_cache_layout.py::test_phonepe_paths_are_app_scoped`
Expected: FAIL with missing module/function (new layout abstraction not implemented yet)

**Step 3: Write minimal implementation**

```python
# cache_layout.py (minimal)
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

@dataclass(frozen=True)
class AppCachePaths:
    app: str
    root: Path
    snapshot_seed: Path
    merged: Path
    decompiled: Path
    profiles_root: Path
    module_artifacts_root: Path


def paths_for_app(app: str) -> AppCachePaths:
    root = (REPO_ROOT / f"cache/apps/{app}").resolve()
    return AppCachePaths(
        app=app,
        root=root,
        snapshot_seed=root / "snapshot_seed",
        merged=root / "merged",
        decompiled=root / "decompiled",
        profiles_root=root / "profiles",
        module_artifacts_root=root / "modules",
    )
```

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest -q src/pipeline/orch/tests/test_cache_layout.py`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/orch/cache_layout.py src/pipeline/orch/tests/test_cache_layout.py src/pipeline/orch/orchestrator.py
git commit -m "refactor(orch): add unified app-scoped cache layout helpers"
```

### Task 2: Remove runtime dependency on cache_manifest.json

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py`
- Delete: `src/pipeline/orch/cache_manifest.json`
- Test: `src/pipeline/orch/tests/test_module_artifact_planning.py`
- Test: `src/pipeline/orch/tests/test_manifest_decoupling.py`

**Step 1: Write the failing test**

```python
import orchestrator as orch


def test_load_manifest_returns_in_code_registry():
    manifest = orch.load_manifest()
    assert "phonepe_sigbypass" in manifest
    assert manifest["phonepe_sigbypass"]["deps"] == ["phonepe_decompiled"]
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest -q src/pipeline/orch/tests/test_module_artifact_planning.py::ModuleArtifactPlanningTest::test_resolve_module_spec_exposes_builder_metadata`
Expected: FAIL if `load_manifest()` still depends on deleted JSON file

**Step 3: Write minimal implementation**

```python
# orchestrator.py
# 1) remove MANIFEST_PATH and json file read path
# 2) keep MODULE_DEFAULTS + explicit MODULE_OVERRIDES constants
# 3) load_manifest() returns normalized in-code dict
# 4) all fields required by resolve_module_spec remain unchanged
```

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest -q src/pipeline/orch/tests/test_module_artifact_planning.py src/pipeline/orch/tests/test_manifest_decoupling.py`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/tests/test_module_artifact_planning.py src/pipeline/orch/tests/test_manifest_decoupling.py
git rm src/pipeline/orch/cache_manifest.json
git commit -m "refactor(orch): inline module manifest and remove cache_manifest.json"
```

### Task 3: Switch all cache path resolution to app-scoped layout

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py`
- Modify: `src/pipeline/orch/compose_engine.py`
- Test: `src/pipeline/orch/tests/test_compose_engine.py`
- Test: `src/pipeline/orch/tests/test_decompiled_command.py`
- Test: `src/pipeline/orch/tests/test_snapshot_seed_resolution.py`

**Step 1: Write the failing test**

```python
import orchestrator as orch


def test_module_artifact_path_is_app_scoped(tmp_path, monkeypatch):
    monkeypatch.setattr(orch, "REPO_ROOT", tmp_path)
    p = orch.module_artifact_path("phonepe", "phonepe_sigbypass")
    assert p == tmp_path / "cache/apps/phonepe/modules/phonepe_sigbypass/artifacts"
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest -q src/pipeline/orch/tests/test_module_artifact_cache.py`
Expected: FAIL because old global `cache/module_artifacts/...` path is still used

**Step 3: Write minimal implementation**

```python
# orchestrator.py / compose_engine.py
# - Replace cache/profiles/<profile> with cache/apps/<app>/profiles/<profile>
# - Replace cache/module_artifacts/<module> with cache/apps/<app>/modules/<module>/artifacts
# - Replace hardcoded phonepe dirs with app layout helpers where applicable
# - Keep command behavior unchanged
```

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest -q src/pipeline/orch/tests/test_compose_engine.py src/pipeline/orch/tests/test_module_artifact_cache.py src/pipeline/orch/tests/test_snapshot_seed_resolution.py src/pipeline/orch/tests/test_decompiled_command.py`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/compose_engine.py src/pipeline/orch/tests/test_compose_engine.py src/pipeline/orch/tests/test_module_artifact_cache.py src/pipeline/orch/tests/test_snapshot_seed_resolution.py src/pipeline/orch/tests/test_decompiled_command.py
git commit -m "refactor(orch): move caches to app-scoped hierarchy"
```

### Task 4: Add backward-compatible cache read fallback (migration window)

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py`
- Create: `src/pipeline/orch/tests/test_cache_migration_fallback.py`

**Step 1: Write the failing test**

```python
import orchestrator as orch


def test_decompile_reads_legacy_cache_when_new_path_missing(tmp_path, monkeypatch):
    # setup old path cache/phonepe/decompiled/... only
    # call resolver
    # assert resolver returns old path during migration window
    ...
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest -q src/pipeline/orch/tests/test_cache_migration_fallback.py`
Expected: FAIL because no fallback resolver exists

**Step 3: Write minimal implementation**

```python
# orchestrator.py
# Introduce resolve_existing_path(new_path, legacy_path)
# Prefer new path; fallback to legacy if new absent and legacy exists
# Emit one warning log when fallback is used
```

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest -q src/pipeline/orch/tests/test_cache_migration_fallback.py`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/tests/test_cache_migration_fallback.py
git commit -m "feat(orch): add legacy cache fallback for transition period"
```

### Task 5: Update docs and contracts to new source of truth

**Files:**
- Modify: `src/pipeline/orch/README.md`
- Modify: `src/pipeline/orch/tests/test_validation_doc_links.py`
- Modify: `docs/编排统一规范.md`
- Modify: `docs/plans/2026-03-02-profile-based-build-refactor-validation.md` (only if it references old paths)

**Step 1: Write the failing test**

```python
from pathlib import Path


def test_orch_readme_no_longer_mentions_cache_manifest_json():
    readme = Path("src/pipeline/orch/README.md").read_text(encoding="utf-8")
    assert "cache_manifest.json" not in readme
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest -q src/pipeline/orch/tests/test_validation_doc_links.py`
Expected: FAIL until docs are updated to new conventions

**Step 3: Write minimal implementation**

```text
- README: replace manifest-file description with "in-code registry in orchestrator/cache_layout"
- Update cache path examples to cache/apps/<app>/...
- Keep command docs unchanged unless behavior changed
```

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest -q src/pipeline/orch/tests/test_validation_doc_links.py`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/orch/README.md src/pipeline/orch/tests/test_validation_doc_links.py docs/编排统一规范.md docs/plans/2026-03-02-profile-based-build-refactor-validation.md
git commit -m "docs(orch): align docs with app-scoped cache layout and in-code registry"
```

### Task 6: End-to-end verification and cleanup

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py` (if any final cleanup)
- Optional Delete: legacy cache fallback code (if migration window intentionally skipped)

**Step 1: Write the failing test**

```python
# Use existing integration tests; add one smoke contract if missing.
```

**Step 2: Run test to verify baseline failures are understood**

Run: `python3 -m pytest -q src/pipeline/orch/tests`
Expected: either all PASS, or only known device/environment-dependent tests skipped

**Step 3: Write minimal implementation**

```text
- Remove dead constants and helper paths that reference old cache roots
- Ensure no code path references src/pipeline/orch/cache_manifest.json
```

**Step 4: Run verification commands**

Run:
- `python3 -m pytest -q src/pipeline/orch/tests`
- `orch plan`
- `orch prepare`
- `orch smali`
- `orch merge`
- `orch decompile phonepe`

Expected:
- tests PASS
- orch commands complete without manifest-file dependency errors

**Step 5: Commit**

```bash
git add src/pipeline/orch
git commit -m "chore(orch): finalize cache layout unification and manifest removal"
```

## Rollout and Risk Controls

- Migration strategy: keep legacy-read fallback for 1 release cycle; no legacy writes.
- Safety invariant: new writes must go only to `cache/apps/<app>/...`.
- Rollback: revert commits for Task 3/4 and restore `cache_manifest.json` if urgent regression appears.
- Non-goal: changing build/test semantic behavior (`plan/prepare/smali/merge/apk/test` semantics stay the same).

## Definition of Done

- `src/pipeline/orch/cache_manifest.json` removed.
- `load_manifest()` no longer reads disk manifest JSON.
- All `orch` cache roots are app-scoped (or explicitly `shared`).
- Tests/docs updated and passing.
- `orch decompile phonepe` and profile pipeline work under new path conventions.
