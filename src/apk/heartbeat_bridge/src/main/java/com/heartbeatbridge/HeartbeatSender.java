package com.heartbeatbridge;

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
            payload.put(HeartbeatBridgeContract.EXTRA_CLIENT_DEVICE_ID, resolveAndroidId(context));
        } catch (Throwable t) {
            Log.w(TAG, "Failed to build heartbeat payload", t);
            return;
        }

        String[] endpoints = resolveEndpoints();
        Throwable lastError = null;
        for (String endpoint : endpoints) {
            try {
                int code = postWithHttpURLConnection(endpoint, payload.toString());
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

    private static int postWithHttpURLConnection(String endpoint, String bodyJson) throws IOException {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(endpoint);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(5000);
            connection.setDoOutput(true);

            byte[] bytes = bodyJson.getBytes(StandardCharsets.UTF_8);
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
