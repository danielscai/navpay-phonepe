# PhonePe Snapshot Versioned Path Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the orchestrator so PhonePe build/test no longer depends on `cache/phonepe/from_device`, but instead resolves APK inputs from versioned snapshot storage, then rebuilds release and validates on emulator.

**Architecture:** Keep the existing top-level workflow (`plan/prepare/smali/merge/apk/test`) but replace the old split seed source with a snapshot selector that reads `cache/phonepe/snapshots/index.json`, resolves a concrete snapshot key (`package + versionCode + signingDigest`), and materializes a deterministic seed directory for downstream steps. Wire this seed into decompiled generation and profile split-session packaging so every stage uses one consistent version anchor.

**Tech Stack:** Python 3 (`argparse`, `json`, `pathlib`, `subprocess`, `shutil`), existing orchestrator cache graph, pytest unit tests, Yarn orchestration commands.

---

### Task 1: Add snapshot seed selection contract (version-aware)

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py`
- Test: `src/pipeline/orch/tests/test_cli_contract.py`

**Step 1: Write the failing test**

```python
def test_profile_commands_accept_snapshot_version_arg() -> None:
    parser = orch.build_parser()
    args = parser.parse_args(["apk", "--profile", "full", "--snapshot-version", "26022705"])
    assert args.cmd == "apk"
    assert args.snapshot_version == "26022705"
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_cli_contract.py::CliContractTest::test_profile_commands_accept_snapshot_version_arg -q`
Expected: FAIL (`--snapshot-version` not recognized).

**Step 3: Write minimal implementation**

```python
def add_profile_args(..., allow_snapshot_version: bool = True):
    ...
    if allow_snapshot_version:
        cmd_parser.add_argument("--snapshot-version", default="")
```

Also thread `snapshot_version` through `main(...) -> run_profile_action(...) -> profile_prepare/profile_apk/profile_test`.

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_cli_contract.py::CliContractTest::test_profile_commands_accept_snapshot_version_arg -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/tests/test_cli_contract.py
git commit -m "feat(orch): add snapshot-version arg for profile workflow"
```

### Task 2: Implement snapshot index resolver and version picker

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py`
- Test: `src/pipeline/orch/tests/test_collect_cache_hit.py`
- Create: `src/pipeline/orch/tests/test_snapshot_seed_resolution.py`

**Step 1: Write the failing test**

```python
def test_resolve_snapshot_anchor_prefers_requested_version(tmp_path):
    idx = tmp_path / "index.json"
    idx.write_text(json.dumps({
        "snapshots": [
            {"package": "com.phonepe.app", "versionCode": "26022705", "signingDigest": "d1", "updated_at": "2026-04-08T10:00:00"},
            {"package": "com.phonepe.app", "versionCode": "26022800", "signingDigest": "d2", "updated_at": "2026-04-08T12:00:00"},
        ]
    }))
    anchor = cache_manager.resolve_snapshot_anchor(idx, "com.phonepe.app", "26022705")
    assert anchor["versionCode"] == "26022705"
    assert anchor["signingDigest"] == "d1"
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_snapshot_seed_resolution.py::test_resolve_snapshot_anchor_prefers_requested_version -q`
Expected: FAIL (resolver not implemented).

**Step 3: Write minimal implementation**

```python
def resolve_snapshot_anchor(index_path: Path, package: str, snapshot_version: str) -> dict:
    data = json.loads(index_path.read_text(encoding="utf-8"))
    candidates = [s for s in data.get("snapshots", []) if s.get("package") == package]
    if snapshot_version:
        candidates = [s for s in candidates if str(s.get("versionCode", "")).strip() == snapshot_version]
    if not candidates:
        raise RuntimeError("No matching snapshot found")
    candidates.sort(key=lambda x: str(x.get("updated_at", "")), reverse=True)
    return {
        "packageName": package,
        "versionCode": str(candidates[0].get("versionCode", "")).strip(),
        "signingDigest": normalize_signing_digest(str(candidates[0].get("signingDigest", ""))),
    }
```

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_snapshot_seed_resolution.py -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/tests/test_snapshot_seed_resolution.py
git commit -m "feat(orch): resolve snapshot anchor from index with version filter"
```

