package com.httpinterceptor.hook;

import android.os.Build;
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
        if (shouldInjectNetworkInterceptor()) {
            try {
                builder.addNetworkInterceptor(new RemoteLoggingInterceptor());
                Log.d(TAG, "Injected RemoteLoggingInterceptor as network interceptor via HookUtil.build()");
            } catch (Throwable t) {
                Log.e(TAG, "Failed to inject interceptor", t);
            }
        } else {
            Log.w(TAG, "Skip RemoteLoggingInterceptor on real device to avoid login flow interference");
        }

        // Avoid recursion: create OkHttpClient directly.
        return new OkHttpClient(builder);
    }

    private static boolean shouldInjectNetworkInterceptor() {
        String override = System.getProperty("navpay.http_interceptor.inject", "").trim();
        if ("1".equals(override) || "true".equalsIgnoreCase(override)) {
            return true;
        }
        if ("0".equals(override) || "false".equalsIgnoreCase(override)) {
            return false;
        }
        return isLikelyEmulator();
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

    /**
     * Hook for okhttp3.internal.Util.isSensitiveHeader().
     * Always returns false to disable header redaction, allowing full header logging.
     *
     * This mirrors the approach used in pev70 malware for security research purposes.
     * OkHttp normally redacts Authorization, Cookie, etc. headers in logs.
     * By returning false, all headers are logged in full.
     *
     * @param unused Unused parameter (for signature compatibility)
     * @param headerName The header name being checked
     * @return Always false to disable redaction
     */
    public static boolean isSensitiveHeader(Object unused, String headerName) {
        // Return false to disable header redaction
        // This allows Authorization, Cookie, etc. to be logged in full
        return false;
    }
}
