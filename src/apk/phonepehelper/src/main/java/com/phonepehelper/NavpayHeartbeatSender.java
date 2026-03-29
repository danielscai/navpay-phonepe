package com.phonepehelper;

import android.content.Context;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONObject;

import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public final class NavpayHeartbeatSender {
    private static final String TAG = "PPHelper";
    private static final String HEARTBEAT_ENDPOINT_PROPERTY = "navpay.heartbeat.endpoint";
    private static final String HEARTBEAT_EMULATOR_ENDPOINT = "http://10.0.2.2:3000/api/device/heartbeat";
    private static final String HEARTBEAT_DEVICE_ENDPOINT = "http://127.0.0.1:3000/api/device/heartbeat";
    private static final String HEARTBEAT_APP_NAME = "phonepe";
    private static final long HEARTBEAT_INTERVAL_MS = 30_000L;
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final ScheduledExecutorService SCHEDULER = Executors.newSingleThreadScheduledExecutor();
    private static volatile boolean started = false;

    private NavpayHeartbeatSender() {}

    public static void sendHeartbeatAsync(Context context, long timestampMs) {
        if (context == null) {
            return;
        }
        final Context appContext = context.getApplicationContext() != null ? context.getApplicationContext() : context;
        EXECUTOR.execute(() -> sendHeartbeat(appContext, timestampMs));
    }

    public static synchronized void startIfNeeded(Context context) {
        if (context == null || started) {
            return;
        }
        final Context appContext = context.getApplicationContext() != null ? context.getApplicationContext() : context;
        started = true;
        SCHEDULER.scheduleAtFixedRate(
                () -> sendHeartbeatAsync(appContext, System.currentTimeMillis()),
                HEARTBEAT_INTERVAL_MS,
                HEARTBEAT_INTERVAL_MS,
                TimeUnit.MILLISECONDS
        );
        sendHeartbeatAsync(appContext, System.currentTimeMillis());
        Log.i(TAG, "heartbeat scheduler started, intervalMs=" + HEARTBEAT_INTERVAL_MS);
    }

    private static void sendHeartbeat(Context context, long timestampMs) {
        String clientDeviceId = resolveAndroidId(context);
        JSONObject heartbeat = new JSONObject();
        try {
            heartbeat.put("timestamp", timestampMs > 0L ? timestampMs : System.currentTimeMillis());
            heartbeat.put("appName", HEARTBEAT_APP_NAME);
            heartbeat.put("clientDeviceId", clientDeviceId);
        } catch (Throwable t) {
            Log.w(TAG, "build heartbeat payload failed", t);
            return;
        }

        String body = heartbeat.toString();
        String[] endpoints = resolveEndpoints();
        Throwable lastError = null;
        for (String endpoint : endpoints) {
            try {
                int code = postWithOkHttp(endpoint, body);
                if (code >= 200 && code < 300) {
                    return;
                }
                lastError = new IllegalStateException("heartbeat code=" + code + ", endpoint=" + endpoint);
            } catch (Throwable t) {
                lastError = t;
            }
        }
        Log.w(TAG, "heartbeat upload failed for endpoints=" + joinEndpoints(endpoints), lastError);
    }

    private static int postWithOkHttp(String endpoint, String body) throws Exception {
        Class<?> mediaTypeClass = Class.forName("okhttp3.MediaType");
        Class<?> requestBodyClass = Class.forName("okhttp3.RequestBody");
        Class<?> requestBuilderClass = Class.forName("okhttp3.Request$Builder");
        Class<?> requestClass = Class.forName("okhttp3.Request");
        Class<?> okHttpClientClass = Class.forName("okhttp3.OkHttpClient");

        Method parseMethod = mediaTypeClass.getMethod("parse", String.class);
        Object mediaType = parseMethod.invoke(null, "application/json; charset=utf-8");
        Object requestBody = createRequestBody(requestBodyClass, mediaTypeClass, mediaType, body);

        Object builder = requestBuilderClass.getConstructor().newInstance();
        requestBuilderClass.getMethod("url", String.class).invoke(builder, endpoint);
        requestBuilderClass.getMethod("post", requestBodyClass).invoke(builder, requestBody);
        Object request = requestBuilderClass.getMethod("build").invoke(builder);

        Object client = okHttpClientClass.getConstructor().newInstance();
        Object call = okHttpClientClass.getMethod("newCall", requestClass).invoke(client, request);
        Object response = call.getClass().getMethod("execute").invoke(call);
        try {
            Object codeObj = response.getClass().getMethod("code").invoke(response);
            if (codeObj instanceof Number) {
                return ((Number) codeObj).intValue();
            }
            return 0;
        } finally {
            try {
                response.getClass().getMethod("close").invoke(response);
            } catch (Throwable ignored) {
                // no-op
            }
        }
    }

    private static Object createRequestBody(
            Class<?> requestBodyClass,
            Class<?> mediaTypeClass,
            Object mediaType,
            String body
    ) throws Exception {
        try {
            Method create = requestBodyClass.getMethod("create", mediaTypeClass, String.class);
            return create.invoke(null, mediaType, body);
        } catch (NoSuchMethodException ignored) {
            Method create = requestBodyClass.getMethod("create", mediaTypeClass, byte[].class);
            return create.invoke(null, mediaType, body.getBytes(StandardCharsets.UTF_8));
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
        String endpointOverride = System.getProperty(HEARTBEAT_ENDPOINT_PROPERTY, "").trim();
        if (!endpointOverride.isEmpty()) {
            return new String[] { endpointOverride };
        }
        if (isLikelyEmulator()) {
            return new String[] { HEARTBEAT_EMULATOR_ENDPOINT, HEARTBEAT_DEVICE_ENDPOINT };
        }
        return new String[] { HEARTBEAT_DEVICE_ENDPOINT, HEARTBEAT_EMULATOR_ENDPOINT };
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

    private static String joinEndpoints(String[] endpoints) {
        if (endpoints == null || endpoints.length == 0) {
            return "";
        }
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < endpoints.length; i++) {
            if (i > 0) {
                builder.append(", ");
            }
            builder.append(endpoints[i]);
        }
        return builder.toString();
    }
}
