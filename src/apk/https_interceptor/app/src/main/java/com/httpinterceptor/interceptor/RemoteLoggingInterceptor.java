package com.httpinterceptor.interceptor;

import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Arrays;
import java.util.Locale;
import java.util.zip.GZIPInputStream;

import okhttp3.Interceptor;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.Buffer;
import okio.BufferedSource;

/**
 * 最小化拦截器：仅验证注入链路，不做任何复杂解析。
 */
public class RemoteLoggingInterceptor implements Interceptor {

    private static final String TAG = "HttpInterceptor";
    private static final int MAX_BODY_BYTES = 1024 * 64;
    private static final String REQUEST_GZIP_BASE64_PREFIX = "__REQ_GZIP_BASE64__:";

    @Override
    public Response intercept(Chain chain) throws IOException {
        Request request = chain.request();
        String url = safeRequestUrl(request);
        if (url.startsWith("https://")) {
            String method = safeRequestMethod(request);
            Log.d(TAG, "HTTPS: " + method + " " + url);
            String requestHeaders = safeRequestHeaders(request);
            String requestBody = safeRequestBody(request, requestHeaders);
            Response response = safeProceed(chain, request);
            ResponseBody originalBody = getResponseBody(response);
            byte[] responseBytes = null;
            Response finalResponse = response;
            if (originalBody != null) {
                try {
                    responseBytes = originalBody.bytes();
                    ResponseBody rebuiltBody = ResponseBody.create(originalBody.contentType(), responseBytes);
                    Response rebuilt = rebuildResponse(response, rebuiltBody);
                    if (rebuilt != null) {
                        finalResponse = rebuilt;
                    }
                } catch (Throwable t) {
                    responseBytes = null;
                }
            }
            int statusCode = safeResponseCode(finalResponse);
            String responseHeaders = safeResponseHeaders(finalResponse);
            String responseBody = responseBytes == null ? safeResponseBody(finalResponse, responseHeaders)
                : decodeBodyBytes(responseBytes, responseHeaders, false);
            logBodyPreview("REQ", requestBody);
            logBodyPreview("RESP", responseBody);
            sendRemoteLog(method, url, statusCode, requestHeaders, requestBody, responseHeaders, responseBody);
            return finalResponse;
        }
        return safeProceed(chain, request);
    }

    private static Response safeProceed(Chain chain, Request request) throws IOException {
        try {
            return chain.proceed(request);
        } catch (NoSuchMethodError e) {
            // 运行时 Chain.proceed 被混淆为 a(Request)
            try {
                return (Response) chain.getClass()
                    .getMethod("a", Request.class)
                    .invoke(chain, request);
            } catch (Throwable t) {
                if (t instanceof IOException) {
                    throw (IOException) t;
                }
                if (t.getCause() instanceof IOException) {
                    throw (IOException) t.getCause();
                }
                throw new IOException("Proceed failed", t);
            }
        }
    }

    private static void sendRemoteLog(String method, String url, int statusCode, String requestHeaders,
                                      String requestBody, String responseHeaders, String responseBody) {
        try {
            JSONObject json = new JSONObject();
            json.put("timestamp", System.currentTimeMillis());
            json.put("method", method);
            json.put("url", url);
            json.put("protocol", "https");
            json.put("status_code", statusCode);
            json.put("request_headers", requestHeaders);
            json.put("request_body", requestBody);
            json.put("response_headers", responseHeaders);
            json.put("response_body", responseBody);
            LogSender.getInstance().sendLog(json);
        } catch (Throwable t) {
            Log.w(TAG, "Remote log send skipped: " + t.getMessage());
        }
    }

    private static String safeRequestUrl(Request request) {
        Object url = safeGetField(request, "a");
        return url == null ? "unknown" : String.valueOf(url);
    }

    private static String safeRequestMethod(Request request) {
        Object method = safeGetField(request, "b");
        return method == null ? "UNKNOWN" : String.valueOf(method);
    }

    private static String safeRequestHeaders(Request request) {
        try {
            Method m = request.getClass().getMethod("headers");
            Object headers = m.invoke(request);
            return headers == null ? "" : String.valueOf(headers);
        } catch (Throwable t) {
            Object headers = safeGetField(request, "c");
            return headers == null ? "" : String.valueOf(headers);
        }
    }

