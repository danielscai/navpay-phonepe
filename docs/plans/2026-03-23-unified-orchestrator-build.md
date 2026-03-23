# Unified Orchestrator Build Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace per-module ad hoc build/inject flows with one orchestrated module-artifact pipeline that compiles changed modules once, injects them into one shared workspace, and packages the final APK once.

**Architecture:** Keep source code split by module, but standardize each module to emit declarative build artifacts into a shared artifact cache. Convert `cache_manager` from a mixed compatibility wrapper into the primary orchestrator for module artifact build, workspace composition, final APK packaging, and smoke/full test execution. Remove repeated module-local build steps from inject scripts so injection becomes a pure artifact-consumption step. The authoritative contract details live in `docs/plans/2026-03-23-unified-orchestrator-build-architecture.md`.

**Tech Stack:** Python 3 (`src/cache-manager`), Bash injection/build helpers, Android SDK tools (`d8`, `apktool`, `zipalign`, `apksigner`), Gradle only where still unavoidable during migration, `unittest`

---

### Task 1: Write the target architecture doc and lock interfaces

**Files:**
- Create: `docs/plans/2026-03-23-unified-orchestrator-build-architecture.md`
- Modify: `docs/plans/2026-03-23-unified-orchestrator-build.md`

**Step 1: Write the failing design checklist**

Document these required interfaces in the architecture note:

```text
artifact root:
  cache/module_artifacts/<module_name>/

required files:
  manifest.json
  fingerprints.json
  smali/** (optional when module only patches existing files)
  libs/** (optional)
  patches.json (or equivalent declarative metadata)

orchestrator stages:
  prepare-workspace
  build-modules
  inject-modules
  package-apk
  test-apk
```

**Step 2: Review current code paths that must map into the new interfaces**

Read:
- `src/cache-manager/cache_manager.py`
- `src/cache-manager/cache_manifest.json`
- `src/cache-manager/cache_profiles.json`
- `src/signature_bypass/scripts/inject.sh`
- `src/https_interceptor/scripts/inject.sh`
- `src/phonepehelper/scripts/inject.sh`

Expected: clear mapping from old module-specific behavior to new artifact schema.

**Step 3: Write the minimal architecture doc**

Include:

```markdown
# Unified Orchestrator Build Architecture

## Module contract
- Each module declares `sources`, `builder`, `outputs`, `patches`, `entrypoints`.

## Artifact contract
- `manifest.json` stores module version, builder type, source fingerprint, output paths.
- `fingerprints.json` stores file-level fingerprint inputs used for cache hit/miss.

## Injection contract
- No module-local compile step is allowed during injection.
- Injection accepts `(workspace_dir, artifact_dir)` only.

## Orchestrator contract
- Resolve profile modules.
- Build only stale module artifacts.
- Inject modules in profile order.
- Package once.
- Test once.
```

**Step 4: Re-read the plan and update this implementation plan if any task assumptions changed**

Expected: terminology in this file matches the architecture doc.

**Step 5: Commit**

```bash
git add docs/plans/2026-03-23-unified-orchestrator-build.md docs/plans/2026-03-23-unified-orchestrator-build-architecture.md
git commit -m "docs: define unified orchestrator build architecture"
```

### Task 2: Add failing tests for orchestrator artifact planning

**Files:**
- Create: `src/cache-manager/tests/test_module_artifact_planning.py`
- Modify: `src/cache-manager/cache_manager.py`

**Step 1: Write the failing test**

```python
import sys
import unittest
from pathlib import Path

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import cache_manager  # noqa: E402


class ModuleArtifactPlanningTest(unittest.TestCase):
    def test_build_parser_accepts_build_modules_action(self) -> None:
        args = cache_manager.build_parser().parse_args(
            ["profile", "full", "build-modules"]
        )
        self.assertEqual(args.cmd, "profile")
        self.assertEqual(args.name, "full")
        self.assertEqual(args.action, "build-modules")

    def test_profile_plan_build_returns_module_build_order(self) -> None:
        manifest = {
            "phonepe_sigbypass": {},
            "phonepe_https_interceptor": {},
            "phonepe_phonepehelper": {},
        }
        with unittest.mock.patch.object(
            cache_manager,
            "resolve_profile_modules",
            return_value=[
                "phonepe_sigbypass",
                "phonepe_https_interceptor",
                "phonepe_phonepehelper",
            ],
        ):
            order = cache_manager.profile_plan_build(manifest, "full")
        self.assertEqual(
            order,
            [
                "phonepe_sigbypass",
                "phonepe_https_interceptor",
                "phonepe_phonepehelper",
            ],
        )
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/cache-manager/tests/test_module_artifact_planning.py -v`

