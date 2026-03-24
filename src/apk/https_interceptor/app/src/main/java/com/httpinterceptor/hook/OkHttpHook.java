package com.httpinterceptor.hook;

import android.util.Log;

import com.httpinterceptor.interceptor.RemoteLoggingInterceptor;
import com.httpinterceptor.interceptor.LogSender;

import okhttp3.OkHttpClient;

/**
 * OkHttp Hook 工具类
 *
 * 用于在运行时通过 Pine 框架 Hook OkHttpClient.Builder.build() 方法
 * 注入自定义拦截器
 *
 * 使用方法：
 * 在 Pine Hook 回调中调用 OkHttpHook.hookBuild(builder)
 */
public class OkHttpHook {

    private static final String TAG = "OkHttpHook";

    // 是否已初始化
    private static boolean initialized = false;

    /**
     * 初始化
     *
     * @param serverUrl 日志服务器地址
     */
    public static void init(String serverUrl) {
        initialized = true;
        if (serverUrl != null && !serverUrl.trim().isEmpty()) {
            LogSender.setServerUrl(serverUrl);
        }
        Log.i(TAG, "OkHttpHook initialized, upload endpoint=" + LogSender.getServerUrl());
    }

    /**
     * Hook OkHttpClient.Builder.build() 方法
     *
     * 这个方法应该在 Pine Hook 回调中被调用
     *
     * @param builder OkHttpClient.Builder 实例
     * @return 构建好的 OkHttpClient
     */
    public static OkHttpClient hookBuild(OkHttpClient.Builder builder) {
        if (!initialized) {
            init(null);
        }

        Log.d(TAG, "Injecting interceptors into OkHttpClient");

        // 注入远程日志拦截器
        builder.addInterceptor(new RemoteLoggingInterceptor());

        // 可选：禁用 SSL 证书验证（仅用于测试）
        // CertificatePinnerBypass.configureTrustAll(builder);

        return builder.build();
    }

    /**
     * 创建已注入拦截器的 OkHttpClient
     *
     * 便捷方法，用于直接创建 Client
     */
    public static OkHttpClient createClient() {
        return hookBuild(new OkHttpClient.Builder());
    }

    // 预留接口：以后如果需要远程日志，再补回配置入口
}