    private static String safeRequestBody(Request request, String headers) {
        Object bodyObj = null;
        try {
            Method m = request.getClass().getMethod("body");
            bodyObj = m.invoke(request);
        } catch (Throwable t) {
            bodyObj = safeGetField(request, "d");
        }
        if (bodyObj == null) {
            Log.d(TAG, "REQ body object null");
            return "";
        }
        try {
            Buffer buffer = new Buffer();
            Method writeTo = findWriteToMethod(bodyObj);
            if (writeTo == null) {
                Log.w(TAG, "REQ body writeTo not found, class=" + bodyObj.getClass().getName());
                return "";
            }
            writeTo.invoke(bodyObj, buffer);
            if (buffer.size() == 0) {
                Log.d(TAG, "REQ body buffer empty, class=" + bodyObj.getClass().getName());
            }
            return decodeBody(buffer, headers, true);
        } catch (Throwable t) {
            String msg = t.getClass().getSimpleName();
            Log.w(TAG, "REQ body read failed: " + msg);
            if (t instanceof NoSuchMethodError) {
                String fallback = safeRequestBodyReflect(bodyObj, headers);
                if (!fallback.isEmpty()) {
                    return fallback;
                }
            }
            return "";
        }
    }

    private static int safeResponseCode(Response response) {
        if (response == null) {
            return 0;
        }
        try {
            Method m = response.getClass().getMethod("code");
            Object code = m.invoke(response);
            return code instanceof Integer ? (Integer) code : 0;
        } catch (Throwable t) {
            Object code = safeGetField(response, "d");
            return code instanceof Integer ? (Integer) code : 0;
        }
    }

    private static String safeResponseHeaders(Response response) {
        if (response == null) {
            return "";
        }
        try {
            Method m = response.getClass().getMethod("headers");
            Object headers = m.invoke(response);
            return headers == null ? "" : String.valueOf(headers);
        } catch (Throwable t) {
            Object headers = safeGetField(response, "f");
            return headers == null ? "" : String.valueOf(headers);
        }
    }

    private static String safeResponseBody(Response response, String headers) {
        if (response == null) {
            return "";
        }
        ResponseBody body = null;
        try {
            Method peek = findPeekBodyMethod(response);
            if (peek != null) {
                Object peeked = peek.invoke(response, (long) MAX_BODY_BYTES);
                if (peeked instanceof ResponseBody) {
                    body = (ResponseBody) peeked;
                }
            }
        } catch (Throwable ignored) {
            // fallthrough
        }
        try {
            if (body == null) {
                Object bodyField = safeGetField(response, "g");
                if (bodyField instanceof ResponseBody) {
                    body = (ResponseBody) bodyField;
                }
            }
            if (body == null) {
                return "";
            }
            BufferedSource source = body.source();
            BufferedSource peek = source.peek();
            peek.request((long) MAX_BODY_BYTES);
            Buffer buffer = new Buffer();
            buffer.writeAll(peek.buffer().clone());
            return decodeBody(buffer, headers, false);
        } catch (Throwable t) {
            return "";
        }
    }

    private static Method findPeekBodyMethod(Response response) {
        try {
            for (Method m : response.getClass().getMethods()) {
                if (m.getParameterTypes().length == 1 && m.getParameterTypes()[0] == long.class) {
                    if (ResponseBody.class.isAssignableFrom(m.getReturnType())) {
                        return m;
                    }
                }
            }
        } catch (Throwable ignored) {
        }
        return null;
    }

    private static String decodeBody(Buffer buffer, String headers, boolean requestBody) {
        if (buffer == null || buffer.size() == 0) {
            return "";
        }
        long size = buffer.size();
        int readLen = (int) Math.min(size, MAX_BODY_BYTES);
        byte[] bytes;
        try {
            bytes = buffer.readByteArray(readLen);
        } catch (IOException e) {
            return "";
        }
        return decodeBodyBytes(bytes, headers, requestBody);
    }

    private static String decodeBodyBytes(byte[] bytes, String headers, boolean requestBody) {
        if (bytes == null || bytes.length == 0) {
            return "";
        }
        byte[] limited = bytes.length > MAX_BODY_BYTES ? Arrays.copyOf(bytes, MAX_BODY_BYTES) : bytes;
        if (isGzip(headers) && isGzipBytes(limited)) {
            if (requestBody) {
                return REQUEST_GZIP_BASE64_PREFIX + Base64.getEncoder().encodeToString(limited);
            }
            String gz = tryGunzip(limited);
            if (gz != null) {
                return gz;
            }
        }
        return new String(limited, StandardCharsets.UTF_8);
    }

    private static boolean isGzip(String headers) {
        if (headers == null) {
            return false;
        }
        String h = headers.toLowerCase(Locale.ROOT);
        return h.contains("content-encoding: gzip") || h.contains("x-compression-algorithm: gzip");
    }

    private static boolean isGzipBytes(byte[] bytes) {
        return bytes != null && bytes.length >= 2 && (bytes[0] == (byte) 0x1f) && (bytes[1] == (byte) 0x8b);
    }

    private static String tryGunzip(byte[] bytes) {
        try (InputStream is = new GZIPInputStream(new ByteArrayInputStream(bytes))) {
            byte[] out = is.readAllBytes();
            return new String(out, StandardCharsets.UTF_8);
        } catch (Throwable t) {
            return null;
        }
    }