Expected: FAIL because `build-modules` action and `profile_plan_build()` do not exist yet.

**Step 3: Write minimal implementation**

Add parser support:

```python
profile.add_argument(
    "action",
    choices=["plan", "pre-cache", "build-modules", "inject", "compile", "test"],
)
```

Add helper:

```python
def profile_plan_build(manifest, profile_name: str):
    return resolve_profile_modules(manifest, profile_name)
```

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest src/cache-manager/tests/test_module_artifact_planning.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add src/cache-manager/tests/test_module_artifact_planning.py src/cache-manager/cache_manager.py
git commit -m "test: define unified module build planning contract"
```

### Task 3: Add failing tests for module artifact cache hits and misses

**Files:**
- Create: `src/cache-manager/tests/test_module_artifact_cache.py`
- Modify: `src/cache-manager/cache_manager.py`

**Step 1: Write the failing test**

```python
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

CACHE_MANAGER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CACHE_MANAGER_DIR))

import cache_manager  # noqa: E402


class ModuleArtifactCacheTest(unittest.TestCase):
    def test_module_artifact_cache_hit_skips_builder(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            artifact_dir = Path(tempdir) / "phonepe_sigbypass"
            artifact_dir.mkdir(parents=True)
            (artifact_dir / "manifest.json").write_text(
                json.dumps({"fingerprint": "fp1"}), encoding="utf-8"
            )

            spec = {"name": "phonepe_sigbypass"}
            with mock.patch.object(
                cache_manager, "compute_module_fingerprint", return_value="fp1"
            ), mock.patch.object(
                cache_manager, "run_module_builder"
            ) as builder_mock:
                reused = cache_manager.ensure_module_artifact(spec, artifact_dir)

            self.assertTrue(reused)
            builder_mock.assert_not_called()
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/cache-manager/tests/test_module_artifact_cache.py -v`

Expected: FAIL because artifact cache helpers do not exist.

**Step 3: Write minimal implementation**

Add:

```python
def compute_module_fingerprint(spec) -> str:
    ...

def read_module_artifact_manifest(artifact_dir: Path) -> dict:
    ...

def ensure_module_artifact(spec, artifact_dir: Path) -> bool:
    ...

def run_module_builder(spec, artifact_dir: Path):
    ...
```

Rules:
- cache hit when `manifest.json` exists and fingerprint matches
- cache miss runs builder and rewrites manifest
- return `True` on reuse, `False` on rebuild

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest src/cache-manager/tests/test_module_artifact_cache.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add src/cache-manager/tests/test_module_artifact_cache.py src/cache-manager/cache_manager.py
git commit -m "feat: add module artifact cache contract"
```

### Task 4: Add declarative module build metadata

**Files:**
- Modify: `src/cache-manager/cache_manifest.json`
- Modify: `src/cache-manager/cache_manager.py`
- Test: `src/cache-manager/tests/test_module_artifact_planning.py`

**Step 1: Write the failing test**

Extend the planning test:

```python
    def test_resolve_module_spec_exposes_builder_metadata(self) -> None:
        manifest = {
            "phonepe_sigbypass": {
                "path": "cache/phonepe_sigbypass",
                "source_cache": "phonepe_decompiled",
                "source_subdir": "base_decompiled_clean",
                "reset_paths": ["smali/com/phonepe/app/PhonePeApplication.smali"],
                "build_dir": "cache/phonepe_sigbypass_build",
                "inject_script": "src/signature_bypass/scripts/inject.sh",
                "builder": {
                    "kind": "script",
                    "command": "src/signature_bypass/tools/compile.sh",
                    "inputs": [
                        "src/signature_bypass/src/main/java",
                        "src/signature_bypass/tools/compile.sh",
                    ],
                },
            },
            "phonepe_decompiled": {"path": "cache/phonepe_decompiled"},
        }
        spec = cache_manager.resolve_module_spec(manifest, "phonepe_sigbypass")
        self.assertEqual(spec["builder"]["kind"], "script")
        self.assertIn("src/signature_bypass/src/main/java", spec["builder"]["inputs"])
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/cache-manager/tests/test_module_artifact_planning.py -v`

Expected: FAIL because `resolve_module_spec()` does not expose builder metadata.

**Step 3: Write minimal implementation**

Add `builder` metadata to each module in `cache_manifest.json`:

```json
"builder": {
  "kind": "script",
  "command": "src/signature_bypass/tools/compile.sh",
  "inputs": [
    "src/signature_bypass/src/main/java",
    "src/signature_bypass/tools/compile.sh",
    "src/signature_bypass/scripts/inject.sh",
    "src/tools/lib/dispatcher.sh"
  ]
}
```

For `https_interceptor`, define a temporary migration builder first, then replace it later:

```json
"builder": {
  "kind": "script",
  "command": "src/https_interceptor/scripts/build_smali_artifacts.sh",
  "inputs": [
    "src/https_interceptor/app/src/main/java",
    "src/https_interceptor/scripts/build_smali_artifacts.sh"
  ]
}
```

Expose builder metadata from `resolve_module_spec()`.

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest src/cache-manager/tests/test_module_artifact_planning.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add src/cache-manager/cache_manifest.json src/cache-manager/cache_manager.py src/cache-manager/tests/test_module_artifact_planning.py
git commit -m "feat: add declarative module builder metadata"
```

### Task 5: Implement orchestrated module artifact build stage

**Files:**
- Modify: `src/cache-manager/cache_manager.py`
- Test: `src/cache-manager/tests/test_module_artifact_cache.py`
- Test: `src/cache-manager/tests/test_module_artifact_planning.py`

**Step 1: Write the failing test**

Add:

```python
    def test_profile_build_modules_builds_all_modules_in_order(self) -> None:
        manifest = {}
        with mock.patch.object(
            cache_manager,
            "resolve_profile_modules",
            return_value=["phonepe_sigbypass", "phonepe_https_interceptor"],
        ), mock.patch.object(
            cache_manager,
            "resolve_module_spec",
            side_effect=lambda _manifest, name: {"name": name},
        ), mock.patch.object(
            cache_manager,
            "ensure_module_artifact",
        ) as ensure_mock:
            cache_manager.profile_build_modules(manifest, "full")

        self.assertEqual(
            [call.args[0]["name"] for call in ensure_mock.call_args_list],
            ["phonepe_sigbypass", "phonepe_https_interceptor"],
        )
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/cache-manager/tests/test_module_artifact_cache.py -v`

Expected: FAIL because `profile_build_modules()` does not exist.

**Step 3: Write minimal implementation**

Add:

```python
def module_artifact_root() -> Path:
    return REPO_ROOT / "cache" / "module_artifacts"

def module_artifact_path(module_name: str) -> Path:
    return module_artifact_root() / module_name

def profile_build_modules(manifest, profile_name: str):
    modules = resolve_profile_modules(manifest, profile_name)
    for module in modules:
        spec = resolve_module_spec(manifest, module)
        ensure_module_artifact(spec, module_artifact_path(module))
    return modules
```

Wire parser action:

```python
elif args.action == "build-modules":
    profile_build_modules(manifest, args.name)
```

**Step 4: Run test to verify it passes**

Run:
- `python3 -m unittest src/cache-manager/tests/test_module_artifact_cache.py -v`
- `python3 -m unittest src/cache-manager/tests/test_module_artifact_planning.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add src/cache-manager/cache_manager.py src/cache-manager/tests/test_module_artifact_cache.py src/cache-manager/tests/test_module_artifact_planning.py
git commit -m "feat: add orchestrated module artifact build stage"
```

### Task 6: Refactor signature_bypass to pure artifact builder plus pure injector

**Files:**
- Create: `src/signature_bypass/tools/build_artifacts.sh`
- Modify: `src/signature_bypass/scripts/inject.sh`
- Test: `src/cache-manager/tests/test_module_artifact_cache.py`

**Step 1: Write the failing test**

Add a cache-manager unit test that validates the builder command path:

```python
    def test_sigbypass_builder_uses_artifact_script(self) -> None:
        manifest = cache_manager.load_manifest()
        spec = cache_manager.resolve_module_spec(manifest, "phonepe_sigbypass")
        self.assertEqual(
            spec["builder"]["command"],
            "src/signature_bypass/tools/build_artifacts.sh",
        )
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/cache-manager/tests/test_module_artifact_cache.py -v`

Expected: FAIL until manifest points to new builder.

**Step 3: Write minimal implementation**

Create `build_artifacts.sh` that:
- runs existing compile logic
- copies final smali/libs into `$ARTIFACT_DIR/smali` and `$ARTIFACT_DIR/libs`
- writes no APK

Update `inject.sh`:
- accept `--artifact-dir <path>`
- forbid implicit compile during injection
- copy only from artifact directory

Core shell shape:

```bash
ARTIFACT_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --artifact-dir) ARTIFACT_DIR="$2"; shift 2 ;;
    *) TARGET_DIR="$1"; shift ;;
  esac
