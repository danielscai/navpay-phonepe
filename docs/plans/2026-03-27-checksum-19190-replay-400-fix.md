# Checksum 19190 Replay 400 Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 定位并修复 `19190` 端口 checksum HTTP 服务在真实拦截日志重放场景下导致下游返回 `400` 的问题。

**Architecture:** 问题聚焦在 `ChecksumHttpService` 的 HTTP JSON 解析路径，而不是 unidbg 算法本身。先用回归测试锁定“HTTP 请求体反转义不正确导致 checksum 输入失真”的缺陷，再最小化修复 `unescapeJson`，最后通过单测 + real fixture 脚本回归确认 `19190` 输出稳定且可被下游接受。

**Tech Stack:** Java 11, Maven (Surefire + JUnit 5), bash scripts, existing checksum runtime fixtures.

---

### Task 1: 用失败测试复现 19190 的请求体解析偏差

**Files:**
- Create: `src/services/checksum/src/test/java/com/navpay/phonepe/unidbg/ChecksumHttpServiceJsonParsingTest.java`
- Test: `src/services/checksum/src/test/resources/fixtures/phonepe_intercept_replay.json`

**Step 1: Write the failing test**

```java
package com.navpay.phonepe.unidbg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class ChecksumHttpServiceJsonParsingTest {

    @Test
    void parseJsonBodyShouldDecodeUnicodeEscapesInBodyField() throws Exception {
        String fixture = Files.readString(Path.of(
                "src/test/resources/fixtures/phonepe_intercept_replay.json"),
                StandardCharsets.UTF_8);
        String rawBody = extractJsonString(fixture, "body");
        String wrapped = "{\"path\":\"/apis/chimera/pz/v1/whitelisted/Auth/evaluate/bulk\","
                + "\"uuid\":\"8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001\","
                + "\"body\":\"" + rawBody.replace("\\", "\\\\").replace("\"", "\\\"") + "\"}";

        Method parseJsonBody = ChecksumHttpService.class.getDeclaredMethod("parseJsonBody", String.class);
        parseJsonBody.setAccessible(true);

        @SuppressWarnings("unchecked")
        Map<String, String> parsed = (Map<String, String>) parseJsonBody.invoke(null, wrapped);

        assertTrue(parsed.get("body").contains("rc##ipnCountriesMetaData=csv1::"));
        assertEquals("/apis/chimera/pz/v1/whitelisted/Auth/evaluate/bulk", parsed.get("path"));
    }

    private static String extractJsonString(String json, String field) {
        String marker = "\"" + field + "\"";
        int key = json.indexOf(marker);
        int colon = json.indexOf(':', key);
        int start = json.indexOf('"', colon + 1) + 1;
        int i = start;
        StringBuilder out = new StringBuilder();
        while (i < json.length()) {
            char c = json.charAt(i++);
            if (c == '\\') {
                out.append('\\').append(json.charAt(i++));
                continue;
            }
            if (c == '"') {
                break;
            }
            out.append(c);
        }
        return out.toString();
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cd src/services/checksum && mvn -Dtest=ChecksumHttpServiceJsonParsingTest test`
Expected: FAIL，`parsed.get("body")` 仍保留 `\u003d` 文本而不是 `=`，或者断言字符串不包含 `rc##ipnCountriesMetaData=csv1::`。

**Step 3: Commit**

```bash
git add src/services/checksum/src/test/java/com/navpay/phonepe/unidbg/ChecksumHttpServiceJsonParsingTest.java
git commit -m "test(checksum): reproduce unicode-unescape mismatch in http parser"
```

### Task 2: 最小修复 JSON 反转义，保证 HTTP 路径与真实请求一致

**Files:**
- Modify: `src/services/checksum/src/main/java/com/navpay/phonepe/unidbg/ChecksumHttpService.java`
- Test: `src/services/checksum/src/test/java/com/navpay/phonepe/unidbg/ChecksumHttpServiceJsonParsingTest.java`

**Step 1: Write the failing test for escape coverage**

在 `ChecksumHttpServiceJsonParsingTest` 新增第二个测试，覆盖 `\/`, `\t`, `\b`, `\f`, `\uXXXX`。

```java
@Test
void parseJsonBodyShouldDecodeStandardJsonEscapes() throws Exception {
    String json = "{\"path\":\"/a\\/b\",\"body\":\"line1\\nline2\\t\\u003d\\u4e2d\",\"uuid\":\"u\"}";

    Method parseJsonBody = ChecksumHttpService.class.getDeclaredMethod("parseJsonBody", String.class);
    parseJsonBody.setAccessible(true);

    @SuppressWarnings("unchecked")
    Map<String, String> parsed = (Map<String, String>) parseJsonBody.invoke(null, json);

    assertEquals("/a/b", parsed.get("path"));
    assertEquals("line1\nline2\t=中", parsed.get("body"));
}
```

**Step 2: Run test to verify it fails**

Run: `cd src/services/checksum && mvn -Dtest=ChecksumHttpServiceJsonParsingTest test`
Expected: FAIL，`unescapeJson` 当前不支持 `\/` 和 `\uXXXX`。

**Step 3: Write minimal implementation**

将 `ChecksumHttpService.unescapeJson` 改为逐字符解析，支持标准 JSON 转义。

