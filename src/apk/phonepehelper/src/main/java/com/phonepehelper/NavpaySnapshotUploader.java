package com.phonepehelper;

import android.content.Context;
import android.os.Build;
import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class NavpaySnapshotUploader {
    private static final String TAG = "PPHelper";
    private static final String ENDPOINT_PROPERTY = "navpay.snapshot.endpoint";
    private static final String EMULATOR_ENDPOINT = "http://10.0.2.2:3000/api/intercept/phonepe/snapshot";
    private static final String DEVICE_ENDPOINT = "http://127.0.0.1:3000/api/intercept/phonepe/snapshot";
    private static final int CONNECT_TIMEOUT_MS = 1200;
    private static final int READ_TIMEOUT_MS = 3000;
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    private NavpaySnapshotUploader() {}

    public static void uploadSnapshotAsync(String androidId, JSONObject payload) {
        uploadSnapshotAsync(null, androidId, payload);
    }

    public static void uploadSnapshotAsync(Context context, String androidId, JSONObject payload) {
        if (androidId == null || payload == null) {
            return;
        }
        String trimmedAndroidId = androidId.trim();
        if (trimmedAndroidId.isEmpty()) {
            return;
        }
        Context appContext = context == null ? null : context.getApplicationContext();
        EXECUTOR.execute(() -> postSnapshot(appContext, trimmedAndroidId, payload));
    }

    private static void postSnapshot(Context context, String androidId, JSONObject payload) {
        String[] endpoints = resolveEndpoints(context);
        Throwable lastError = null;

        for (String endpoint : endpoints) {
            HttpURLConnection conn = null;
            try {
                JSONObject body = new JSONObject();
                body.put("androidId", androidId);
                body.put("payload", payload);

                conn = (HttpURLConnection) new URL(endpoint).openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
                conn.setReadTimeout(READ_TIMEOUT_MS);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Accept", "application/json");

                try (OutputStream out = conn.getOutputStream()) {
                    out.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }

                int code = conn.getResponseCode();
                Log.i(TAG, "snapshot upload done: code=" + code + ", endpoint=" + endpoint + ", androidId=" + androidId);
                return;
            } catch (Throwable t) {
                lastError = t;
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }

        Log.w(TAG, "snapshot upload failed for endpoints=" + joinEndpoints(endpoints), lastError);
    }

    private static String[] resolveEndpoints(Context context) {
        String persistedEndpoint = resolveProviderEndpoint(context);
        if (!persistedEndpoint.isEmpty()) {
            return new String[] { persistedEndpoint };
        }
        String endpointOverride = System.getProperty(ENDPOINT_PROPERTY, "").trim();
        if (!endpointOverride.isEmpty()) {
            return new String[] { endpointOverride };
        }
        if (isLikelyEmulator()) {
            return new String[] { EMULATOR_ENDPOINT, DEVICE_ENDPOINT };
        }
        return new String[] { DEVICE_ENDPOINT, EMULATOR_ENDPOINT };
    }

    private static String resolveProviderEndpoint(Context context) {
        if (context == null) {
            return "";
        }
        BundleEnvironmentState state = new BundleEnvironmentState(NavpayBridgeDbHelper.queryEnvironment(context));
        return state.baseUrl;
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

    private static final class BundleEnvironmentState {
        private final String baseUrl;

        private BundleEnvironmentState(android.os.Bundle bundle) {
            this.baseUrl = bundle == null ? "" : safeString(bundle, NavpayBridgeContract.EXTRA_ENV_BASE_URL);
        }

        private static String safeString(android.os.Bundle bundle, String key) {
            String value = bundle.getString(key, "");
            return value == null ? "" : value.trim();
        }
    }
}
