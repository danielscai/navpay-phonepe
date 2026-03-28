package com.phonepehelper;

import android.content.Context;
import android.provider.Settings;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Local HTTP server for checksum generation.
 * POST http://127.0.0.1:19090/checksum
 * Body: {"path":"/apis/...","body":"","uuid":"..."}
 */
final class ChecksumServer {
    private static final String TAG = "PPHelperChecksum";
    private static final int PORT = 19090;
    private static volatile boolean started = false;

    private ChecksumServer() {}

    static synchronized void startAsync(Context context) {
        if (started) {
            return;
        }
        started = true;
        Handler handler = new Handler(Looper.getMainLooper());
        handler.postDelayed(() -> startInternal(context), 4000);
        Log.i(TAG, "Checksum server scheduled");
    }

    private static void startInternal(Context context) {
        Thread t = new Thread(() -> run(context), "pph-checksum-server");
        t.setDaemon(true);
        t.start();
        Log.i(TAG, "Checksum server starting on 127.0.0.1:" + PORT);
    }

    private static void run(Context context) {
        try (ServerSocket server = new ServerSocket(PORT, 50, InetAddress.getByName("127.0.0.1"))) {
            while (true) {
                Socket socket = server.accept();
                Thread handler = new Thread(() -> handle(socket, context), "pph-checksum-handler");
                handler.setDaemon(true);
                handler.start();
            }
        } catch (Throwable t) {
            Log.e(TAG, "Checksum server stopped", t);
        } finally {
            started = false;
        }
    }

    private static void handle(Socket socket, Context context) {
        try (Socket s = socket) {
            s.setSoTimeout(5000);
            InputStream in = s.getInputStream();
            OutputStream out = s.getOutputStream();

            Request req = parseRequest(in);
            if (req == null) {
                writeJson(out, 400, error("invalid request"));
                return;
            }

            if ("/health".equals(req.path)) {
                writeJson(out, 200, ok(new JSONObject().put("status", "ok")));
                return;
            }

            if ("/debug/runtime".equals(req.path)) {
                writeJson(out, 200, ok(buildRuntimeSnapshot(context)));
                return;
            }

            if ("/debug/checksum".equals(req.path)) {
                writeJson(out, 200, handleDebugChecksum(context, req));
                return;
            }

            if (!"/checksum".equals(req.path)) {
                writeJson(out, 404, error("not found"));
                return;
            }

            JSONObject body = new JSONObject(req.body.isEmpty() ? "{}" : req.body);
            String path = body.optString("path", "");
            String rawBody = body.optString("body", "");
            String uuid = body.optString("uuid", "");
            if (uuid.isEmpty()) {
                uuid = UUID.randomUUID().toString();
            }
            if (path.isEmpty()) {
                writeJson(out, 400, error("missing path"));
                return;
            }

            JSONObject response = buildChecksumResponse(context, path, rawBody, uuid);
            if (response.optBoolean("ok", false)) {
                writeJson(out, 200, response);
                return;
            }
            int statusCode = "missing path".equals(response.optString("error", "")) ? 400 : 500;
            writeJson(out, statusCode, response);

        } catch (Throwable t) {
            Log.e(TAG, "handler error", t);
            try {
                OutputStream out = socket.getOutputStream();
                writeJson(out, 500, error("internal error: " + t.getClass().getSimpleName()));
            } catch (Throwable ignored) {
                // swallow secondary write failures
            }
        }
    }

    private static JSONObject handleDebugChecksum(Context context, Request req) throws JSONException {
        JSONObject body = new JSONObject(req.body.isEmpty() ? "{}" : req.body);
        String path = body.optString("path", "");
        String rawBody = body.optString("body", "");
        JSONObject runtime = buildRuntimeSnapshot(context);
        JSONObject response = buildChecksumResponse(context, path, rawBody, body.optString("uuid", ""));
        if (!response.optBoolean("ok", false)) {
            return response;
        }

        JSONObject data = new JSONObject();
        JSONObject responseData = response.optJSONObject("data");
        data.put("checksum", responseData == null ? "" : responseData.optString("checksum", ""));
        data.put("uuid", response.optString("uuid", ""));
        data.put("runtime", runtime);
        return ok(data);
    }