```java
private static String unescapeJson(String value) {
    StringBuilder out = new StringBuilder(value.length());
    for (int i = 0; i < value.length(); i++) {
        char c = value.charAt(i);
        if (c != '\\') {
            out.append(c);
            continue;
        }
        if (i + 1 >= value.length()) {
            out.append('\\');
            break;
        }
        char next = value.charAt(++i);
        switch (next) {
            case '"': out.append('"'); break;
            case '\\': out.append('\\'); break;
            case '/': out.append('/'); break;
            case 'b': out.append('\b'); break;
            case 'f': out.append('\f'); break;
            case 'n': out.append('\n'); break;
            case 'r': out.append('\r'); break;
            case 't': out.append('\t'); break;
            case 'u':
                if (i + 4 >= value.length()) {
                    throw new IllegalArgumentException("invalid unicode escape in request json");
                }
                String hex = value.substring(i + 1, i + 5);
                out.append((char) Integer.parseInt(hex, 16));
                i += 4;
                break;
            default:
                out.append(next);
                break;
        }
    }
    return out.toString();
}
```

**Step 4: Run test to verify it passes**

Run: `cd src/services/checksum && mvn -Dtest=ChecksumHttpServiceJsonParsingTest test`
Expected: PASS。

**Step 5: Commit**

```bash
git add src/services/checksum/src/main/java/com/navpay/phonepe/unidbg/ChecksumHttpService.java src/services/checksum/src/test/java/com/navpay/phonepe/unidbg/ChecksumHttpServiceJsonParsingTest.java
git commit -m "fix(checksum): decode unicode escapes in http json parser"
```

### Task 3: 回归 real fixture + HTTP service，确认 19190 修复有效

**Files:**
- Modify: `src/services/checksum/src/test/java/com/navpay/phonepe/unidbg/ChecksumHttpServiceRealFixtureTest.java`
- Test: `src/services/checksum/scripts/validate_real_fixture.sh`

**Step 1: Write the failing regression test (HTTP path)**

在 `ChecksumHttpServiceRealFixtureTest` 新增一个测试，走 `parseJsonBody` + `handleChecksum` 的 HTTP 近似路径，而不是仅直接调用 `handleChecksum`。

```java
@Test
void realFixtureThroughHttpParserKeepsStructureStable() throws Exception {
    ChecksumFixtureLoader.RealFixture fixture = ChecksumFixtureLoader.load();
    Path runtimeRoot = resolveRuntimeRootForTest();
    Object service = newService(runtimeRoot);

    Method parseJsonBody = ChecksumHttpService.class.getDeclaredMethod("parseJsonBody", String.class);
    parseJsonBody.setAccessible(true);

    String json = "{\"path\":\"" + escape(fixture.path()) + "\","
            + "\"body\":\"" + escape(fixture.body()) + "\","
            + "\"uuid\":\"" + FIXED_UUID + "\"}";

    @SuppressWarnings("unchecked")
    Map<String, String> request = (Map<String, String>) parseJsonBody.invoke(null, json);

    Method handleChecksum = ChecksumHttpService.class.getDeclaredMethod("handleChecksum", Map.class);
    handleChecksum.setAccessible(true);
    String response = (String) handleChecksum.invoke(service, request);

    assertTrue(response.contains("\"ok\":true"));
    assertTrue(response.contains("\"structureOk\":true"));
}
```

**Step 2: Run tests to verify pass**

Run: `cd src/services/checksum && mvn -Dtest=ChecksumHttpServiceJsonParsingTest,ChecksumHttpServiceRealFixtureTest test`
Expected: PASS。

**Step 3: Run script-level validation for running service**

Run: `cd src/services/checksum && bash scripts/validate_real_fixture.sh`
Expected: 输出和 `phonepe_intercept_replay.expected.json` 对齐，`ok=true` 且 `structureOk=true`。

**Step 4: Manual replay smoke check (19190)**

Run:

```bash
cd src/services/checksum
CHECKSUM_HTTP_PORT=19190 bash scripts/start_http_service.sh
```

然后在另一个终端重放同一条 admin intercept 请求（与页面 `tab=intercept_logs` 的 payload 一致），确认使用 `19190` 的 checksum 头后下游恢复 `200`。

Expected: 与 `19090` 对齐，不再出现 `400`。

**Step 5: Commit**

```bash
git add src/services/checksum/src/test/java/com/navpay/phonepe/unidbg/ChecksumHttpServiceRealFixtureTest.java
git commit -m "test(checksum): guard http parser path with real fixture"
```

### Task 4: 文档同步，防止后续回归

**Files:**
- Modify: `src/services/checksum/README.md`
- Modify: `docs/checksum_service_integration.md`

**Step 1: Write doc update**

在两份文档增加“HTTP 请求体必须按标准 JSON 反转义（特别是 `\uXXXX`）”的说明，并记录本次 `19190` 回归案例和验证命令。

建议新增片段：

```markdown
## Parser Compatibility Note

`/checksum` endpoint now decodes standard JSON escapes (`\n`, `\t`, `\/`, `\uXXXX`) before invoking unidbg.
This is required for real replay payloads exported from navpay-admin intercept logs.

Regression command:

```bash
cd src/services/checksum
mvn -Dtest=ChecksumHttpServiceJsonParsingTest,ChecksumHttpServiceRealFixtureTest test
bash scripts/validate_real_fixture.sh
```
```

**Step 2: Verify docs and tests together**

Run: `cd src/services/checksum && mvn test -DskipTests=false`
Expected: PASS。

**Step 3: Commit**

```bash
git add src/services/checksum/README.md docs/checksum_service_integration.md
git commit -m "docs(checksum): document json escape handling and regression checks"
```
