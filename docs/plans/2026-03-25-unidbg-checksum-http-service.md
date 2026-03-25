# Unidbg Checksum HTTP Service Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose Scheme 3 unidbg checksum generation behind a local HTTP service with `/health`, `/checksum`, and `/validate`.

**Architecture:** Add a small Java HTTP server under the existing unidbg PoC module. The server will wrap the existing `run_probe.sh` flow so it reuses the current extraction, APK targeting, and adb-assisted defaults. Validation logic stays in-process and checks the generated checksum's Base64/decoded structure against the relaxed success gate.

**Tech Stack:** Java 11, `com.sun.net.httpserver.HttpServer`, existing Maven exec plugin, existing `run_probe.sh`.

---

### Task 1: Add a failing smoke check

**Files:**
- Create: `src/research/unidbg_checksum_poc/scripts/test_http_service.sh`

**Step 1: Write the failing check**

Create a shell smoke test that:
- calls `GET /health`
- calls `POST /checksum`
- asserts `.ok == true`
- asserts `structureOk == true`

**Step 2: Run it to verify it fails**

Run: `src/research/unidbg_checksum_poc/scripts/test_http_service.sh`
Expected: fail with connection refused because the service does not exist yet.

### Task 2: Implement the HTTP wrapper

**Files:**
- Create: `src/research/unidbg_checksum_poc/src/main/java/com/navpay/phonepe/unidbg/ChecksumHttpService.java`
- Modify: `src/research/unidbg_checksum_poc/pom.xml`

**Step 1: Add a small HTTP server**

Implement:
- `GET /health`
- `POST /checksum`
- `POST /validate`

**Step 2: Reuse the current generator**

Invoke `src/research/unidbg_checksum_poc/scripts/run_probe.sh` from Java, parse the `key=value` report, and return:
- `checksum`
- `length`
- `decodedLength`
- `mode`
- `structureOk`

**Step 3: Add a dedicated main class launch path**

Keep the existing probe main as default, but allow `mvn exec:java -Dexec.mainClass=...ChecksumHttpService`.

### Task 3: Add launch and verification scripts

**Files:**
- Create: `src/research/unidbg_checksum_poc/scripts/start_http_service.sh`
- Create: `src/research/unidbg_checksum_poc/scripts/test_http_service.sh`
- Modify: `src/research/unidbg_checksum_poc/README.md`

**Step 1: Add a startup script**

Start the service on a configurable local port, default `19190`.

**Step 2: Add a smoke test**

Call the service and fail if:
- HTTP returns non-200
- `ok != true`
- `structureOk != true`

**Step 3: Document manual verification**

Add exact `curl` commands for:
- `/health`
- `/checksum`
- `/validate`

### Task 4: Verify end-to-end

**Files:**
- Modify: `docs/checksum_service_scheme3_research.md`

**Step 1: Compile**

Run: `mvn -f src/research/unidbg_checksum_poc/pom.xml -q -DskipTests compile`

**Step 2: Start service**

Run: `src/research/unidbg_checksum_poc/scripts/start_http_service.sh`

**Step 3: Run smoke test**

Run: `src/research/unidbg_checksum_poc/scripts/test_http_service.sh`
Expected: pass.

**Step 4: Record final usage**

Document the HTTP interface and success criterion in the research doc.
