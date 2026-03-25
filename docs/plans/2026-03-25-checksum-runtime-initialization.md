# Checksum Runtime Initialization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a one-time initialization flow that extracts checksum runtime dependencies from an APK into `src/services/checksum/runtime/`, so normal service startup and tests no longer depend on an APK file.

**Architecture:** Introduce a checked-in runtime bundle under `src/services/checksum/runtime/` containing the required native libraries, extracted signing certificate bytes, and a manifest describing the source APK. Split the current APK-based behavior into two phases: `checksum:init` performs extraction from APK, while `checksum:start` and checksum regression tests consume only the prepared runtime files. Preserve an explicit override path for research/debugging, but make runtime-file loading the default path.

**Tech Stack:** Bash, Java 11, Maven, JUnit 5, unidbg, `unzip`, standard JDK file APIs

---

### Task 1: Define the runtime bundle contract

**Files:**
- Create: `src/services/checksum/runtime/.gitkeep`
- Create: `src/services/checksum/runtime/lib/arm64-v8a/.gitkeep`
- Create: `src/services/checksum/runtime/manifest.example.json`
- Modify: `src/services/checksum/README.md`
- Modify: `src/services/checksum/TECHNICAL.md`

**Step 1: Write the failing documentation/test expectation**

Add a new JUnit test file that asserts the runtime contract can be resolved from a fixed repository layout:

```java
package com.navpay.phonepe.unidbg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.nio.file.Path;
import org.junit.jupiter.api.Test;

final class ChecksumRuntimeLayoutTest {

    @Test
    void runtimeLayoutDefaultsToServiceRuntimeDirectory() throws Exception {
        Path repoRoot = ChecksumFixtureLoader.findRepoRoot();
        Path runtimeRoot = ChecksumRuntimePaths.resolveRuntimeRoot(repoRoot);
        assertEquals(repoRoot.resolve("src/services/checksum/runtime"), runtimeRoot);
    }

    @Test
    void runtimeLayoutRejectsMissingManifest() {
        assertThrows(IllegalStateException.class, () ->
                ChecksumRuntimePaths.validatePreparedRuntime(Path.of("/tmp/navpay-missing-runtime")));
    }
}
```

Target file: `src/services/checksum/src/test/java/com/navpay/phonepe/unidbg/ChecksumRuntimeLayoutTest.java`

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/services/checksum
mvn -Dtest=ChecksumRuntimeLayoutTest test
```

Expected: FAIL because `ChecksumRuntimePaths` does not exist yet.

**Step 3: Write minimal implementation**

Create `src/services/checksum/src/main/java/com/navpay/phonepe/unidbg/ChecksumRuntimePaths.java` with:

- `resolveRepoRoot(Path start)`
- `resolveRuntimeRoot(Path repoRoot)`
- `runtimeManifest(Path runtimeRoot)`
- `runtimeSignature(Path runtimeRoot)`
- `runtimeLib(Path runtimeRoot, String libName)`
- `validatePreparedRuntime(Path runtimeRoot)`

Validation should require:

- `manifest.json`
- `signature.bin`
- `libphonepe-cryptography-support-lib.so`
- `liba41935.so`
- `libc++_shared.so`

**Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/services/checksum
mvn -Dtest=ChecksumRuntimeLayoutTest test
```

Expected: PASS.

**Step 5: Update docs for the new contract**

Document this runtime layout in:

- `src/services/checksum/README.md`
- `src/services/checksum/TECHNICAL.md`

Include:

- the purpose of `src/services/checksum/runtime/`
- which files are checked in
- that startup no longer reads APK by default

**Step 6: Commit**

```bash
git add src/services/checksum/runtime/.gitkeep \
  src/services/checksum/runtime/lib/arm64-v8a/.gitkeep \
  src/services/checksum/runtime/manifest.example.json \
  src/services/checksum/src/main/java/com/navpay/phonepe/unidbg/ChecksumRuntimePaths.java \
  src/services/checksum/src/test/java/com/navpay/phonepe/unidbg/ChecksumRuntimeLayoutTest.java \
  src/services/checksum/README.md \
  src/services/checksum/TECHNICAL.md
git commit -m "feat: define checksum runtime bundle layout"
```

