package com.heartbeatbridge;

import android.content.Context;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONObject;

import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class HeartbeatSender {
    private static final String TAG = "HeartbeatBridge";
    private static final String ENDPOINT_OVERRIDE_PROPERTY = "navpay.heartbeat.endpoint";
    private static final String EMULATOR_ENDPOINT = "http://10.0.2.2:3000/api/device/heartbeat";
    private static final String DEVICE_ENDPOINT = "http://127.0.0.1:3000/api/device/heartbeat";
    private static final String APP_NAME = HeartbeatBridgeContract.APP_NAME_PHONEPE;
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    private HeartbeatSender() {}

    public static void sendHeartbeatAsync(Context context, long timestampMs) {
        if (context == null) {
            return;
        }
        final Context appContext = context.getApplicationContext() != null ? context.getApplicationContext() : context;
        EXECUTOR.execute(() -> sendHeartbeat(appContext, timestampMs));
    }

    private static void sendHeartbeat(Context context, long timestampMs) {
        JSONObject payload = new JSONObject();
        try {
            payload.put(HeartbeatBridgeContract.EXTRA_TIMESTAMP, timestampMs > 0L ? timestampMs : System.currentTimeMillis());
            payload.put(HeartbeatBridgeContract.EXTRA_APP_NAME, APP_NAME);
            payload.put(HeartbeatBridgeContract.EXTRA_ANDROID_ID, resolveAndroidId(context));
        } catch (Throwable t) {
            Log.w(TAG, "Failed to build heartbeat payload", t);
            return;
        }

        String[] endpoints = resolveEndpoints();
        Throwable lastError = null;
        for (String endpoint : endpoints) {
            try {
                int code = postWithOkHttp(endpoint, payload.toString());
                if (code >= 200 && code < 300) {
                    return;
                }
                lastError = new IllegalStateException("heartbeat request returned code=" + code + ", endpoint=" + endpoint);
            } catch (Throwable t) {
                lastError = t;
            }
        }

        Log.w(TAG, "heartbeat upload failed for endpoints=" + String.join(", ", endpoints), lastError);
    }

    private static int postWithOkHttp(String endpoint, String bodyJson) throws Exception {
        Class<?> mediaTypeClass = Class.forName("okhttp3.MediaType");
        Class<?> requestBodyClass = Class.forName("okhttp3.RequestBody");
        Class<?> requestBuilderClass = Class.forName("okhttp3.Request$Builder");
        Class<?> requestClass = Class.forName("okhttp3.Request");
        Class<?> okHttpClientClass = Class.forName("okhttp3.OkHttpClient");

        Object mediaType = resolveMediaType(mediaTypeClass);
        Object requestBody = createRequestBody(requestBodyClass, mediaTypeClass, mediaType, bodyJson);

        Object builder = requestBuilderClass.getConstructor().newInstance();
        requestBuilderClass.getMethod("url", String.class).invoke(builder, endpoint);
        requestBuilderClass.getMethod("post", requestBodyClass).invoke(builder, requestBody);
        Object request = requestBuilderClass.getMethod("build").invoke(builder);

        Object client = okHttpClientClass.getConstructor().newInstance();
        Object call = okHttpClientClass.getMethod("newCall", requestClass).invoke(client, request);
        Object response = call.getClass().getMethod("execute").invoke(call);
        try {
            Object codeObj = response.getClass().getMethod("code").invoke(response);
            return codeObj instanceof Number ? ((Number) codeObj).intValue() : 0;
        } finally {
            try {
                response.getClass().getMethod("close").invoke(response);
            } catch (Throwable ignored) {
                // no-op
            }
        }
    }

    private static Object resolveMediaType(Class<?> mediaTypeClass) throws Exception {
        for (String methodName : new String[] {"parse", "get"}) {
            try {
                Method m = mediaTypeClass.getMethod(methodName, String.class);
                return m.invoke(null, "application/json; charset=utf-8");
            } catch (NoSuchMethodException ignored) {
                // try next
            }
        }
        throw new NoSuchMethodException("okhttp3.MediaType parse/get not found");
    }

    private static Object createRequestBody(
            Class<?> requestBodyClass,
            Class<?> mediaTypeClass,
            Object mediaType,
            String bodyJson
    ) throws Exception {
        try {
            Method create = requestBodyClass.getMethod("create", mediaTypeClass, String.class);
            return create.invoke(null, mediaType, bodyJson);
        } catch (NoSuchMethodException ignored) {
            Method create = requestBodyClass.getMethod("create", mediaTypeClass, byte[].class);
            return create.invoke(null, mediaType, bodyJson.getBytes(StandardCharsets.UTF_8));
        }
    }

    private static String resolveAndroidId(Context context) {
        try {
            String value = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
            if (value != null) {
                String trimmed = value.trim();
                if (!trimmed.isEmpty()) {
                    return trimmed;
                }
            }
        } catch (Throwable ignored) {
            // no-op
        }
        return "unknown";
    }

    private static String[] resolveEndpoints() {
        String override = System.getProperty(ENDPOINT_OVERRIDE_PROPERTY, "").trim();
        if (!override.isEmpty()) {
            return new String[] { override };
        }
        if (isLikelyEmulator()) {
            return new String[] { EMULATOR_ENDPOINT, DEVICE_ENDPOINT };
        }
        return new String[] { DEVICE_ENDPOINT, EMULATOR_ENDPOINT };
    }

    private static boolean isLikelyEmulator() {
        String fingerprint = Build.FINGERPRINT == null ? "" : Build.FINGERPRINT;
        String model = Build.MODEL == null ? "" : Build.MODEL;
        String product = Build.PRODUCT == null ? "" : Build.PRODUCT;
        String hardware = Build.HARDWARE == null ? "" : Build.HARDWARE;

        return fingerprint.contains("generic")
                || fingerprint.contains("emulator")
                || model.contains("Emulator")
                || model.contains("Android SDK built for")
                || product.contains("sdk")
                || hardware.contains("goldfish")
                || hardware.contains("ranchu");
    }
}
