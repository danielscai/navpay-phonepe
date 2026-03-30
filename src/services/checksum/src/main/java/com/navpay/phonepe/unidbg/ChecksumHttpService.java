package com.navpay.phonepe.unidbg;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class ChecksumHttpService {

    private static final Pattern JSON_STRING_FIELD =
            Pattern.compile("\"([^\"]+)\"\\s*:\\s*\"((?:\\\\.|[^\\\\\"])*)\"");

    private static final int DEFAULT_PORT = 19190;
    private static final String DEFAULT_HOST = "127.0.0.1";
    private static final int DEFAULT_WORKERS = 1;

    private final String runtimeRoot;
    private final String libPath;
    private final String loadOrder;
    private final boolean loadLibcxx;
    private final UnidbgChecksumProbe probe;

    private ChecksumHttpService(String runtimeRoot, String libPath, String loadOrder, boolean loadLibcxx) {
        this.runtimeRoot = runtimeRoot;
        this.libPath = libPath;
        this.loadOrder = loadOrder;
        this.loadLibcxx = loadLibcxx;
        this.probe = new UnidbgChecksumProbe();
    }

    public static void main(String[] args) throws Exception {
        String configuredRuntime = readConfig("probe.runtime.root", "PROBE_RUNTIME_ROOT", "");
        Path runtimeRoot;
        if (!configuredRuntime.isEmpty()) {
            runtimeRoot = Path.of(configuredRuntime).toAbsolutePath().normalize();
        } else {
            Path repoRoot = ChecksumRuntimePaths.resolveRepoRoot(Path.of(System.getProperty("user.dir")));
            runtimeRoot = ChecksumRuntimePaths.resolveRuntimeRoot(repoRoot);
        }
        ChecksumRuntimePaths.validatePreparedRuntime(runtimeRoot);
        String host = readConfig("checksum.http.host", "CHECKSUM_HTTP_HOST", DEFAULT_HOST);
        int port = Integer.parseInt(readConfig("checksum.http.port", "CHECKSUM_HTTP_PORT", String.valueOf(DEFAULT_PORT)));
        int workers = Integer.parseInt(readConfig("checksum.http.workers", "CHECKSUM_HTTP_WORKERS", String.valueOf(DEFAULT_WORKERS)));
        String libPath = ChecksumRuntimePaths.runtimeLib(runtimeRoot, "libphonepe-cryptography-support-lib.so").toString();
        String loadOrder = readConfig("probe.load.order", "PROBE_LOAD_ORDER", "e755b7-first");
        boolean loadLibcxx = isTruthy(readConfig("probe.load.libcxx", "PROBE_LOAD_LIBCXX", "false"));
        System.setProperty("probe.ch.mode", "emulate");
        System.setProperty("probe.runtime.root", runtimeRoot.toString());
        ChecksumHttpService service = new ChecksumHttpService(runtimeRoot.toString(), libPath, loadOrder, loadLibcxx);
        service.start(host, port, workers);
    }

    private void start(String host, int port, int workers) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress(host, port), 0);
        server.createContext("/health", exchange -> {
            if (!"GET".equals(exchange.getRequestMethod())) {
                writeJson(exchange, 405, jsonError("method not allowed"));
                return;
            }
            String body = "{\"ok\":true,\"data\":{\"status\":\"ok\",\"mode\":\"emulate\",\"port\":" + port + "}}";
            writeJson(exchange, 200, body);
        });
        server.createContext("/checksum", new JsonPostHandler(this::handleChecksum));
        server.createContext("/validate", new JsonPostHandler(this::handleValidate));
        int effectiveWorkers = 1;
        if (workers > 1) {
            System.err.println("checksum_http_workers_requested=" + workers + " ignored; forcing single worker for unidbg stability");
        }
        server.setExecutor(Executors.newSingleThreadExecutor());
        server.start();
        System.out.println("checksum_http_service=LISTENING");
        System.out.println("checksum_http_port=" + port);
        System.out.println("checksum_http_workers=" + effectiveWorkers);
        System.out.println("checksum_http_mode=emulate");
        System.out.println("checksum_http_runtime=" + runtimeRoot);
        System.out.println("checksum_http_library=" + libPath);
    }

    private String handleChecksum(Map<String, String> request) throws Exception {
        ProbeResponse probe = runProbe(request);
        return buildChecksumResponse(probe, null);
    }

    private String handleValidate(Map<String, String> request) throws Exception {
        String exampleChecksum = request.getOrDefault("exampleChecksum", "");
        ChecksumShape exampleShape = exampleChecksum.isEmpty() ? null : ChecksumShape.fromChecksum(exampleChecksum);
        ProbeResponse probe = runProbe(request);
        return buildChecksumResponse(probe, exampleShape);
    }

    private synchronized ProbeResponse runProbe(Map<String, String> request) throws Exception {
        long t0 = System.nanoTime();
        String path = request.getOrDefault("path", "");
        if (path.isEmpty()) {
            throw new IllegalArgumentException("missing path");
        }
        String uuid = request.getOrDefault("uuid", "8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001");
        String body = request.getOrDefault("body", "");
        long tConstruct0 = System.nanoTime();
        long tConstruct1 = tConstruct0;
        Map<String, String> report = probe.execute(libPath, path, body, uuid, loadOrder, loadLibcxx);
        long t1 = System.nanoTime();
        String checksum = report.getOrDefault("checksum", "");
        if (checksum.isEmpty()) {
            throw new IllegalStateException("probe returned empty checksum");
        }
        report.put("perf_construct_probe_ms", formatMillis(tConstruct1 - tConstruct0));
        report.put("perf_execute_probe_ms", formatMillis(t1 - tConstruct1));
        report.put("perf_http_run_probe_ms", formatMillis(t1 - t0));
        System.err.println("checksum_perf"
                + " construct_ms=" + report.get("perf_construct_probe_ms")
                + " execute_ms=" + report.get("perf_execute_probe_ms")
                + " prepare_ms=" + report.getOrDefault("perf_prepare_session_ms", "n/a")
                + " checksum_ms=" + report.getOrDefault("perf_probe_checksum_ms", "n/a")
                + " jnmcs_ms=" + report.getOrDefault("perf_probe_jnmcs_ms", "n/a")
                + " reused=" + report.getOrDefault("probe_session_reused", "n/a"));
        ChecksumShape shape = ChecksumShape.fromChecksum(checksum);
        return new ProbeResponse(report, checksum, shape);
    }

    private static String formatMillis(long nanos) {
        return String.format(java.util.Locale.ROOT, "%.3f", nanos / 1_000_000.0d);
    }

    private String buildChecksumResponse(ProbeResponse probe, ChecksumShape exampleShape) {
        boolean structureOk = probe.shape.isStructureOk();
        StringBuilder sb = new StringBuilder();
        sb.append("{\"ok\":true,\"data\":{");
        appendJsonField(sb, "checksum", probe.checksum, true);
        appendJsonField(sb, "length", String.valueOf(probe.checksum.length()), false);
        appendJsonField(sb, "decodedLength", String.valueOf(probe.shape.decodedLength), false);
        appendJsonField(sb, "mode", probe.report.getOrDefault("probe_ch_mode", "emulate"), true);
        appendJsonField(sb, "structureOk", String.valueOf(structureOk), false);
        appendJsonField(sb, "asciiLike", String.valueOf(probe.shape.asciiLike), false);
        appendJsonField(sb, "hyphenCount", String.valueOf(probe.shape.hyphenCount), false);
        appendJsonField(sb, "decodedPreview", probe.shape.preview, true);
        if (exampleShape != null) {
            appendJsonField(sb, "exampleLength", String.valueOf(exampleShape.originalLength), false);
            appendJsonField(sb, "exampleDecodedLength", String.valueOf(exampleShape.decodedLength), false);
            appendJsonField(sb, "lengthDelta", String.valueOf(Math.abs(probe.shape.originalLength - exampleShape.originalLength)), false);
            appendJsonField(sb, "decodedLengthDelta", String.valueOf(Math.abs(probe.shape.decodedLength - exampleShape.decodedLength)), false);
        }
        appendJsonField(sb, "generatedAt", Instant.now().toString(), true);
        sb.append("}}");
        return sb.toString();
    }

    private static Map<String, String> parseJsonBody(String body) {
        Map<String, String> out = new LinkedHashMap<>();
        Matcher matcher = JSON_STRING_FIELD.matcher(body);
        while (matcher.find()) {
            out.put(matcher.group(1), unescapeJson(matcher.group(2)));
        }
        return out;
    }

    private static String readConfig(String propertyKey, String envKey, String defaultValue) {
        String value = System.getProperty(propertyKey);
        if (value != null && !value.isEmpty()) {
            return value;
        }
        value = System.getenv(envKey);
        if (value != null && !value.isEmpty()) {
            return value;
        }
        return defaultValue;
    }

    private static void writeJson(HttpExchange exchange, int statusCode, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(statusCode, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    private static byte[] readAllBytes(InputStream in) throws IOException {
        return in.readAllBytes();
    }

    private static String jsonError(String message) {
        return "{\"ok\":false,\"error\":\"" + escapeJson(message) + "\"}";
    }

    private static void appendJsonField(StringBuilder sb, String key, String value, boolean quote) {
        if (sb.charAt(sb.length() - 1) != '{') {
            sb.append(',');
        }
        sb.append('"').append(escapeJson(key)).append('"').append(':');
        if (quote) {
            sb.append('"').append(escapeJson(value)).append('"');
        } else {
            sb.append(value);
        }
    }

    private static String escapeJson(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r");
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
                        throw new IllegalArgumentException("invalid unicode escape in request json");
                    }
                    String hex = value.substring(i + 1, i + 5);
                    try {
                        out.append((char) Integer.parseInt(hex, 16));
                    } catch (NumberFormatException e) {
                        throw new IllegalArgumentException("invalid unicode escape in request json");
                    }
                    i += 4;
                    break;
                default:
                    out.append(next);
                    break;
            }
        }
        return out.toString();
    }

    private static String sanitize(String value) {
        return value.replace('\n', ' ').replace('\r', ' ');
    }

    private static boolean isTruthy(String value) {
        if (value == null) {
            return false;
        }
        String normalized = value.trim().toLowerCase();
        return "1".equals(normalized) || "true".equals(normalized) || "yes".equals(normalized) || "on".equals(normalized);
    }

    private interface JsonAction {
        String handle(Map<String, String> request) throws Exception;
    }

    private static final class JsonPostHandler implements HttpHandler {
        private final JsonAction action;

        private JsonPostHandler(JsonAction action) {
            this.action = action;
        }

        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"POST".equals(exchange.getRequestMethod())) {
                writeJson(exchange, 405, jsonError("method not allowed"));
                return;
            }
            String body = new String(readAllBytes(exchange.getRequestBody()), StandardCharsets.UTF_8);
            try {
                String response = action.handle(parseJsonBody(body));
                writeJson(exchange, 200, response);
            } catch (IllegalArgumentException e) {
                writeJson(exchange, 400, jsonError(e.getMessage()));
            } catch (Exception e) {
                writeJson(exchange, 500, jsonError(e.getClass().getSimpleName() + ": " + e.getMessage()));
            }
        }
    }

    private static final class ProbeResponse {
        private final Map<String, String> report;
        private final String checksum;
        private final ChecksumShape shape;

        private ProbeResponse(Map<String, String> report, String checksum, ChecksumShape shape) {
            this.report = report;
            this.checksum = checksum;
            this.shape = shape;
        }
    }

    private static final class ChecksumShape {
        private final int originalLength;
        private final int decodedLength;
        private final boolean asciiLike;
        private final int hyphenCount;
        private final String preview;

        private ChecksumShape(int originalLength, int decodedLength, boolean asciiLike, int hyphenCount, String preview) {
            this.originalLength = originalLength;
            this.decodedLength = decodedLength;
            this.asciiLike = asciiLike;
            this.hyphenCount = hyphenCount;
            this.preview = preview;
        }

        private static ChecksumShape fromChecksum(String checksum) {
            byte[] decoded = Base64.getDecoder().decode(checksum);
            int hyphenCount = 0;
            int asciiPrintable = 0;
            for (byte b : decoded) {
                int c = b & 0xff;
                if (c == '-') {
                    hyphenCount++;
                }
                if (c >= 32 && c <= 126) {
                    asciiPrintable++;
                }
            }
            String preview = new String(decoded, 0, Math.min(decoded.length, 64), StandardCharsets.UTF_8);
            boolean asciiLike = asciiPrintable >= decoded.length * 0.95;
            return new ChecksumShape(checksum.length(), decoded.length, asciiLike, hyphenCount, preview);
        }

        private boolean isStructureOk() {
            return originalLength >= 160
                    && originalLength <= 220
                    && decodedLength >= 120
                    && decodedLength <= 180
                    && asciiLike
                    && hyphenCount >= 2;
        }
    }
}
