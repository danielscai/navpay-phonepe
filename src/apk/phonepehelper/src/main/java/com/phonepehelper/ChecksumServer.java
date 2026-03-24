package com.phonepehelper;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
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
        }
    }

    private static void handle(Socket socket, Context context) {
        try (Socket s = socket;
             InputStream in = s.getInputStream();
             OutputStream out = s.getOutputStream()) {

            Request req = parseRequest(in);
            if (req == null) {
                writeJson(out, 400, error("invalid request"));
                return;
            }

            if ("/health".equals(req.path)) {
                writeJson(out, 200, ok(new JSONObject().put("status", "ok")));
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

            String checksum = computeChecksum(context, path, rawBody, uuid);
            if (checksum == null) {
                writeJson(out, 500, error("checksum failed"));
                return;
            }

            JSONObject data = new JSONObject();
            data.put("checksum", checksum);
            data.put("uuid", uuid);
            writeJson(out, 200, ok(data));

        } catch (Throwable t) {
            Log.e(TAG, "handler error", t);
        }
    }

    private static String computeChecksum(Context context, String path, String body, String uuid) {
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
        int state = 0;
        while ((b = in.read()) != -1) {
            headerBuf.write(b);
            if (state == 0 && b == '\r') state = 1;
            else if (state == 1 && b == '\n') state = 2;
            else if (state == 2 && b == '\r') state = 3;
            else if (state == 3 && b == '\n') break;
            else state = 0;
        }
        String headerText = headerBuf.toString(StandardCharsets.UTF_8.name());
        if (headerText.isEmpty()) return null;
        String[] lines = headerText.split("\r\n");
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