    static JSONObject buildChecksumResponse(Context context, String path, String body, String uuid) throws JSONException {
        JSONObject response = new JSONObject();
        String normalizedPath = path == null ? "" : path.trim();
        String normalizedBody = body == null ? "" : body;
        String normalizedUuid = uuid == null ? "" : uuid.trim();
        if (normalizedUuid.isEmpty()) {
            normalizedUuid = UUID.randomUUID().toString();
        }
        if (normalizedPath.isEmpty()) {
            return error("missing path");
        }

        String checksum = computeChecksum(context, normalizedPath, normalizedBody, normalizedUuid);
        if (checksum == null) {
            return error("checksum failed");
        }

        JSONObject data = new JSONObject();
        data.put("checksum", checksum);
        response.put("ok", true);
        response.put("data", data);
        response.put("uuid", normalizedUuid);
        return response;
    }

    static String computeChecksum(Context context, String path, String body, String uuid) {
        try {
            Context safeContext = resolveContext(context);
            if (safeContext == null) {
                Log.e(TAG, "computeChecksum failed: context null");
                return null;
            }
            Class<?> cls = Class.forName("com.phonepe.networkclient.rest.EncryptionUtils");
            Method m = cls.getMethod("jnmcs", Context.class, byte[].class, byte[].class, byte[].class, Object.class);
            byte[] pathBytes = path.getBytes(StandardCharsets.UTF_8);
            byte[] bodyBytes = body.getBytes(StandardCharsets.UTF_8);
            byte[] uuidBytes = uuid.getBytes(StandardCharsets.UTF_8);
            Object res = m.invoke(null, safeContext, pathBytes, bodyBytes, uuidBytes, safeContext);
            if (res instanceof byte[]) {
                return new String((byte[]) res, StandardCharsets.UTF_8);
            }
        } catch (Throwable t) {
            Log.e(TAG, "computeChecksum failed", t);
        }
        return null;
    }

    private static JSONObject buildRuntimeSnapshot(Context context) throws JSONException {
        JSONObject data = new JSONObject();
        Context safeContext = resolveContext(context);
        if (safeContext == null) {
            data.put("context", "null");
            return data;
        }

        data.put("packageName", safeContext.getPackageName());
        data.put("packageCodePath", safeContext.getPackageCodePath());
        data.put("localTimeMs", System.currentTimeMillis());

        String androidId = Settings.Secure.getString(safeContext.getContentResolver(), "android_id");
        if (androidId != null) {
            data.put("androidId", androidId);
        }

        String deviceId = resolveDeviceId();
        if (deviceId != null) {
            data.put("deviceId", deviceId);
        }

        Long serverTimeOffsetMs = resolveServerTimeOffsetMs(safeContext);
        if (serverTimeOffsetMs != null) {
            data.put("serverTimeOffsetMs", serverTimeOffsetMs.longValue());
        }

        Long adjustedTimeMs = resolveAdjustedTimeMs();
        if (adjustedTimeMs != null) {
            data.put("adjustedTimeMs", adjustedTimeMs.longValue());
        }

        String signatureSha256 = resolveSignatureSha256(safeContext);
        if (signatureSha256 != null) {
            data.put("signatureSha256", signatureSha256);
        }

        return data;
    }

