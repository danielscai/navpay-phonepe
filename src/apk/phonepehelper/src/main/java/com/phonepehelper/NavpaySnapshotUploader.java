package com.phonepehelper;

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
    private static final String ENDPOINT = "http://10.0.2.2:3000/api/intercept/phonepe/snapshot";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    private NavpaySnapshotUploader() {}

    public static void uploadSnapshotAsync(String androidId, JSONObject payload) {
        if (androidId == null || payload == null) {
            return;
        }
        String trimmedAndroidId = androidId.trim();
        if (trimmedAndroidId.isEmpty()) {
            return;
        }
        EXECUTOR.execute(() -> postSnapshot(trimmedAndroidId, payload));
    }

    private static void postSnapshot(String androidId, JSONObject payload) {
        HttpURLConnection conn = null;
        try {
            JSONObject body = new JSONObject();
            body.put("androidId", androidId);
            body.put("payload", payload);

            conn = (HttpURLConnection) new URL(ENDPOINT).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(5000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");

            try (OutputStream out = conn.getOutputStream()) {
                out.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }

            int code = conn.getResponseCode();
            Log.i(TAG, "snapshot upload done: code=" + code + ", androidId=" + androidId);
        } catch (Throwable t) {
            Log.w(TAG, "snapshot upload failed", t);
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }
}
