package com.httpinterceptor.interceptor;

import android.util.Log;

import org.json.JSONObject;

import java.io.IOException;

import okhttp3.Interceptor;
import okhttp3.Request;
import okhttp3.Response;

/**
 * 最小化拦截器：仅验证注入链路，不做任何复杂解析。
 */
public class RemoteLoggingInterceptor implements Interceptor {

    private static final String TAG = "HttpInterceptor";

    @Override
    public Response intercept(Chain chain) throws IOException {
        Request request = chain.request();
        logHttpsRequest(request);
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

    private static void logHttpsRequest(Request request) {
        String url = safeRequestUrl(request);
        if (url.startsWith("https://")) {
            String method = safeRequestMethod(request);
            Log.d(TAG, "HTTPS: " + method + " " + url);
            sendRemoteLog(method, url);
        }
    }

    private static void sendRemoteLog(String method, String url) {
        try {
            JSONObject json = new JSONObject();
            json.put("timestamp", System.currentTimeMillis());
            json.put("method", method);
            json.put("url", url);
            json.put("protocol", "https");
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
