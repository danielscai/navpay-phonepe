package com.httpinterceptor.interceptor;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;

/**
 * 日志发送器
 *
 * 将拦截到的 HTTP 请求日志发送到本地服务器
 * 使用队列和线程池确保不阻塞主请求
 */
public class LogSender {

    private static final String TAG = "LogSender";

    // 默认服务器地址 (通过 adb reverse 映射)
    private static String serverUrl = "http://127.0.0.1:8088/api/log";

    // 单例
    private static volatile LogSender instance;

    // 日志队列
    private final LinkedBlockingQueue<JSONObject> logQueue;

    // 发送线程池
    private final ExecutorService executor;

    // 是否启用
    private volatile boolean enabled = true;

    // 发送失败计数
    private int failureCount = 0;
    private static final int MAX_FAILURES = 10;

    private LogSender() {
        logQueue = new LinkedBlockingQueue<>(1000);
        executor = Executors.newSingleThreadExecutor();

        // 启动发送线程
        executor.submit(this::sendLoop);
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
        serverUrl = url;
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

        // 添加到队列，如果队列满了则丢弃最旧的
        if (!logQueue.offer(logData)) {
            logQueue.poll();
            logQueue.offer(logData);
        }
    }

    /**
     * 发送日志 (便捷方法)
     */
    public void sendLog(LoggingInterceptor.InterceptedRequest request) {
        try {
            JSONObject json = request.toJson();
            sendLog(json);
        } catch (JSONException e) {
            Log.e(TAG, "Error converting request to JSON", e);
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

    /**
     * 发送循环
     */
    private void sendLoop() {
        while (!Thread.currentThread().isInterrupted()) {
            try {
                JSONObject log = logQueue.take();
                boolean success = doSend(log);

                if (success) {
                    failureCount = 0;
                } else {
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
        HttpURLConnection connection = null;
        try {
            URL url = new URL(serverUrl);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(5000);
            connection.setDoOutput(true);

            byte[] body = log.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(body.length);

            try (OutputStream os = connection.getOutputStream()) {
                os.write(body);
            }

            int responseCode = connection.getResponseCode();
            if (responseCode == 200) {
                return true;
            } else {
                Log.w(TAG, "Server returned: " + responseCode);
                return false;
            }
        } catch (IOException e) {
            Log.w(TAG, "Failed to send log: " + e.getMessage());
            return false;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    /**
     * 关闭
     */
    public void shutdown() {
        executor.shutdownNow();
    }
}