done

test -d "$ARTIFACT_DIR/smali" || { echo "missing artifact smali" >&2; exit 1; }
```

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest src/cache-manager/tests/test_module_artifact_cache.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add src/signature_bypass/tools/build_artifacts.sh src/signature_bypass/scripts/inject.sh src/cache-manager/cache_manifest.json src/cache-manager/tests/test_module_artifact_cache.py
git commit -m "refactor: split sigbypass builder from injector"
```

### Task 7: Refactor phonepehelper to pure artifact builder plus pure injector

**Files:**
- Create: `src/phonepehelper/scripts/build_artifacts.sh`
- Modify: `src/phonepehelper/scripts/inject.sh`
- Modify: `src/phonepehelper/scripts/merge.sh`
- Test: `src/cache-manager/tests/test_module_artifact_cache.py`

**Step 1: Write the failing test**

Add:

```python
    def test_phonepehelper_builder_uses_artifact_script(self) -> None:
        manifest = cache_manager.load_manifest()
        spec = cache_manager.resolve_module_spec(manifest, "phonepe_phonepehelper")
        self.assertEqual(
            spec["builder"]["command"],
            "src/phonepehelper/scripts/build_artifacts.sh",
        )
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/cache-manager/tests/test_module_artifact_cache.py -v`

Expected: FAIL until manifest and scripts are updated.

