package com.httpinterceptor.interceptor;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import okhttp3.Interceptor;
import okhttp3.MediaType;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.Buffer;
import okio.BufferedSource;

/**
 * Token 拦截器
 *
 * 模拟恶意软件 PhonePeInterceptor.java 的行为
 * 拦截特定 URL 模式，提取认证 Token
 *
 * 用于安全研究，演示恶意软件如何窃取认证信息
 */
public class TokenInterceptor implements Interceptor {

    private static final String TAG = "TokenInterceptor";

    // URL 模式匹配规则
    private final List<UrlPattern> urlPatterns = new ArrayList<>();

    // 拦截回调
    private final TokenCallback callback;

    public interface TokenCallback {
        void onTokenFound(String patternName, String url, String tokenInfo);
    }

    public TokenInterceptor(TokenCallback callback) {
        this.callback = callback;
        initPatterns();
    }

    private void initPatterns() {
        // 模拟 PhonePeInterceptor 中的 URL 匹配规则
        // 这些是通用的认证相关 URL 模式

        // OAuth/Token 端点
        urlPatterns.add(new UrlPattern("OAuth Token", Pattern.compile(".*/(oauth|auth)/token.*", Pattern.CASE_INSENSITIVE)));
        urlPatterns.add(new UrlPattern("Login", Pattern.compile(".*/login.*", Pattern.CASE_INSENSITIVE)));
        urlPatterns.add(new UrlPattern("Session", Pattern.compile(".*/session.*", Pattern.CASE_INSENSITIVE)));

        // API 认证
        urlPatterns.add(new UrlPattern("API Auth", Pattern.compile(".*/api/.*/auth.*", Pattern.CASE_INSENSITIVE)));
        urlPatterns.add(new UrlPattern("User Profile", Pattern.compile(".*/user/profile.*", Pattern.CASE_INSENSITIVE)));

        // JWT/Bearer Token
        urlPatterns.add(new UrlPattern("Refresh Token", Pattern.compile(".*refresh.*token.*", Pattern.CASE_INSENSITIVE)));
    }

    @Override
    public Response intercept(Chain chain) throws IOException {
        Request request = chain.request();
        String url = request.url().toString();

        // 检查请求头中的认证信息
        checkRequestHeaders(request);

        // 执行请求
        Response response = chain.proceed(request);

        // 检查 URL 是否匹配任何模式
        for (UrlPattern pattern : urlPatterns) {
            if (pattern.pattern.matcher(url).matches()) {
                Log.d(TAG, "URL matched pattern: " + pattern.name);

                // 读取响应体
                ResponseBody responseBody = response.body();
                if (responseBody != null) {
                    BufferedSource source = responseBody.source();
                    source.request(Long.MAX_VALUE);
                    Buffer buffer = source.getBuffer().clone();
                    String bodyString = buffer.readString(StandardCharsets.UTF_8);

                    // 尝试提取 Token
                    extractTokens(pattern.name, url, bodyString);
                }
                break;
            }
        }

        return response;
    }

    private void checkRequestHeaders(Request request) {
        // 检查请求头中的认证信息
        String authHeader = request.header("Authorization");
        if (authHeader != null) {
            Log.w(TAG, "[SENSITIVE] Authorization header found: " + maskToken(authHeader));
            if (callback != null) {
                callback.onTokenFound("Request Auth Header", request.url().toString(),
                    "Authorization: " + maskToken(authHeader));
            }
        }

        String cookieHeader = request.header("Cookie");
        if (cookieHeader != null && (cookieHeader.contains("token") || cookieHeader.contains("session"))) {
            Log.w(TAG, "[SENSITIVE] Token/Session in Cookie");
            if (callback != null) {
                callback.onTokenFound("Request Cookie", request.url().toString(),
                    "Cookie contains token/session info");
            }
        }
    }

    private void extractTokens(String patternName, String url, String body) {
        if (body == null || body.isEmpty()) {
            return;
        }

        StringBuilder tokenInfo = new StringBuilder();

        // 尝试解析为 JSON
        try {
            JSONObject json = new JSONObject(body);

            // 查找常见的 Token 字段
            String[] tokenFields = {
                "token", "access_token", "accessToken",
                "refresh_token", "refreshToken",
                "id_token", "idToken",
                "auth_token", "authToken",
                "session_token", "sessionToken",
                "bearer", "jwt"
            };

            for (String field : tokenFields) {
                if (json.has(field)) {
                    String value = json.optString(field);
                    if (!value.isEmpty()) {
                        tokenInfo.append(field).append(": ").append(maskToken(value)).append("\n");
                        Log.w(TAG, "[TOKEN FOUND] " + field + " = " + maskToken(value));
                    }
                }
            }

            // 查找 userId/phoneNumber 等身份信息
            String[] identityFields = {"userId", "user_id", "phoneNumber", "phone", "email", "username"};
            for (String field : identityFields) {
                if (json.has(field)) {
                    String value = json.optString(field);
                    if (!value.isEmpty()) {
                        tokenInfo.append(field).append(": ").append(value).append("\n");
                        Log.w(TAG, "[IDENTITY FOUND] " + field + " = " + value);
                    }
                }
            }

        } catch (JSONException e) {
            // 不是有效的 JSON，尝试正则匹配
            Pattern tokenPattern = Pattern.compile("\"(access_token|token|refresh_token)\"\\s*:\\s*\"([^\"]+)\"");
            Matcher matcher = tokenPattern.matcher(body);
            while (matcher.find()) {
                String field = matcher.group(1);
                String value = matcher.group(2);
                tokenInfo.append(field).append(": ").append(maskToken(value)).append("\n");
                Log.w(TAG, "[TOKEN FOUND (regex)] " + field + " = " + maskToken(value));
            }
        }

        // 通知回调
        if (tokenInfo.length() > 0 && callback != null) {
            callback.onTokenFound(patternName, url, tokenInfo.toString());
        }
    }

    /**
     * 遮蔽 Token 中间部分，保留前后几个字符
     */
    private String maskToken(String token) {
        if (token == null || token.length() <= 10) {
            return "****";
        }
        return token.substring(0, 5) + "..." + token.substring(token.length() - 5);
    }

    private static class UrlPattern {
        String name;
        Pattern pattern;

        UrlPattern(String name, Pattern pattern) {
            this.name = name;
            this.pattern = pattern;
        }
    }
}