### Task 2: Add APK-to-runtime initialization command

**Files:**
- Create: `src/services/checksum/scripts/init_runtime.sh`
- Create: `src/services/checksum/src/test/java/com/navpay/phonepe/unidbg/ChecksumRuntimeInitScriptTest.java`
- Modify: `package.json`
- Modify: `src/services/checksum/README.md`

**Step 1: Write the failing test**

Create a script-level test that invokes the init script with a bad APK path and asserts the error is explicit:

```java
package com.navpay.phonepe.unidbg;

import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

final class ChecksumRuntimeInitScriptTest {

    @Test
    void initScriptFailsFastWhenApkIsMissing() throws Exception {
        Path repoRoot = ChecksumFixtureLoader.findRepoRoot();
        Process process = new ProcessBuilder("bash",
                repoRoot.resolve("src/services/checksum/scripts/init_runtime.sh").toString(),
                "/tmp/navpay-missing.apk")
                .directory(repoRoot.toFile())
                .redirectErrorStream(true)
                .start();

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (InputStream in = process.getInputStream()) {
            in.transferTo(out);
        }

        int exit = process.waitFor();
        String output = out.toString(StandardCharsets.UTF_8);
        assertNotEquals(0, exit);
        assertTrue(output.contains("missing apk"));
    }
}
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/services/checksum
mvn -Dtest=ChecksumRuntimeInitScriptTest test
```

Expected: FAIL because `init_runtime.sh` does not exist yet.

**Step 3: Write minimal implementation**

Create `src/services/checksum/scripts/init_runtime.sh` that:

- accepts an APK path as `$1`, otherwise falls back to `PROBE_TARGET_APK`
- validates the APK exists
- creates:
  - `src/services/checksum/runtime/lib/arm64-v8a/`
  - `src/services/checksum/runtime/signature.bin`
  - `src/services/checksum/runtime/manifest.json`
- extracts:
  - `libphonepe-cryptography-support-lib.so`
  - `liba41935.so`
  - `libc++_shared.so`
- runs a Java helper to extract the first signing certificate into `signature.bin`
- writes manifest fields:
  - source APK absolute path
  - source APK SHA-256
  - extraction timestamp
  - extracted library names
  - signature byte length

Add `checksum:init` to `package.json`:

```json
"checksum:init": "src/services/checksum/scripts/init_runtime.sh"
```

**Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/services/checksum
mvn -Dtest=ChecksumRuntimeInitScriptTest test
```

Expected: PASS.

**Step 5: Add operator documentation**

Update `src/services/checksum/README.md` with:

- `yarn checksum:init /absolute/path/to/patched_signed.apk`
- expected files written into `src/services/checksum/runtime/`
- rerun procedure after APK updates

**Step 6: Commit**

```bash
git add package.json \
  src/services/checksum/scripts/init_runtime.sh \
  src/services/checksum/src/test/java/com/navpay/phonepe/unidbg/ChecksumRuntimeInitScriptTest.java \
  src/services/checksum/README.md
git commit -m "feat: add checksum runtime initialization flow"
```

### Task 3: Add a Java helper to extract signature and emit runtime metadata

**Files:**
- Create: `src/services/checksum/src/main/java/com/navpay/phonepe/unidbg/ChecksumRuntimeInitializer.java`
- Create: `src/services/checksum/src/test/java/com/navpay/phonepe/unidbg/ChecksumRuntimeInitializerTest.java`
- Modify: `src/services/checksum/src/main/java/com/navpay/phonepe/unidbg/ApkSignatureExtractor.java`

**Step 1: Write the failing test**

Create a unit test for manifest writing and signature persistence:

```java
package com.navpay.phonepe.unidbg;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

final class ChecksumRuntimeInitializerTest {