### Task 3: Materialize deterministic snapshot seed directory (replace from_device source)

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py`
- Modify: `src/pipeline/orch/cache_manifest.json`
- Test: `src/pipeline/orch/tests/test_manifest_decoupling.py`
- Create: `src/pipeline/orch/tests/test_snapshot_seed_resolution.py`

**Step 1: Write the failing test**

```python
def test_build_phonepe_snapshot_seed_copies_required_apks(tmp_path):
    # Arrange snapshots/<pkg>/<version>/<digest>/captures/<target>/base+splits
    # Act build_phonepe_snapshot_seed(seed_dir, snapshots_root, package, version)
    # Assert seed_dir has base.apk + split_config.arm64_v8a.apk + split_config.xxhdpi.apk + meta.json
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_snapshot_seed_resolution.py::test_build_phonepe_snapshot_seed_copies_required_apks -q`
Expected: FAIL.

**Step 3: Write minimal implementation**

```python
def build_phonepe_snapshot_seed(cache_path: Path, package: str, snapshot_version: str):
    anchor = resolve_snapshot_anchor(DEFAULT_SNAPSHOTS_ROOT / "index.json", package, snapshot_version)
    capture_dir = resolve_snapshot_capture_dir(DEFAULT_SNAPSHOTS_ROOT, anchor)
    delete_cache_dir(cache_path)
    cache_path.mkdir(parents=True, exist_ok=True)
    for name in ("base.apk", *DEFAULT_REQUIRED_SPLITS):
        shutil.copy2(capture_dir / name, cache_path / name)
    write_meta(cache_path / "meta.json", {"source": "snapshot", "anchor": anchor, "capture_dir": str(capture_dir)})
```

Update manifest root node from old `phonepe_from_device` to new snapshot seed node (or keep old key but path/source semantics switched to snapshot) and make `phonepe_merged` depend on this seed node.

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_snapshot_seed_resolution.py src/pipeline/orch/tests/test_manifest_decoupling.py -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/cache_manifest.json src/pipeline/orch/tests/test_snapshot_seed_resolution.py src/pipeline/orch/tests/test_manifest_decoupling.py
git commit -m "feat(orch): switch split seed source from from_device to snapshots"
```

### Task 4: Upgrade decompiled cache build to snapshot-version-aware flow

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py`
- Test: `src/pipeline/orch/tests/test_module_artifact_cache.py`
- Create: `src/pipeline/orch/tests/test_snapshot_seed_resolution.py`

**Step 1: Write the failing test**

```python
def test_build_phonepe_decompiled_meta_includes_snapshot_anchor(tmp_path):
    merged = tmp_path / "merged"
    merged.mkdir()
    (merged / "foo_merged_signed.apk").write_text("x")
    out = tmp_path / "decompiled"
    cache_manager.build_phonepe_decompiled(out, merged, anchor={"versionCode": "26022705", "signingDigest": "d1"})
    meta = json.loads((out / "meta.json").read_text())
    assert meta["snapshot_anchor"]["versionCode"] == "26022705"
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_snapshot_seed_resolution.py::test_build_phonepe_decompiled_meta_includes_snapshot_anchor -q`
Expected: FAIL.

**Step 3: Write minimal implementation**

```python
def build_phonepe_decompiled(cache_path: Path, merged_cache: Path, anchor: Optional[dict] = None):
    ...
    meta = {
        "created_at": datetime.now().isoformat(),
        "source": signed[0].name,
        "input_cache": str(merged_cache),
        "snapshot_anchor": anchor or {},
    }
```

Thread anchor from snapshot-seed build path when invoking `build_phonepe_merged -> build_phonepe_decompiled` during rebuild chain.

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_snapshot_seed_resolution.py::test_build_phonepe_decompiled_meta_includes_snapshot_anchor -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/tests/test_snapshot_seed_resolution.py
git commit -m "feat(orch): persist snapshot anchor in decompiled cache metadata"
```

### Task 5: Upgrade profile split source resolution to snapshot seed (remove hardcoded from_device)

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py`
- Test: `src/pipeline/orch/tests/test_reuse_artifacts.py`
- Test: `src/pipeline/orch/tests/test_split_session_install_mode.py`
- Create: `src/pipeline/orch/tests/test_snapshot_seed_resolution.py`

**Step 1: Write the failing test**

```python
def test_profile_apk_uses_resolved_snapshot_split_seed(monkeypatch, tmp_path):
    manifest = {}
    work_dir = tmp_path / "build"
    work_dir.mkdir()
    (work_dir / "patched_signed.apk").write_text("x")
    called = {}
    monkeypatch.setattr(cache_manager, "resolve_profile_split_seed_dir", lambda *_args, **_kwargs: tmp_path / "seed")
    monkeypatch.setattr(cache_manager, "ensure_profile_release_splits_signed", lambda w, s, b: called.update({"source": s}))
    # mock rest to drive profile_apk
    ...
    assert called["source"] == tmp_path / "seed"
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_reuse_artifacts.py::ReuseArtifactsTest::test_profile_apk_uses_resolved_snapshot_split_seed -q`
Expected: FAIL.

**Step 3: Write minimal implementation**

```python
def resolve_profile_split_seed_dir(package: str, snapshot_version: str) -> Path:
    seed_dir = resolve_cache_path("cache/phonepe/snapshot_seed")
    if not (seed_dir / "base.apk").exists():
        build_phonepe_snapshot_seed(seed_dir, package, snapshot_version)
    return seed_dir

