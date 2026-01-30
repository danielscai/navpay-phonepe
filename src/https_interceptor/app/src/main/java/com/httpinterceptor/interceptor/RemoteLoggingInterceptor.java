package com.httpinterceptor.interceptor;

import android.util.Log;

import org.json.JSONObject;

import java.io.IOException;
import java.lang.reflect.Method;

import okhttp3.Interceptor;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.Buffer;

/**
 * 最小化拦截器：仅验证注入链路，不做任何复杂解析。
 */
public class RemoteLoggingInterceptor implements Interceptor {

    private static final String TAG = "HttpInterceptor";

    @Override
    public Response intercept(Chain chain) throws IOException {
        Request request = chain.request();
        String url = safeRequestUrl(request);
        if (url.startsWith("https://")) {
            String method = safeRequestMethod(request);
            Log.d(TAG, "HTTPS: " + method + " " + url);
            String requestHeaders = safeRequestHeaders(request);
            String requestBody = safeRequestBody(request);
            Response response = safeProceed(chain, request);
            int statusCode = safeResponseCode(response);
            String responseHeaders = safeResponseHeaders(response);
            String responseBody = safeResponseBody(response);
            sendRemoteLog(method, url, statusCode, requestHeaders, requestBody, responseHeaders, responseBody);
            return response;
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

    private static String safeRequestBody(Request request) {
        Object bodyObj = null;
        try {
            Method m = request.getClass().getMethod("body");
            bodyObj = m.invoke(request);
        } catch (Throwable t) {
            bodyObj = safeGetField(request, "d");
        }
        if (bodyObj == null) {
            return "";
        }
        try {
            Buffer buffer = new Buffer();
            Method writeTo = bodyObj.getClass().getMethod("writeTo", okio.BufferedSink.class);
            writeTo.invoke(bodyObj, buffer);
            return buffer.readUtf8();
        } catch (Throwable t) {
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

    private static String safeResponseBody(Response response) {
        if (response == null) {
            return "";
        }
        try {
            Method peek = response.getClass().getMethod("peekBody", long.class);
            Object peeked = peek.invoke(response, 1024L * 64);
            if (peeked instanceof ResponseBody) {
                return ((ResponseBody) peeked).string();
            }
        } catch (Throwable ignored) {
            // fallthrough
        }
        try {
            ResponseBody body = response.body();
            if (body == null) {
                Object bodyField = safeGetField(response, "g");
                if (bodyField instanceof ResponseBody) {
                    body = (ResponseBody) bodyField;
                } else {
                    return "";
                }
            }
            Buffer buffer = new Buffer();
            body.source().request(1024L * 64);
            buffer.writeAll(body.source().buffer().clone());
            return buffer.readUtf8();
        } catch (Throwable t) {
            return "";
        }
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