**Step 3: Write minimal implementation**

Create `build_artifacts.sh` that:
- runs current helper compile flow
- copies generated smali into standardized artifact paths
- preserves baksmali reuse logic

Update `inject.sh` and `merge.sh`:
- remove compile responsibility
- accept `--artifact-dir`
- inject only from artifact outputs

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest src/cache-manager/tests/test_module_artifact_cache.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add src/phonepehelper/scripts/build_artifacts.sh src/phonepehelper/scripts/inject.sh src/phonepehelper/scripts/merge.sh src/cache-manager/cache_manifest.json src/cache-manager/tests/test_module_artifact_cache.py
git commit -m "refactor: split phonepehelper builder from injector"
```

### Task 8: Replace https_interceptor APK build-back-decompile flow with direct smali artifact build

**Files:**
- Create: `src/https_interceptor/scripts/build_smali_artifacts.sh`
- Modify: `src/https_interceptor/scripts/inject.sh`
- Modify: `src/cache-manager/cache_manifest.json`
- Test: `src/cache-manager/tests/test_module_artifact_cache.py`

**Step 1: Write the failing test**

Add:

```python
    def test_https_builder_no_longer_uses_gradle_demo_apk(self) -> None:
        manifest = cache_manager.load_manifest()
        spec = cache_manager.resolve_module_spec(manifest, "phonepe_https_interceptor")
        self.assertEqual(
            spec["builder"]["command"],
            "src/https_interceptor/scripts/build_smali_artifacts.sh",
        )
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/cache-manager/tests/test_module_artifact_cache.py -v`

Expected: FAIL because manifest still points at old flow.

**Step 3: Write minimal implementation**

Create `build_smali_artifacts.sh` that:
- compiles `app/src/main/java/com/httpinterceptor/**` directly using `javac`
- runs `d8`
- runs `baksmali`
- copies required smali into `$ARTIFACT_DIR/smali/com/httpinterceptor/...`
- does not run `./gradlew assembleDebug`
- does not run `apktool d` on demo APK

Update `inject.sh`:
- require `--artifact-dir`
- copy interceptor and hook smali from artifact dir
- keep only target APK patching logic for `OkHttpClient$Builder.smali`

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest src/cache-manager/tests/test_module_artifact_cache.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add src/https_interceptor/scripts/build_smali_artifacts.sh src/https_interceptor/scripts/inject.sh src/cache-manager/cache_manifest.json src/cache-manager/tests/test_module_artifact_cache.py
git commit -m "refactor: build https interceptor smali artifacts directly"
```

### Task 9: Teach the orchestrator to inject from artifact directories only

**Files:**
- Modify: `src/cache-manager/cache_manager.py`
- Modify: `src/signature_bypass/scripts/inject.sh`
- Modify: `src/https_interceptor/scripts/inject.sh`
- Modify: `src/phonepehelper/scripts/inject.sh`
- Test: `src/cache-manager/tests/test_module_artifact_cache.py`

**Step 1: Write the failing test**

Add:

```python
    def test_profile_inject_passes_artifact_dir_to_injector(self) -> None:
        manifest = {}
        with mock.patch.object(
            cache_manager,
            "resolve_profile_modules",
            return_value=["phonepe_sigbypass"],
        ), mock.patch.object(
            cache_manager,
            "resolve_profile_workspace",
            return_value=Path("/tmp/workspace"),
        ), mock.patch.object(
            cache_manager,
            "resolve_module_spec",
            return_value={
                "name": "phonepe_sigbypass",
                "inject_script": Path("/tmp/inject.sh"),
                "reset_paths": ["a"],
                "added_paths": ["b"],
            },
        ), mock.patch.object(cache_manager, "inject") as inject_mock:
            cache_manager.profile_inject(manifest, "full")

        self.assertEqual(
            inject_mock.call_args.kwargs["artifact_dir"],
            cache_manager.module_artifact_path("phonepe_sigbypass"),
        )
```

**Step 2: Run test to verify it fails**

Run: `python3 -m unittest src/cache-manager/tests/test_module_artifact_cache.py -v`

Expected: FAIL because `inject()` does not accept `artifact_dir`.

**Step 3: Write minimal implementation**

Change Python API:

```python
def inject(cache_path, inject_script, reset_paths, added_paths, label, artifact_dir=None, skip_build=False):
    ...
    if artifact_dir:
        cmd += ["--artifact-dir", str(artifact_dir)]
```

Update `profile_inject()` to always call `ensure_module_artifact()` before injection and pass artifact dir.

**Step 4: Run test to verify it passes**

Run: `python3 -m unittest src/cache-manager/tests/test_module_artifact_cache.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add src/cache-manager/cache_manager.py src/signature_bypass/scripts/inject.sh src/https_interceptor/scripts/inject.sh src/phonepehelper/scripts/inject.sh src/cache-manager/tests/test_module_artifact_cache.py
git commit -m "feat: inject modules only from orchestrated artifacts"
```

### Task 10: Make profile compile/test use the unified stage boundaries

**Files:**
- Modify: `src/cache-manager/cache_manager.py`
- Modify: `src/tools/test_profile_smoke.sh`
- Modify: `src/cache-manager/README.md`
- Test: `src/cache-manager/tests/test_reuse_artifacts.py`
- Test: `src/cache-manager/tests/test_smoke_mode.py`

**Step 1: Write the failing test**

Add:

```python
    def test_profile_test_runs_build_modules_before_compile(self) -> None:
        manifest = {}
        with mock.patch.object(cache_manager, "resolve_profile_modules", return_value=["phonepe_sigbypass"]), \
            mock.patch.object(cache_manager, "profile_build_modules") as build_modules_mock, \
            mock.patch.object(cache_manager, "profile_compile", return_value=Path("/tmp/build")), \
            mock.patch.object(cache_manager, "resolve_module_spec", return_value={"name": "phonepe_sigbypass", "log_tag": "SigBypass"}), \
            mock.patch.object(cache_manager, "resolve_test_serial", return_value="emulator-5554"), \
            mock.patch.object(cache_manager, "unified_test"):
            cache_manager.profile_test(manifest, "full", "", smoke=True)

        build_modules_mock.assert_called_once_with(manifest, "full")
```

**Step 2: Run test to verify it fails**

Run:
- `python3 -m unittest src/cache-manager/tests/test_smoke_mode.py -v`
- `python3 -m unittest src/cache-manager/tests/test_reuse_artifacts.py -v`

Expected: FAIL because build stage is not explicit yet.

**Step 3: Write minimal implementation**

Update flow:

```python
def profile_test(...):
    modules = resolve_profile_modules(manifest, profile_name)
    profile_build_modules(manifest, profile_name)
    work_dir = profile_compile(manifest, profile_name, reuse_artifacts=True)
    ...
```

Update smoke helper:

```bash
python3 src/cache-manager/cache_manager.py profile "$PROFILE_NAME" test --smoke
```

README must describe new flow:
- `pre-cache`
- `build-modules`
- `inject`
- `compile`
- `test`

**Step 4: Run test to verify it passes**

Run:
- `python3 -m unittest src/cache-manager/tests/test_smoke_mode.py -v`
- `python3 -m unittest src/cache-manager/tests/test_reuse_artifacts.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add src/cache-manager/cache_manager.py src/tools/test_profile_smoke.sh src/cache-manager/README.md src/cache-manager/tests/test_smoke_mode.py src/cache-manager/tests/test_reuse_artifacts.py
git commit -m "feat: run unified module build stage before profile packaging"
```

### Task 11: Remove obsolete compatibility build paths after parity verification

**Files:**
- Modify: `src/cache-manager/cache_manager.py`
- Modify: `src/cache-manager/README.md`
- Modify: `src/tools/README.md`
- Optionally delete: legacy compatibility-only docs/scripts if unreferenced

**Step 1: Write the failing audit checklist**

Create a checklist in the commit message draft or local notes:

```text
[ ] No profile path calls module-local compile during injection
[ ] No https profile path requires gradle demo apk build
[ ] No profile path depends on --skip-build compatibility flag
[ ] README matches actual orchestrator stages
```

**Step 2: Run repo search to verify old flow references**

Run: `rg -n 'skip-build|build_and_install.sh build|强制构建 demo APK|先运行编译' src/cache-manager src/tools src/signature_bypass src/https_interceptor src/phonepehelper -S`

Expected: only legacy docs or intentionally retained compatibility references remain.

**Step 3: Remove minimal obsolete code**

Delete or simplify:
- `skip_build` orchestration branches no longer needed for profile path
- compatibility comments that describe per-module implicit build
- stale docs claiming smoke skips work it still performs

**Step 4: Run tests to verify it passes**

Run:
- `python3 -m unittest src/cache-manager/tests/test_module_artifact_planning.py -v`
- `python3 -m unittest src/cache-manager/tests/test_module_artifact_cache.py -v`
- `python3 -m unittest src/cache-manager/tests/test_smoke_mode.py -v`
- `python3 -m unittest src/cache-manager/tests/test_reuse_artifacts.py -v`

Expected: PASS

**Step 5: Commit**

```bash
git add src/cache-manager/cache_manager.py src/cache-manager/README.md src/tools/README.md src/signature_bypass src/https_interceptor src/phonepehelper
git commit -m "refactor: remove obsolete per-module profile build paths"
```

### Task 12: Run end-to-end verification and document migration results

**Files:**
- Modify: `src/cache-manager/README.md`
- Modify: `src/tools/README.md`
- Create: `docs/plans/2026-03-23-unified-orchestrator-build-verification.md`

**Step 1: Write the verification checklist**

```markdown
- `profile full pre-cache`
- `profile full build-modules`
- `profile full compile`
- `profile full test --smoke`
- `profile full test`
- repeat `profile full test --smoke` and confirm cache hits
```

**Step 2: Run verification commands**

Run:

```bash
python3 src/cache-manager/cache_manager.py profile full pre-cache
python3 src/cache-manager/cache_manager.py profile full build-modules
python3 src/cache-manager/cache_manager.py profile full compile
python3 src/cache-manager/cache_manager.py profile full test --smoke --serial emulator-5554
python3 src/cache-manager/cache_manager.py profile full test --serial emulator-5554
python3 src/cache-manager/cache_manager.py profile full test --smoke --serial emulator-5554
```

Expected:
- first build populates `cache/module_artifacts/*`
- second smoke run shows cache hits for unchanged modules and final APK reuse

**Step 3: Write minimal verification report**

Record:
- before/after wall clock time
- which module builders were reused
- whether final APK reuse hit
- any remaining unavoidable bottlenecks

**Step 4: Update docs**

Document the new canonical commands in:
- `src/cache-manager/README.md`
- `src/tools/README.md`

**Step 5: Commit**

```bash
git add docs/plans/2026-03-23-unified-orchestrator-build-verification.md src/cache-manager/README.md src/tools/README.md
git commit -m "docs: record unified orchestrator verification results"
```