    private static String resolveDeviceId() {
        try {
            Class<?> fetcherClass = Class.forName("com.phonepe.network.base.utils.DeviceIdFetcher");
            Field field = fetcherClass.getDeclaredField("b");
            field.setAccessible(true);
            Object contract = field.get(null);
            if (contract != null) {
                Method method = contract.getClass().getMethod("generateDeviceIdSync");
                Object value = method.invoke(contract);
                if (value instanceof String) {
                    return (String) value;
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "resolveDeviceId via fetcher failed", t);
        }
        try {
            Class<?> generatorClass = Class.forName("com.phonepe.ncore.tool.device.identification.DeviceIdGenerator");
            Field field = generatorClass.getDeclaredField("h");
            field.setAccessible(true);
            Object generator = field.get(null);
            if (generator != null) {
                Method method = generatorClass.getMethod("generateDeviceIdSync");
                Object value = method.invoke(generator);
                if (value instanceof String) {
                    return (String) value;
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "resolveDeviceId via generator failed", t);
        }
        return null;
    }

    private static Long resolveServerTimeOffsetMs(Context context) {
        try {
            Class<?> configClass = Class.forName("com.phonepe.network.external.preference.NetworkConfig");
            Object config = configClass.getConstructor(Context.class).newInstance(context);
            Method method = configClass.getMethod("getServerTimeOffset");
            Object value = method.invoke(config);
            if (value instanceof Long) {
                return (Long) value;
            }
            if (value instanceof Number) {
                return ((Number) value).longValue();
            }
        } catch (Throwable t) {
            Log.w(TAG, "resolveServerTimeOffsetMs failed", t);
        }
        return null;
    }

    private static Long resolveAdjustedTimeMs() {
        try {
            Class<?> chClass = Class.forName("com.phonepe.networkclient.utils.CH");
            Method method = chClass.getMethod("e");
            Object value = method.invoke(null);
            if (value instanceof Long) {
                return (Long) value;
            }
            if (value instanceof Number) {
                return ((Number) value).longValue();
            }
        } catch (Throwable t) {
            Log.w(TAG, "resolveAdjustedTimeMs failed", t);
        }
        return null;
    }

    private static String resolveSignatureSha256(Context context) {
        try {
            byte[] signatureBytes = context.getPackageManager()
                    .getPackageInfo(context.getPackageName(), 64)
                    .signatures[0]
                    .toByteArray();
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return toHex(digest.digest(signatureBytes));
        } catch (Throwable t) {
            Log.w(TAG, "resolveSignatureSha256 failed", t);
            return null;
        }
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(Character.forDigit((b >> 4) & 0xf, 16));
            sb.append(Character.forDigit(b & 0xf, 16));
        }
        return sb.toString();
    }

    private static Context resolveContext(Context context) {
        if (context != null) {
            return context;
        }
        try {
            Class<?> at = Class.forName("android.app.ActivityThread");
            Method m = at.getMethod("currentApplication");
            Object app = m.invoke(null);
            if (app instanceof Context) {
                return (Context) app;
            }
        } catch (Throwable t) {
            Log.e(TAG, "resolveContext failed", t);
        }
        return null;
    }

    private static JSONObject ok(JSONObject data) throws JSONException {
        JSONObject obj = new JSONObject();
        obj.put("ok", true);
        obj.put("data", data);
        return obj;
    }

    private static JSONObject error(String msg) throws JSONException {
        JSONObject obj = new JSONObject();
        obj.put("ok", false);
        obj.put("error", msg);
        return obj;
    }

    private static void writeJson(OutputStream out, int code, JSONObject obj) throws IOException {
        byte[] body = obj.toString().getBytes(StandardCharsets.UTF_8);
        String header = "HTTP/1.1 " + code + " OK\r\n" +
                "Content-Type: application/json; charset=utf-8\r\n" +
                "Content-Length: " + body.length + "\r\n" +
                "Connection: close\r\n\r\n";
        out.write(header.getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }

    private static Request parseRequest(InputStream in) throws IOException {
        ByteArrayOutputStream headerBuf = new ByteArrayOutputStream();
        int b;
        int prev = -1;
        int prev2 = -1;
        int prev3 = -1;
        while ((b = in.read()) != -1) {
            headerBuf.write(b);
            // Support both CRLFCRLF and LFLF header terminators.
            boolean endedWithCrLfCrLf = prev3 == '\r' && prev2 == '\n' && prev == '\r' && b == '\n';
            boolean endedWithLfLf = prev == '\n' && b == '\n';
            if (endedWithCrLfCrLf || endedWithLfLf) {
                break;
            }
            prev3 = prev2;
            prev2 = prev;
            prev = b;
        }
        String headerText = headerBuf.toString(StandardCharsets.UTF_8.name());
        if (headerText.isEmpty()) return null;
        String[] lines = headerText.replace("\r\n", "\n").split("\n");
        if (lines.length == 0) return null;
        String[] first = lines[0].split(" ");
        if (first.length < 2) return null;
        String method = first[0].trim();
        String path = first[1].trim();
        Map<String, String> headers = new HashMap<>();
        for (int i = 1; i < lines.length; i++) {
            int idx = lines[i].indexOf(":");
            if (idx > 0) {
                String key = lines[i].substring(0, idx).trim().toLowerCase();
                String val = lines[i].substring(idx + 1).trim();
                headers.put(key, val);
            }
        }
        int contentLength = 0;
        if (headers.containsKey("content-length")) {
            try {
                contentLength = Integer.parseInt(headers.get("content-length"));
            } catch (NumberFormatException ignore) {
            }
        }
        byte[] body = new byte[contentLength];
        int read = 0;
        while (read < contentLength) {
            int r = in.read(body, read, contentLength - read);
            if (r == -1) break;
            read += r;
        }
        String bodyText = new String(body, 0, read, StandardCharsets.UTF_8);
        Request req = new Request();
        req.method = method;
        req.path = path;
        req.body = bodyText;
        return req;
    }

    private static final class Request {
        String method;
        String path;
        String body;
    }
}
