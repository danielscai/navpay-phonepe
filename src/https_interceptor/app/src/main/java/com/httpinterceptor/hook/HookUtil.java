package com.httpinterceptor.hook;

import android.util.Log;

import com.httpinterceptor.interceptor.RemoteLoggingInterceptor;

import okhttp3.OkHttpClient;

/**
 * HookUtil build entry for patched OkHttpClient.Builder.build().
 *
 * IMPORTANT: Do not call builder.build() here to avoid recursion.
 */
public final class HookUtil {

    private static final String TAG = "HttpInterceptor";

    private HookUtil() {
        // no instances
    }

    public static OkHttpClient build(OkHttpClient.Builder builder) {
        try {
            builder.addInterceptor(new RemoteLoggingInterceptor());
            Log.d(TAG, "Injected RemoteLoggingInterceptor via HookUtil.build()");
        } catch (Throwable t) {
            Log.e(TAG, "Failed to inject interceptor", t);
        }

        // Avoid recursion: create OkHttpClient directly.
        return new OkHttpClient(builder);
    }
}
