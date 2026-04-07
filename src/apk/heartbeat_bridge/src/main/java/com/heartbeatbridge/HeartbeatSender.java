package com.heartbeatbridge;

import android.content.Context;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.Scanner;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class HeartbeatSender {
    private static final String TAG = "HeartbeatBridge";
    private static final String ENDPOINT_OVERRIDE_PROPERTY = "navpay.heartbeat.endpoint";
    private static final String EMULATOR_ENDPOINT = "http://192.168.1.8:3000/api/device/heartbeat";
    private static final String DEVICE_ENDPOINT = "http://192.168.1.8:3000/api/device/heartbeat";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static volatile String pendingCommandAckId = "";
    private static volatile String lastHandledCommandId = "";

    private HeartbeatSender() {}

    public static void sendHeartbeatAsync(Context context, long timestampMs) {
        if (context == null) {
            return;
        }
        final Context appContext = context.getApplicationContext() != null ? context.getApplicationContext() : context;
        EXECUTOR.execute(() -> sendHeartbeat(appContext, timestampMs));
    }

    private static void sendHeartbeat(Context context, long timestampMs) {
        JSONObject payload = HeartbeatPayloadBuilder.build(resolveAndroidId(context), timestampMs);
        if (payload == null) {
            Log.w(TAG, "Failed to build heartbeat payload");
            return;
        }

        String[] endpoints = resolveEndpoints();
        Throwable lastError = null;
        for (String endpoint : endpoints) {
            try {
                HeartbeatExchangeResult exchange = postWithHttpURLConnection(endpoint, payload.toString());
                if (exchange.code >= 200 && exchange.code < 300) {
                    handleHeartbeatCommand(exchange);
                    return;
                }
                lastError = new IllegalStateException("heartbeat request returned code=" + exchange.code + ", endpoint=" + endpoint);
            } catch (Throwable t) {
                lastError = t;
            }
        }

        Log.w(TAG, "heartbeat upload failed for endpoints=" + String.join(", ", endpoints), lastError);
    }

    private static HeartbeatExchangeResult postWithHttpURLConnection(String endpoint, String bodyJson) throws IOException {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(endpoint);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty(HeartbeatProtocol.HEADER_PROTOCOL_VERSION, HeartbeatProtocol.PROTOCOL_VERSION);
            String ackCommandId = pendingCommandAckId == null ? "" : pendingCommandAckId.trim();
            if (!ackCommandId.isEmpty()) {
                connection.setRequestProperty(HeartbeatProtocol.HEADER_COMMAND_ACK, HeartbeatCommandCodec.buildAckHeaderValue(ackCommandId));
            }
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(5000);
            connection.setDoOutput(true);

            byte[] bytes = bodyJson.getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream outputStream = connection.getOutputStream()) {
                outputStream.write(bytes);
            }
            int code = connection.getResponseCode();
            String responseBody = readResponseBody(connection, code);
            String commandHeader = connection.getHeaderField(HeartbeatProtocol.HEADER_COMMAND);
            if (!ackCommandId.isEmpty() && code >= 200 && code < 300) {
                pendingCommandAckId = "";
            }
            return new HeartbeatExchangeResult(code, responseBody, commandHeader);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static void handleHeartbeatCommand(HeartbeatExchangeResult exchange) {
        List<HeartbeatCommandCodec.CommandEnvelope> commands = HeartbeatCommandCodec.parseAll(exchange.commandHeaderValue, exchange.responseBody);
        if (commands.isEmpty()) {
            return;
        }
        for (HeartbeatCommandCodec.CommandEnvelope command : commands) {
            if (!HeartbeatCommandRegistry.isSupported(command.commandType)) {
                Log.i(TAG, "heartbeat command ignored: unsupported type=" + command.commandType);
                continue;
            }
            if (command.commandId != null && command.commandId.equals(lastHandledCommandId)) {
                pendingCommandAckId = command.commandId;
                continue;
            }

            HeartbeatPingHandler.PingResult result = HeartbeatPingHandler.handle(command, System.currentTimeMillis());
            if (result.handled) {
                lastHandledCommandId = result.commandId;
                pendingCommandAckId = result.commandId;
                Log.i(TAG, "downlink ping -> pong, commandId=" + result.commandId);
            }
        }
    }

    private static String readResponseBody(HttpURLConnection connection, int code) {
        InputStream stream = null;
        try {
            stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (stream == null) {
                return "";
            }
            Scanner scanner = new Scanner(stream, StandardCharsets.UTF_8.name()).useDelimiter("\\A");
            return scanner.hasNext() ? scanner.next() : "";
        } catch (Throwable ignored) {
            return "";
        } finally {
            if (stream != null) {
                try {
                    stream.close();
                } catch (IOException ignored) {
                    // no-op
                }
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

    private static final class HeartbeatExchangeResult {
        final int code;
        final String responseBody;
        final String commandHeaderValue;

        private HeartbeatExchangeResult(int code, String responseBody, String commandHeaderValue) {
            this.code = code;
            this.responseBody = responseBody == null ? "" : responseBody;
            this.commandHeaderValue = commandHeaderValue == null ? "" : commandHeaderValue;
        }
    }
}