    @Test
    void writesSignatureAndManifestIntoRuntimeDirectory() throws Exception {
        Path tempDir = Files.createTempDirectory("checksum-runtime-init");
        byte[] signature = "test-signature".getBytes(StandardCharsets.UTF_8);

        ChecksumRuntimeInitializer.writeRuntimeArtifacts(
                tempDir,
                Path.of("/tmp/example.apk"),
                "abc123",
                signature,
                new String[]{"libphonepe-cryptography-support-lib.so", "liba41935.so", "libc++_shared.so"});

        assertArrayEquals(signature, Files.readAllBytes(tempDir.resolve("signature.bin")));
        String manifest = Files.readString(tempDir.resolve("manifest.json"));
        assertTrue(manifest.contains("\"apkSha256\":\"abc123\""));
        assertTrue(manifest.contains("\"signatureLength\":14"));
    }
}
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/services/checksum
mvn -Dtest=ChecksumRuntimeInitializerTest test
```

Expected: FAIL because `ChecksumRuntimeInitializer` does not exist.

**Step 3: Write minimal implementation**

Create `ChecksumRuntimeInitializer.java` with:

- `static byte[] extractSignature(Path apkPath)`
- `static String sha256(Path apkPath)`
- `static void writeRuntimeArtifacts(Path runtimeRoot, Path apkPath, String apkSha256, byte[] signature, String[] libs)`
- `public static void main(String[] args)` for script use

Refactor `ApkSignatureExtractor` only as needed to share certificate extraction logic cleanly.

The manifest format should be plain JSON built without extra dependencies. Include:

```json
{
  "sourceApk": "/absolute/path/to/patched_signed.apk",
  "apkSha256": "...",
  "generatedAt": "2026-03-25T00:00:00Z",
  "signatureLength": 1234,
  "libraries": [
    "libphonepe-cryptography-support-lib.so",
    "liba41935.so",
    "libc++_shared.so"
  ]
}
```

**Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/services/checksum
mvn -Dtest=ChecksumRuntimeInitializerTest test
```

Expected: PASS.

**Step 5: Hook the script to the Java helper**

Update `src/services/checksum/scripts/init_runtime.sh` to call:

```bash
mvn -f "${SERVICE_DIR}/pom.xml" -q -DskipTests compile
mvn -f "${SERVICE_DIR}/pom.xml" -q -DskipTests exec:java \
  -Dexec.mainClass=com.navpay.phonepe.unidbg.ChecksumRuntimeInitializer \
  -Dexec.args="init ${APK} ${RUNTIME_DIR}"
```

**Step 6: Commit**

```bash
git add src/services/checksum/src/main/java/com/navpay/phonepe/unidbg/ChecksumRuntimeInitializer.java \
  src/services/checksum/src/main/java/com/navpay/phonepe/unidbg/ApkSignatureExtractor.java \
  src/services/checksum/src/test/java/com/navpay/phonepe/unidbg/ChecksumRuntimeInitializerTest.java \
  src/services/checksum/scripts/init_runtime.sh
git commit -m "feat: persist checksum runtime metadata"
```

### Task 4: Switch service startup from APK-based loading to runtime-based loading

**Files:**
- Create: `src/services/checksum/src/test/java/com/navpay/phonepe/unidbg/ChecksumRuntimeConfigTest.java`
- Modify: `src/services/checksum/src/main/java/com/navpay/phonepe/unidbg/ChecksumHttpService.java`
- Modify: `src/services/checksum/src/main/java/com/navpay/phonepe/unidbg/UnidbgChecksumProbe.java`
- Modify: `src/services/checksum/scripts/start_http_service.sh`
- Modify: `src/services/checksum/scripts/run_probe.sh`

**Step 1: Write the failing test**

Create a unit test that verifies the runtime files are preferred over APK inputs:

```java
package com.navpay.phonepe.unidbg;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

final class ChecksumRuntimeConfigTest {

    @Test
    void runtimeSignatureOverridesApkLookup() throws Exception {
        Path runtimeRoot = Files.createTempDirectory("checksum-runtime");
        Files.createDirectories(runtimeRoot.resolve("lib/arm64-v8a"));
        Files.write(runtimeRoot.resolve("signature.bin"), new byte[]{1, 2, 3});
        Files.writeString(runtimeRoot.resolve("manifest.json"), "{}");
        Files.write(runtimeRoot.resolve("lib/arm64-v8a/libphonepe-cryptography-support-lib.so"), new byte[]{1});
        Files.write(runtimeRoot.resolve("lib/arm64-v8a/liba41935.so"), new byte[]{1});
        Files.write(runtimeRoot.resolve("lib/arm64-v8a/libc++_shared.so"), new byte[]{1});

        assertEquals(runtimeRoot.resolve("signature.bin"),
                ChecksumRuntimePaths.runtimeSignature(runtimeRoot));
    }
}
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/services/checksum
mvn -Dtest=ChecksumRuntimeConfigTest test
```

