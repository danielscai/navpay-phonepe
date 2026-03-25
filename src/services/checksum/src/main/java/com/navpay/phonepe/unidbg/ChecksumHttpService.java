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

    private final String runtimeRoot;
    private final String libPath;
    private final String loadOrder;
    private final boolean loadLibcxx;

    private ChecksumHttpService(String runtimeRoot, String libPath, String loadOrder, boolean loadLibcxx) {
        this.runtimeRoot = runtimeRoot;
        this.libPath = libPath;
        this.loadOrder = loadOrder;
        this.loadLibcxx = loadLibcxx;
    }

    public static void main(String[] args) throws Exception {
        Path repoRoot = ChecksumRuntimePaths.resolveRepoRoot(Path.of(System.getProperty("user.dir")));
        Path runtimeRoot = Path.of(readConfig("probe.runtime.root", "PROBE_RUNTIME_ROOT",
                ChecksumRuntimePaths.resolveRuntimeRoot(repoRoot).toString())).toAbsolutePath().normalize();
        ChecksumRuntimePaths.validatePreparedRuntime(runtimeRoot);
        int port = Integer.parseInt(readConfig("checksum.http.port", "CHECKSUM_HTTP_PORT", String.valueOf(DEFAULT_PORT)));
        if (System.getProperty("probe.device.id") == null && System.getenv("PROBE_DEVICE_ID") == null) {
            String detected = UnidbgChecksumProbe.detectDeviceIdFromAdb();
            if (detected != null && !detected.isEmpty()) {
                System.setProperty("probe.device.id", detected);
            }
        }
        String libPath = ChecksumRuntimePaths.runtimeLib(runtimeRoot, "libphonepe-cryptography-support-lib.so").toString();
        String loadOrder = readConfig("probe.load.order", "PROBE_LOAD_ORDER", "e755b7-first");
        boolean loadLibcxx = isTruthy(readConfig("probe.load.libcxx", "PROBE_LOAD_LIBCXX", "false"));
        ChecksumHttpService service = new ChecksumHttpService(runtimeRoot.toString(), libPath, loadOrder, loadLibcxx);
        service.start(port);
    }

    private void start(int port) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
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
        // unidbg/unicorn is not stable under concurrent request execution in the same JVM.
        server.setExecutor(Executors.newSingleThreadExecutor());
        server.start();
        System.out.println("checksum_http_service=LISTENING");
        System.out.println("checksum_http_port=" + port);
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
        String path = request.getOrDefault("path", "");
        if (path.isEmpty()) {
            throw new IllegalArgumentException("missing path");
        }
        String uuid = request.getOrDefault("uuid", "8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001");
        String body = request.getOrDefault("body", "");
        System.setProperty("probe.ch.mode", "emulate");
        System.setProperty("probe.runtime.root", runtimeRoot);
        Map<String, String> report = new UnidbgChecksumProbe().execute(libPath, path, body, uuid, loadOrder, loadLibcxx);
        String checksum = report.getOrDefault("checksum", "");
        if (checksum.isEmpty()) {
            throw new IllegalStateException("probe returned empty checksum");
        }
        ChecksumShape shape = ChecksumShape.fromChecksum(checksum);
        return new ProbeResponse(report, checksum, shape);
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
        return value.replace("\\\"", "\"").replace("\\\\", "\\").replace("\\n", "\n").replace("\\r", "\r");
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