    private static void logBodyPreview(String label, String body) {
        if (body == null || body.isEmpty()) {
            Log.d(TAG, label + " body empty");
            return;
        }
        int len = body.length();
        int previewLen = Math.min(len, 256);
        String preview = body.substring(0, previewLen);
        Log.d(TAG, label + " body len=" + len + " preview=" + preview);
    }

    private static ResponseBody getResponseBody(Response response) {
        if (response == null) {
            return null;
        }
        Object bodyField = safeGetField(response, "g");
        return bodyField instanceof ResponseBody ? (ResponseBody) bodyField : null;
    }

    private static Response rebuildResponse(Response response, ResponseBody newBody) {
        if (response == null || newBody == null) {
            return null;
        }
        try {
            Method builderMethod = null;
            for (Method m : response.getClass().getMethods()) {
                if (m.getParameterTypes().length == 0) {
                    Class<?> ret = m.getReturnType();
                    if (ret != null && ret.getName().equals("okhttp3.Response$Builder")) {
                        builderMethod = m;
                        break;
                    }
                }
            }
            if (builderMethod == null) {
                return null;
            }
            Object builder = builderMethod.invoke(response);
            if (builder == null) {
                return null;
            }
            try {
                java.lang.reflect.Field f = builder.getClass().getDeclaredField("g");
                f.setAccessible(true);
                f.set(builder, newBody);
            } catch (Throwable ignored) {
                return null;
            }
            for (Method m : builder.getClass().getMethods()) {
                if (m.getParameterTypes().length == 0 && m.getReturnType().getName().equals("okhttp3.Response")) {
                    return (Response) m.invoke(builder);
                }
            }
        } catch (Throwable ignored) {
        }
        return null;
    }

    private static Method findWriteToMethod(Object bodyObj) {
        if (bodyObj == null) {
            return null;
        }
        try {
            return bodyObj.getClass().getMethod("writeTo", okio.BufferedSink.class);
        } catch (Throwable ignored) {
        }
        try {
            for (Method m : bodyObj.getClass().getMethods()) {
                Class<?>[] params = m.getParameterTypes();
                if (params.length == 1 && params[0].getName().equals("okio.BufferedSink")) {
                    if (m.getReturnType() == Void.TYPE) {
                        return m;
                    }
                }
            }
        } catch (Throwable ignored) {
        }
        return null;
    }

    private static String safeRequestBodyReflect(Object bodyObj, String headers) {
        try {
            ClassLoader cl = bodyObj.getClass().getClassLoader();
            Class<?> bufferClass = Class.forName("okio.Buffer", true, cl);
            Object buffer = bufferClass.getDeclaredConstructor().newInstance();
            Method writeTo = null;
            for (Method m : bodyObj.getClass().getMethods()) {
                Class<?>[] params = m.getParameterTypes();
                if (params.length == 1 && params[0].getName().equals("okio.BufferedSink")) {
                    if (m.getReturnType() == Void.TYPE) {
                        writeTo = m;
                        break;
                    }
                }
            }
            if (writeTo == null) {
                Log.w(TAG, "REQ body reflect writeTo not found");
                return "";
            }
            writeTo.invoke(bodyObj, buffer);
            long size = 0L;
            try {
                java.lang.reflect.Field sizeField = bufferClass.getDeclaredField("b");
                sizeField.setAccessible(true);
                Object sizeObj = sizeField.get(buffer);
                if (sizeObj instanceof Long) {
                    size = (Long) sizeObj;
                }
            } catch (Throwable ignored) {
            }
            if (size == 0) {
                return "";
            }
            Method readBytes = null;
            for (Method m : bufferClass.getMethods()) {
                if (m.getReturnType() == byte[].class && m.getParameterTypes().length == 1
                    && m.getParameterTypes()[0] == long.class) {
                    readBytes = m;
                    break;
                }
            }
            if (readBytes == null) {
                Log.w(TAG, "REQ body reflect readByteArray not found");
                return "";
            }
            long toRead = Math.min(size, MAX_BODY_BYTES);
            Object bytesObj = readBytes.invoke(buffer, toRead);
            if (bytesObj instanceof byte[]) {
                return decodeBodyBytes((byte[]) bytesObj, headers, true);
            }
        } catch (Throwable t) {
            Log.w(TAG, "REQ body reflect failed: " + t.getClass().getSimpleName());
        }
        return "";
    }

    private static Object safeGetField(Object target, String fieldName) {
        if (target == null || fieldName == null) {
            return null;
        }
        try {
            java.lang.reflect.Field f = target.getClass().getDeclaredField(fieldName);
            f.setAccessible(true);
            return f.get(target);
        } catch (Throwable t) {
            return null;
        }
    }
}