# profile_apk(...):
split_seed_dir = resolve_profile_split_seed_dir(DEFAULT_PACKAGE, snapshot_version)
```

Remove usage of `DEFAULT_SPLIT_SEED_DIR = "cache/phonepe/from_device"` for profile paths.

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_reuse_artifacts.py src/pipeline/orch/tests/test_split_session_install_mode.py -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/tests/test_reuse_artifacts.py src/pipeline/orch/tests/test_split_session_install_mode.py
git commit -m "feat(orch): resolve profile split source from snapshot seed"
```

### Task 6: Update rebuild graph and status output for snapshot-era root cache

**Files:**
- Modify: `src/pipeline/orch/orchestrator.py`
- Modify: `src/pipeline/orch/cache_manifest.json`
- Test: `src/pipeline/orch/tests/test_entry_contract.py`
- Test: `src/pipeline/orch/tests/test_artifact_contract.py`

**Step 1: Write the failing test**

```python
def test_rebuild_phonepe_snapshot_seed_builds_from_snapshot_index(monkeypatch, tmp_path):
    # parser/rebuild target exists and build_one routes through snapshot seed builder
    ...
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_entry_contract.py -q`
Expected: FAIL.

**Step 3: Write minimal implementation**

```python
if name == "phonepe_snapshot_seed":
    build_phonepe_snapshot_seed(path, package, snapshot_version)
elif name == "phonepe_merged":
    input_path = resolve_manifest_path(manifest, "phonepe_snapshot_seed")
    build_phonepe_merged(path, input_path, package, serial)
```

Ensure `cmd_status` and `graph` reflect new seed node and no stale `from_device` assumption.

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_entry_contract.py src/pipeline/orch/tests/test_artifact_contract.py -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/pipeline/orch/orchestrator.py src/pipeline/orch/cache_manifest.json src/pipeline/orch/tests/test_entry_contract.py src/pipeline/orch/tests/test_artifact_contract.py
git commit -m "refactor(orch): align rebuild graph with snapshot seed cache root"
```

### Task 7: Documentation and operational command updates

**Files:**
- Modify: `src/pipeline/orch/README.md`
- Modify: `docs/编排统一规范.md`
- Modify: `docs/release-to-admin.md`
- Modify: `docs/verification/2026-04-07-patched-signed-split-signature-alignment.md`

**Step 1: Write the failing docs-link test**

```python
def test_docs_do_not_reference_cache_phonepe_from_device_anymore():
    ...
```

**Step 2: Run test to verify it fails**

Run: `python3 -m pytest src/pipeline/orch/tests/test_validation_doc_links.py -q`
Expected: FAIL if stale paths remain.

**Step 3: Write minimal documentation updates**

- Replace examples using `cache/phonepe/from_device` with snapshot-seed path and explicit version selection.
- Document `--snapshot-version` behavior:
  - absent => latest by `updated_at`
  - present => exact `versionCode` match

**Step 4: Run test to verify it passes**

Run: `python3 -m pytest src/pipeline/orch/tests/test_validation_doc_links.py -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/pipeline/orch/README.md docs/编排统一规范.md docs/release-to-admin.md docs/verification/2026-04-07-patched-signed-split-signature-alignment.md src/pipeline/orch/tests/test_validation_doc_links.py
git commit -m "docs(orch): update split seed docs for snapshot-version workflow"
```

### Task 8: End-to-end verify build + emulator test with latest release path

**Files:**
- Verify only: runtime cache outputs under `cache/phonepe/snapshot_seed`, `cache/phonepe/decompiled`, `cache/profiles/full/build`

**Step 1: Run focused orchestrator tests**

Run:

```bash
python3 -m pytest src/pipeline/orch/tests/test_cli_contract.py -q
python3 -m pytest src/pipeline/orch/tests/test_snapshot_seed_resolution.py -q
python3 -m pytest src/pipeline/orch/tests/test_reuse_artifacts.py -q
python3 -m pytest src/pipeline/orch/tests/test_split_session_install_mode.py -q
python3 -m pytest src/pipeline/orch/tests/test_manifest_decoupling.py -q
```

Expected: all PASS.

**Step 2: Build latest release from repo root (required workflow)**

Run: `yarn apk`
Expected: output `cache/profiles/full/build/patched_signed.apk` and required splits prepared from snapshot seed source.

**Step 3: Verify install/test on emulator (required workflow)**

Run: `yarn test`
Expected: split-session install success, app launch success, no path resolution error from old `from_device`.

**Step 4: Validate artifact paths and metadata**

Run:

```bash
ls -la cache/phonepe/snapshot_seed
cat cache/phonepe/snapshot_seed/meta.json
cat cache/phonepe/decompiled/meta.json
ls -la cache/profiles/full/build
```

Expected: metadata includes selected `versionCode/signingDigest` and build artifacts exist.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(orch): migrate build/profile paths to versioned snapshot seed workflow"
```

