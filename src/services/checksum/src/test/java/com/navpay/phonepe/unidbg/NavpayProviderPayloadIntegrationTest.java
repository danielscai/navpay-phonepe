package com.navpay.phonepe.unidbg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import org.junit.jupiter.api.Test;

final class NavpayProviderPayloadIntegrationTest {

    @Test
    void providerPayloadShouldBeSimpleAndRequestMetaTokenMustExist() throws Exception {
        String adb = findAdb();
        if (adb == null) {
            return;
        }
        if (!isDeviceConnected(adb, "emulator-5554")) {
            return;
        }

        run(
                List.of(adb, "-s", "emulator-5554", "shell", "monkey", "-p", "com.phonepe.app",
                        "-c", "android.intent.category.LAUNCHER", "1"),
                Duration.ofSeconds(20));

        CommandOutput query = run(
                List.of(adb, "-s", "emulator-5554", "shell", "content", "query",
                        "--uri", "content://com.phonepe.navpay.provider/user_data"),
                Duration.ofSeconds(20));
        assertEquals(0, query.exitCode, "content query failed: " + query.output);
        assertTrue(!query.output.contains("Could not find provider"),
                "provider not found: " + query.output);

        String row = firstRowLine(query.output);
        assertTrue(!row.isEmpty(), "provider query should return at least one row");
        String payload = extractPayload(row);

        Set<String> keys = topLevelKeys(payload);
        assertEquals(Set.of("requestMeta", "upis", "collectedAtMs"), keys,
                "provider payload must keep simple source shape");

        String requestMetaJson = extractObject(payload, "requestMeta");
        assertTrue(requestMetaJson.contains("\"token\""),
                "requestMeta.token is required in provider payload");
    }

    private static String findAdb() throws Exception {
        CommandOutput which = run(List.of("which", "adb"), Duration.ofSeconds(5));
        if (which.exitCode != 0) {
            return null;
        }
        String adb = which.output.trim();
        return adb.isEmpty() ? null : adb;
    }

    private static boolean isDeviceConnected(String adb, String serial) throws Exception {
        CommandOutput devices = run(List.of(adb, "devices"), Duration.ofSeconds(5));
        return devices.output.contains(serial + "\tdevice");
    }

    private static String firstRowLine(String output) {
        for (String line : output.split("\n")) {
            String trimmed = line.trim();
            if (trimmed.startsWith("Row:")) return trimmed;
        }
        return "";
    }

    private static String extractPayload(String row) {
        int payloadStart = row.indexOf("payload=");
        int versionStart = row.lastIndexOf(", version=");
        if (payloadStart < 0 || versionStart < 0 || versionStart <= payloadStart + "payload=".length()) {
            throw new IllegalStateException("unable to parse payload from row: " + row);
        }
        return row.substring(payloadStart + "payload=".length(), versionStart).trim();
    }

    private static Set<String> topLevelKeys(String jsonObject) {
        Set<String> keys = new TreeSet<>();
        int depth = 0;
        boolean inString = false;
        boolean escaping = false;
        boolean readingKey = false;
        StringBuilder token = new StringBuilder();
        for (int i = 0; i < jsonObject.length(); i++) {
            char c = jsonObject.charAt(i);
            if (inString) {
                if (escaping) {
                    escaping = false;
                    if (readingKey) token.append(c);
                    continue;
                }
                if (c == '\\') {
                    escaping = true;
                    continue;
                }
                if (c == '"') {
                    inString = false;
                    if (readingKey) {
                        int j = skipSpaces(jsonObject, i + 1);
                        if (j < jsonObject.length() && jsonObject.charAt(j) == ':' && depth == 1) {
                            keys.add(token.toString());
                        }
                        token.setLength(0);
                        readingKey = false;
                    }
                    continue;
                }
                if (readingKey) token.append(c);
                continue;
            }

            if (c == '"') {
                inString = true;
                readingKey = true;
                token.setLength(0);
                continue;
            }
            if (c == '{') depth++;
            if (c == '}') depth--;
        }
        return keys;
    }

    private static int skipSpaces(String s, int idx) {
        int i = idx;
        while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
        return i;
    }

    private static String extractObject(String jsonObject, String key) {
        String marker = "\"" + key + "\"";
        int keyPos = jsonObject.indexOf(marker);
        if (keyPos < 0) return "";
        int colon = jsonObject.indexOf(':', keyPos + marker.length());
        if (colon < 0) return "";
        int start = skipSpaces(jsonObject, colon + 1);
        if (start >= jsonObject.length() || jsonObject.charAt(start) != '{') return "";
        int depth = 0;
        boolean inString = false;
        boolean escaping = false;
        for (int i = start; i < jsonObject.length(); i++) {
            char c = jsonObject.charAt(i);
            if (inString) {
                if (escaping) {
                    escaping = false;
                    continue;
                }
                if (c == '\\') {
                    escaping = true;
                    continue;
                }
                if (c == '"') {
                    inString = false;
                }
                continue;
            }
            if (c == '"') {
                inString = true;
                continue;
            }
            if (c == '{') depth++;
            if (c == '}') {
                depth--;
                if (depth == 0) return jsonObject.substring(start, i + 1);
            }
        }
        return "";
    }

    private static CommandOutput run(List<String> cmd, Duration timeout) throws IOException, InterruptedException {
        Process process = new ProcessBuilder(cmd).redirectErrorStream(true).start();
        boolean done = process.waitFor(timeout.toMillis(), java.util.concurrent.TimeUnit.MILLISECONDS);
        if (!done) {
            process.destroyForcibly();
            throw new IllegalStateException("command timeout: " + String.join(" ", cmd));
        }
        List<String> lines = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                lines.add(line);
            }
        }
        return new CommandOutput(process.exitValue(), String.join("\n", lines));
    }

    private static final class CommandOutput {
        final int exitCode;
        final String output;

        CommandOutput(int exitCode, String output) {
            this.exitCode = exitCode;
            this.output = output;
        }
    }
}
