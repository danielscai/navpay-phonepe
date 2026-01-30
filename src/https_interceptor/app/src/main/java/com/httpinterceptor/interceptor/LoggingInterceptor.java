package com.httpinterceptor.interceptor;

import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

import okhttp3.Connection;
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
 * HTTP/HTTPS 请求拦截器
 *
 * 功能：
 * 1. 拦截所有 HTTP/HTTPS 请求
 * 2. 记录请求 URL、Headers、Body
 * 3. 记录响应状态码、Headers、Body
 * 4. 计算请求耗时
 *
 * 基于恶意软件 pev70 的 HttpJsonInterceptor 和 PhonePeInterceptor 原理
 * 用于安全研究和教育目的
 */
public class LoggingInterceptor implements Interceptor {

    private static final String TAG = "HttpInterceptor";
    private final InterceptorCallback callback;
    private final SimpleDateFormat dateFormat;

    public interface InterceptorCallback {
        void onRequestIntercepted(InterceptedRequest request);
    }

    public LoggingInterceptor(InterceptorCallback callback) {
        this.callback = callback;
        this.dateFormat = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.getDefault());
    }

    @Override
    public Response intercept(Chain chain) throws IOException {
        Request request = chain.request();
        long startTime = System.nanoTime();
        String timestamp = dateFormat.format(new Date());

        // 构建请求信息
        InterceptedRequest interceptedRequest = new InterceptedRequest();
        interceptedRequest.timestamp = timestamp;
        interceptedRequest.url = request.url().toString();
        interceptedRequest.method = request.method();
        interceptedRequest.protocol = chain.connection() != null ?
            chain.connection().protocol().toString() : "HTTP/1.1";

        // 提取请求头
        interceptedRequest.requestHeaders = headersToString(request.headers());

        // 提取请求体
        interceptedRequest.requestBody = getRequestBody(request);

        Log.d(TAG, "====== REQUEST ======");
        Log.d(TAG, "URL: " + interceptedRequest.url);
        Log.d(TAG, "Method: " + interceptedRequest.method);
        Log.d(TAG, "Headers:\n" + interceptedRequest.requestHeaders);
        if (!interceptedRequest.requestBody.isEmpty()) {
            Log.d(TAG, "Body: " + interceptedRequest.requestBody);
        }

        Response response;
        try {
            // 执行请求
            response = chain.proceed(request);
        } catch (IOException e) {
            interceptedRequest.error = e.getMessage();
            interceptedRequest.durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startTime);

            if (callback != null) {
                callback.onRequestIntercepted(interceptedRequest);
            }
            throw e;
        }

        // 计算耗时
        interceptedRequest.durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startTime);
        interceptedRequest.statusCode = response.code();
        interceptedRequest.statusMessage = response.message();

        // 提取响应头
        interceptedRequest.responseHeaders = headersToString(response.headers());

        // 提取响应体（需要重新包装 Response）
        ResponseBody responseBody = response.body();
        if (responseBody != null) {
            BufferedSource source = responseBody.source();
            source.request(Long.MAX_VALUE);
            Buffer buffer = source.getBuffer().clone();

            MediaType contentType = responseBody.contentType();
            if (contentType != null && isTextContent(contentType)) {
                interceptedRequest.responseBody = buffer.readString(StandardCharsets.UTF_8);
            } else {
                interceptedRequest.responseBody = "[Binary data: " + buffer.size() + " bytes]";
            }
        }

        Log.d(TAG, "====== RESPONSE ======");
        Log.d(TAG, "Status: " + interceptedRequest.statusCode + " " + interceptedRequest.statusMessage);
        Log.d(TAG, "Duration: " + interceptedRequest.durationMs + "ms");
        Log.d(TAG, "Headers:\n" + interceptedRequest.responseHeaders);
        if (interceptedRequest.responseBody != null && !interceptedRequest.responseBody.isEmpty()) {
            Log.d(TAG, "Body: " + truncateString(interceptedRequest.responseBody, 1000));
        }

        // 回调通知
        if (callback != null) {
            callback.onRequestIntercepted(interceptedRequest);
        }

        return response;
    }

    private String getRequestBody(Request request) {
        RequestBody body = request.body();
        if (body == null) {
            return "";
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

    private String headersToString(Headers headers) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < headers.size(); i++) {
            String name = headers.name(i);
            String value = headers.value(i);

            // 对敏感头进行标记
            if (isSensitiveHeader(name)) {
                sb.append(name).append(": ").append(value).append(" [SENSITIVE]\n");
            } else {
                sb.append(name).append(": ").append(value).append("\n");
            }
        }
        return sb.toString().trim();
    }

    private boolean isSensitiveHeader(String name) {
        String lower = name.toLowerCase();
        return lower.contains("authorization") ||
               lower.contains("cookie") ||
               lower.contains("token") ||
               lower.contains("api-key") ||
               lower.contains("x-auth");
    }

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

    private String truncateString(String str, int maxLength) {
        if (str.length() <= maxLength) {
            return str;
        }
        return str.substring(0, maxLength) + "... [truncated]";
    }

    /**
     * 拦截到的请求数据模型
     */
    public static class InterceptedRequest {
        public String timestamp;
        public String url;
        public String method;
        public String protocol;
        public String requestHeaders;
        public String requestBody;
        public int statusCode;
        public String statusMessage;
        public String responseHeaders;
        public String responseBody;
        public long durationMs;
        public String error;

        public String toDisplayString() {
            StringBuilder sb = new StringBuilder();
            sb.append("========================================\n");
            sb.append("Time: ").append(timestamp).append("\n");
            sb.append("URL: ").append(url).append("\n");
            sb.append("Method: ").append(method).append("\n");
            sb.append("Protocol: ").append(protocol).append("\n");
            sb.append("----------------------------------------\n");
            sb.append("REQUEST HEADERS:\n").append(requestHeaders).append("\n");
            if (requestBody != null && !requestBody.isEmpty()) {
                sb.append("REQUEST BODY:\n").append(requestBody).append("\n");
            }
            sb.append("----------------------------------------\n");

            if (error != null) {
                sb.append("ERROR: ").append(error).append("\n");
            } else {
                sb.append("STATUS: ").append(statusCode).append(" ").append(statusMessage).append("\n");
                sb.append("DURATION: ").append(durationMs).append("ms\n");
                sb.append("RESPONSE HEADERS:\n").append(responseHeaders).append("\n");
                if (responseBody != null && !responseBody.isEmpty()) {
                    sb.append("RESPONSE BODY:\n").append(responseBody).append("\n");
                }
            }
            sb.append("========================================\n\n");
            return sb.toString();
        }

        public JSONObject toJson() throws JSONException {
            JSONObject json = new JSONObject();
            json.put("timestamp", timestamp);
            json.put("url", url);
            json.put("method", method);
            json.put("protocol", protocol);
            json.put("request_headers", requestHeaders);
            json.put("request_body", requestBody);
            json.put("status_code", statusCode);
            json.put("status_message", statusMessage);
            json.put("response_headers", responseHeaders);
            json.put("response_body", responseBody);
            json.put("duration_ms", durationMs);
            json.put("error", error);
            return json;
        }
    }
}
