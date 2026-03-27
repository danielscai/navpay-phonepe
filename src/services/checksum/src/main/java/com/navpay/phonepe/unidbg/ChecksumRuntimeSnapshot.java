package com.navpay.phonepe.unidbg;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class ChecksumRuntimeSnapshot {

    private static final Pattern JSON_STRING_FIELD =
            Pattern.compile("\"([^\"]+)\"\\s*:\\s*\"((?:\\\\.|[^\\\\\"])*)\"");
    private static final Pattern JSON_NUMBER_FIELD =
            Pattern.compile("\"([^\"]+)\"\\s*:\\s*(-?\\d+)");

    private final String deviceId;
    private final Long serverTimeOffsetMs;
    private final Long adjustedTimeMs;

    private ChecksumRuntimeSnapshot(String deviceId, Long serverTimeOffsetMs, Long adjustedTimeMs) {
        this.deviceId = deviceId == null ? "" : deviceId;
        this.serverTimeOffsetMs = serverTimeOffsetMs;
        this.adjustedTimeMs = adjustedTimeMs;
    }

    static ChecksumRuntimeSnapshot empty() {
        return new ChecksumRuntimeSnapshot("", null, null);
    }

    static ChecksumRuntimeSnapshot of(String deviceId, Long serverTimeOffsetMs, Long adjustedTimeMs) {
        return new ChecksumRuntimeSnapshot(deviceId, serverTimeOffsetMs, adjustedTimeMs);
    }

    static ChecksumRuntimeSnapshot load(Path runtimeRoot) {
        Path snapshotPath = ChecksumRuntimePaths.runtimeSnapshot(runtimeRoot);
        if (!Files.isRegularFile(snapshotPath)) {
            return empty();
        }
        try {
            String json = Files.readString(snapshotPath, StandardCharsets.UTF_8);
            return new ChecksumRuntimeSnapshot(
                    readJsonString(json, "deviceId"),
                    readJsonLong(json, "serverTimeOffsetMs"),
                    readJsonLong(json, "adjustedTimeMs"));
        } catch (IOException e) {
            throw new IllegalStateException("failed to read runtime snapshot: " + snapshotPath.toAbsolutePath().normalize(), e);
        }
    }

    String deviceId() {
        return deviceId;
    }

    Long serverTimeOffsetMs() {
        return serverTimeOffsetMs;
    }

    Long adjustedTimeMs() {
        return adjustedTimeMs;
    }

    boolean hasRuntimeValues() {
        return !deviceId.isEmpty() || serverTimeOffsetMs != null || adjustedTimeMs != null;
    }

    private static String readJsonString(String json, String field) {
        Matcher matcher = JSON_STRING_FIELD.matcher(json);
        while (matcher.find()) {
            if (field.equals(matcher.group(1))) {
                return unescapeJson(matcher.group(2));
            }
        }
        return "";
    }

    private static Long readJsonLong(String json, String field) {
        Matcher matcher = JSON_NUMBER_FIELD.matcher(json);
        while (matcher.find()) {
            if (field.equals(matcher.group(1))) {
                return Long.parseLong(matcher.group(2));
            }
        }
        return null;
    }

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
                case '"':
                    out.append('"');
                    break;
                case '\\':
                    out.append('\\');
                    break;
                case '/':
                    out.append('/');
                    break;
                case 'b':
                    out.append('\b');
                    break;
                case 'f':
                    out.append('\f');
                    break;
                case 'n':
                    out.append('\n');
                    break;
                case 'r':
                    out.append('\r');
                    break;
                case 't':
                    out.append('\t');
                    break;
                case 'u':
                    if (i + 4 >= value.length()) {
                        throw new IllegalArgumentException("invalid unicode escape in runtime snapshot");
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
}
