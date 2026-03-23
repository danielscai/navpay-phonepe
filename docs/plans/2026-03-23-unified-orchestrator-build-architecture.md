# Unified Orchestrator Build Architecture

**Status:** Proposed target architecture for the unified profile build pipeline.

## Scope

This repository keeps module source code split by directory, but the build flow is orchestrated as one pipeline. `cache_manager.py` remains the primary orchestrator for profile planning, cache reuse, module artifact build, workspace injection, final APK packaging, and smoke/full testing.

The main migration goal is to remove hidden module-local compilation during injection. Injection should consume prebuilt module artifacts only. In particular, `https_interceptor` should stop depending on the demo APK build-and-reverse-engineer loop and move toward direct smali artifact generation.

## Module Contract

Each module must declare the metadata needed for orchestration instead of hiding build logic inside `inject.sh`.

Required module fields:

- `sources`: the files and directories that define the module's build inputs.
- `builder`: the executable or script used to produce module artifacts.
- `outputs`: the artifact paths consumed by injection.
- `patches`: the target files or file patterns that the module modifies inside the shared workspace.
- `entrypoints`: the classes or methods injected into the PhonePe workspace.

Module rules:

- Module source code may stay in separate directories.
- Module build logic must be explicit and discoverable from the manifest.
- Injection scripts must not compile sources implicitly.
- Module build output must be stable enough for cache hits and reproducible injection.

## Artifact Contract

Each module produces a standardized artifact directory under:

```text
cache/module_artifacts/<module_name>/
```

Minimum artifact contents:

- `manifest.json`: module identity, builder type, output list, and source fingerprint.
- `fingerprints.json`: the file-level fingerprint inputs used to determine whether the artifact is stale.
- `smali/`: generated smali files when the module contributes new classes.
- `libs/`: native or supporting libraries when needed.
- `patches.json`: optional declarative patch metadata for the injector.

Artifact rules:

- The orchestrator owns artifact freshness checks.
- Builders write artifacts once, then injectors consume them read-only.
- Artifact reuse must be based on declared inputs, not on whether a build directory happens to exist.

## Injection Contract

Injection is a pure composition step that mutates the shared decompiled workspace. It may copy files, rewrite existing smali, and apply manifest/resource patches, but it must not invoke compilation pipelines on its own.

Injection must accept:

- `workspace_dir`: the profile workspace produced from the decompiled baseline.
- `artifact_dir`: the module artifact directory produced by the orchestrator.

Injection rules:

- No module-local `javac`, `d8`, `apktool`, Gradle, or reverse-engineering build steps may run during injection.
- Injection order is controlled by the orchestrator, not by module scripts.
- If an artifact is missing or stale, the orchestrator rebuilds it before injection.

## Orchestrator Stages

The orchestrator should expose a clear, sequential pipeline:

1. `prepare-workspace`
   - Copy the decompiled baseline into a writable profile workspace.
   - Validate that the selected profile has no conflicting patch targets.

2. `build-modules`
   - Resolve the profile module list in declared order.
   - Build only stale module artifacts.
   - Persist artifact manifests and fingerprints.

3. `inject-modules`
   - Apply each module's artifacts to the shared workspace in profile order.
   - Ensure each module only consumes its own artifacts.

4. `package-apk`
   - Run the final `apktool b`, `zipalign`, and `apksigner` sequence once.
   - Produce the final signed APK from the fully patched workspace.

5. `test-apk`
   - Install the final APK once.
   - Run smoke or full verification against the installed package.

## Current Repository Reality

- `cache_manager.py` remains the top-level orchestrator and compatibility layer for profile workflows.
- `signature_bypass` already has a more direct build path, but it still needs to become a clean artifact producer instead of an implicit build step during injection.
- `phonepehelper` still compiles inside its inject flow and should be split into a builder plus a pure injector.
- `https_interceptor` is the highest-value migration target because its current flow builds a demo APK, reverse-engineers it back to smali, and then injects that smali into the PhonePe workspace.

## Non-Goals

- Do not collapse module source directories into one directory.
- Do not remove `cache_manager` during this migration.
- Do not keep module-local hidden compilation in the long-term injection path.
- Do not require the final APK to be rebuilt multiple times for separate module stages.