Expected: FAIL because startup and probe code still require APK-oriented configuration.

**Step 3: Write minimal implementation**

Refactor startup flow so it defaults to `src/services/checksum/runtime/`:

- `ChecksumHttpService.main(...)`
  - resolve repo root
  - validate `runtime/`
  - compute `libPath` from `runtime/lib/arm64-v8a/libphonepe-cryptography-support-lib.so`
  - pass runtime root into the service instead of APK path

- `ChecksumHttpService`
  - replace `apkPath` field with `runtimeRoot`
  - expose runtime location in startup logs

- `UnidbgChecksumProbe`
  - add `probe.runtime.root` / `PROBE_RUNTIME_ROOT`
  - add `probe.signature.file` / `PROBE_SIGNATURE_FILE`
  - resolve signature bytes from `signature.bin` first
  - keep APK fallback only for explicit research/debug use
  - stop requiring `extractLibraryOnce(...)` in the default path

- `run_probe.sh`
  - default to runtime library path
  - stop unzipping APK unless an explicit APK-based override is requested

- `start_http_service.sh`
  - fail fast if runtime files are missing
  - stop checking for APK existence

**Step 4: Run targeted tests to verify they pass**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/services/checksum
mvn -Dtest=ChecksumRuntimeLayoutTest,ChecksumRuntimeInitScriptTest,ChecksumRuntimeInitializerTest,ChecksumRuntimeConfigTest test
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/services/checksum/src/main/java/com/navpay/phonepe/unidbg/ChecksumHttpService.java \
  src/services/checksum/src/main/java/com/navpay/phonepe/unidbg/UnidbgChecksumProbe.java \
  src/services/checksum/src/test/java/com/navpay/phonepe/unidbg/ChecksumRuntimeConfigTest.java \
  src/services/checksum/scripts/start_http_service.sh \
  src/services/checksum/scripts/run_probe.sh
git commit -m "refactor: load checksum runtime from prepared files"
```

### Task 5: Move regression tests from APK dependency to runtime dependency

**Files:**
- Modify: `src/services/checksum/src/test/java/com/navpay/phonepe/unidbg/ChecksumFixtureLoader.java`
- Modify: `src/services/checksum/src/test/java/com/navpay/phonepe/unidbg/ChecksumHttpServiceRealFixtureTest.java`
- Create: `src/services/checksum/src/test/java/com/navpay/phonepe/unidbg/ChecksumPreparedRuntimeTest.java`

**Step 1: Write the failing regression test**

Add a test that requires prepared runtime and skips only when runtime is absent:

```java
package com.navpay.phonepe.unidbg;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.nio.file.Path;
import org.junit.jupiter.api.Test;

final class ChecksumPreparedRuntimeTest {

    @Test
    void preparedRuntimeCanBeResolvedForRegressionTests() throws Exception {
        Path repoRoot = ChecksumFixtureLoader.findRepoRoot();
        Path runtimeRoot = ChecksumRuntimePaths.resolveRuntimeRoot(repoRoot);
        assumeTrue(runtimeRoot.toFile().isDirectory(), "prepared runtime directory missing");
        ChecksumRuntimePaths.validatePreparedRuntime(runtimeRoot);
        assertTrue(runtimeRoot.resolve("signature.bin").toFile().isFile());
    }
}
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/services/checksum
mvn -Dtest=ChecksumPreparedRuntimeTest,ChecksumHttpServiceRealFixtureTest test
```

Expected: FAIL because the fixture loader and real fixture test still resolve APK paths.

**Step 3: Write minimal implementation**

Refactor test support:

- `ChecksumFixtureLoader`
  - replace APK-specific helpers with runtime-specific helpers
  - keep `findRepoRoot()`
  - add `resolvePreparedRuntimeRoot()`
  - add `hasExplicitRuntimeOverride()`

- `ChecksumHttpServiceRealFixtureTest`
  - construct the service from prepared runtime files
  - only skip when runtime is absent and no explicit override was given

Recommended env/property names:

- `probe.runtime.root` / `PROBE_RUNTIME_ROOT`

**Step 4: Run regression tests to verify they pass**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/services/checksum
mvn -Dtest=ChecksumPreparedRuntimeTest,ChecksumHttpServiceRealFixtureTest test
```

