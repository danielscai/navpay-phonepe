package com.navpay.phonepe.unidbg;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class ChecksumFixtureLoader {

    private static final String REAL_FIXTURE_RESOURCE = "/fixtures/phonepe_intercept_replay.json";
    private static final String EXPECTED_FIXTURE_RESOURCE = "/fixtures/phonepe_intercept_replay.expected.json";
    private static final String PROBE_RUNTIME_ROOT_PROPERTY = "probe.runtime.root";
    private static final String PROBE_RUNTIME_ROOT_ENV = "PROBE_RUNTIME_ROOT";
    private static final String REPO_CHECKSUM_DIR = "src/services/checksum";
    private static final Pattern JSON_STRING_FIELD =
            Pattern.compile("\"%s\"\\s*:\\s*\"((?:\\\\.|[^\\\\\"])*)\"");
    private static final Pattern JSON_NUMBER_FIELD =
            Pattern.compile("\"%s\"\\s*:\\s*(\\d+)");
    private static final Pattern JSON_BOOLEAN_FIELD =
            Pattern.compile("\"%s\"\\s*:\\s*(true|false)");

    private ChecksumFixtureLoader() {
    }

    static RealFixture load() throws IOException {
        String json = readResource(REAL_FIXTURE_RESOURCE);
        return new RealFixture(
                readJsonString(json, "path"),
                readJsonString(json, "body"),
                readJsonString(json, "url")
        );
    }

    static ExpectedSnapshot loadExpected() throws IOException {
        String json = readResource(EXPECTED_FIXTURE_RESOURCE);
        return new ExpectedSnapshot(
                readJsonInt(json, "length"),
                readJsonInt(json, "decodedLength"),
                readJsonString(json, "mode"),
                readJsonBoolean(json, "structureOk"),
                readJsonBoolean(json, "asciiLike"),
                readJsonInt(json, "hyphenCount")
        );
    }

    static Path resolvePreparedRuntimeRoot() throws IOException {
        String override = firstNonBlank(System.getProperty(PROBE_RUNTIME_ROOT_PROPERTY), System.getenv(PROBE_RUNTIME_ROOT_ENV));
        if (override != null) {
            Path candidate = Path.of(override).toAbsolutePath().normalize();
            if (Files.isDirectory(candidate)) {
                return candidate;
            }
            throw new IOException("configured checksum runtime does not exist: " + candidate
                    + " (provide -D" + PROBE_RUNTIME_ROOT_PROPERTY + "=/absolute/path/to/runtime or "
                    + PROBE_RUNTIME_ROOT_ENV + "=/absolute/path/to/runtime)");
        }

        Path repoRoot = findRepoRoot();
        return ChecksumRuntimePaths.resolveRuntimeRoot(repoRoot);
    }

    static Path findRepoRoot() throws IOException {
        Path current = Path.of(System.getProperty("user.dir")).toAbsolutePath().normalize();
        for (int i = 0; i < 6 && current != null; i++) {
            if (Files.isDirectory(current.resolve(REPO_CHECKSUM_DIR))) {
                return current;
            }
            current = current.getParent();
        }
        throw new IOException("unable to locate repo root containing " + REPO_CHECKSUM_DIR);
    }

    static boolean hasExplicitRuntimeOverride() {
        return firstNonBlank(System.getProperty(PROBE_RUNTIME_ROOT_PROPERTY), System.getenv(PROBE_RUNTIME_ROOT_ENV)) != null;
    }

    static String extractJsonString(String json, String field) {
        return readJsonString(json, field);
    }

    static int extractJsonInt(String json, String field) {
        return readJsonInt(json, field);
    }

    static boolean extractJsonBoolean(String json, String field) {
        return readJsonBoolean(json, field);
    }

    private static String readResource(String resourcePath) throws IOException {
        try (InputStream in = ChecksumFixtureLoader.class.getResourceAsStream(resourcePath)) {
            if (in == null) {
                throw new IOException("missing test resource: " + resourcePath);
            }
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static String readJsonString(String json, String field) {
        Matcher matcher = fieldPattern(JSON_STRING_FIELD, field).matcher(json);
        if (!matcher.find()) {
            throw new IllegalArgumentException("missing string field: " + field);
        }
        return unescapeJson(matcher.group(1));
    }

    private static int readJsonInt(String json, String field) {
        Matcher matcher = fieldPattern(JSON_NUMBER_FIELD, field).matcher(json);
        if (!matcher.find()) {
            throw new IllegalArgumentException("missing numeric field: " + field);
        }
        return Integer.parseInt(matcher.group(1));
    }

    private static boolean readJsonBoolean(String json, String field) {
        Matcher matcher = fieldPattern(JSON_BOOLEAN_FIELD, field).matcher(json);
        if (!matcher.find()) {
            throw new IllegalArgumentException("missing boolean field: " + field);
        }
        return Boolean.parseBoolean(matcher.group(1));
    }

    private static Pattern fieldPattern(Pattern template, String field) {
        Objects.requireNonNull(field, "field");
        return Pattern.compile(String.format(template.pattern(), Pattern.quote(field)));
    }

    private static String firstNonBlank(String first, String second) {
        if (first != null && !first.trim().isEmpty()) {
            return first.trim();
        }
        if (second != null && !second.trim().isEmpty()) {
            return second.trim();
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
                        throw new IllegalArgumentException("invalid unicode escape in JSON string");
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

    static final class RealFixture {
        private final String path;
        private final String body;
        private final String url;

        RealFixture(String path, String body, String url) {
            this.path = path;
            this.body = body;
            this.url = url;
        }

        String path() {
            return path;
        }

        String body() {
            return body;
        }

        String url() {
            return url;
        }
    }

    static final class ExpectedSnapshot {
        private final int length;
        private final int decodedLength;
        private final String mode;
        private final boolean structureOk;
        private final boolean asciiLike;
        private final int hyphenCount;

        ExpectedSnapshot(int length, int decodedLength, String mode, boolean structureOk, boolean asciiLike, int hyphenCount) {
            this.length = length;
            this.decodedLength = decodedLength;
            this.mode = mode;
            this.structureOk = structureOk;
            this.asciiLike = asciiLike;
            this.hyphenCount = hyphenCount;
        }

        int length() {
            return length;
        }

        int decodedLength() {
            return decodedLength;
        }

        String mode() {
            return mode;
        }

        boolean structureOk() {
            return structureOk;
        }

        boolean asciiLike() {
            return asciiLike;
        }

        int hyphenCount() {
            return hyphenCount;
        }
    }
}
