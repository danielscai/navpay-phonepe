package com.phonepehelper;

import android.content.Context;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
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
                int code = postHeartbeat(endpoint, body);
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

    // Reference scheme from https_interceptor LogSender: use plain HttpURLConnection.
    private static int postHeartbeat(String endpoint, String body) throws IOException {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(endpoint);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(5000);
            connection.setDoOutput(true);

            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream outputStream = connection.getOutputStream()) {
                outputStream.write(bytes);
            }
            return connection.getResponseCode();
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
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