Expected: PASS when runtime is prepared; SKIP with explicit message when runtime is absent and no override is set.

**Step 5: Commit**

```bash
git add src/services/checksum/src/test/java/com/navpay/phonepe/unidbg/ChecksumFixtureLoader.java \
  src/services/checksum/src/test/java/com/navpay/phonepe/unidbg/ChecksumHttpServiceRealFixtureTest.java \
  src/services/checksum/src/test/java/com/navpay/phonepe/unidbg/ChecksumPreparedRuntimeTest.java
git commit -m "test: use prepared runtime for checksum regression tests"
```

### Task 6: Update operator docs and end-to-end verification flow

**Files:**
- Modify: `src/services/checksum/README.md`
- Modify: `src/services/checksum/TECHNICAL.md`
- Modify: `docs/checksum_service_integration.md`
- Modify: `docs/checksum_api.md`
- Modify: `docs/checksum_service_scheme3_solution.md`

**Step 1: Write the failing acceptance checklist**

Create a written checklist in the plan execution notes and verify each command is documented:

- initialize runtime from APK
- inspect manifest
- start service without APK
- run checksum regression tests without APK

If any command is undocumented, treat that as the failing condition for this task.

**Step 2: Run documentation gap check**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe
rg -n "checksum:init|runtime/manifest.json|PROBE_RUNTIME_ROOT|no longer depend on APK" \
  src/services/checksum/README.md \
  src/services/checksum/TECHNICAL.md \
  docs/checksum_service_integration.md \
  docs/checksum_api.md \
  docs/checksum_service_scheme3_solution.md
```

Expected: insufficient matches before documentation updates.

**Step 3: Write minimal documentation updates**

Update docs to describe:

- initialization command:

```bash
yarn checksum:init /absolute/path/to/patched_signed.apk
```

- routine startup:

```bash
yarn checksum:start
```

- regression test flow:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/services/checksum
mvn test
```

- update workflow after APK changes:
  1. rerun `checksum:init`
  2. inspect `src/services/checksum/runtime/manifest.json`
  3. run checksum tests

**Step 4: Run documentation gap check again**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe
rg -n "checksum:init|runtime/manifest.json|PROBE_RUNTIME_ROOT|no longer depend on APK" \
  src/services/checksum/README.md \
  src/services/checksum/TECHNICAL.md \
  docs/checksum_service_integration.md \
  docs/checksum_api.md \
  docs/checksum_service_scheme3_solution.md
```

Expected: matches in all intended docs.

**Step 5: Run final verification**

Run:

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe
yarn checksum:init /absolute/path/to/patched_signed.apk
yarn checksum:start
```

In another shell:

```bash
curl -sS http://127.0.0.1:19190/health
curl -sS http://127.0.0.1:19190/checksum \
  -H 'Content-Type: application/json' \
  -d '{"path":"/apis/tstore/v2/units/changes","body":"","uuid":"8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001"}'
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/services/checksum
mvn test
```

Expected:

- `checksum:init` populates runtime files and manifest
- `checksum:start` succeeds with runtime-only inputs
- `/health` returns `ok=true`
- `/checksum` returns `structureOk=true`
- Maven tests pass or cleanly skip only where documented

**Step 6: Commit**

```bash
git add src/services/checksum/README.md \
  src/services/checksum/TECHNICAL.md \
  docs/checksum_service_integration.md \
  docs/checksum_api.md \
  docs/checksum_service_scheme3_solution.md \
  src/services/checksum/runtime
git commit -m "docs: document checksum runtime initialization workflow"
```
