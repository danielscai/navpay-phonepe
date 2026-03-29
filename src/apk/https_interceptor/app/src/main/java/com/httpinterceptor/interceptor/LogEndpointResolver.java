package com.httpinterceptor.interceptor;

/**
 * Resolve the log upload endpoint for the interceptor APK.
 *
 * Default to navpay-admin ingestion API.
 * If callers need legacy log_server, they should pass explicit override URL
 * (for example http://127.0.0.1:8088/api/log).
 */
public final class LogEndpointResolver {

    public static final String LEGACY_DEBUG_ENDPOINT = "http://127.0.0.1:8088/api/log";
    public static final String ADMIN_EMULATOR_ENDPOINT = "http://10.0.2.2:3000/api/admin/intercept/logs";
    public static final String ADMIN_HOST_LOOPBACK_ENDPOINT = "http://127.0.0.1:3000/api/admin/intercept/logs";
    public static final String HEARTBEAT_EMULATOR_ENDPOINT = "http://10.0.2.2:3000/api/device/heartbeat";
    public static final String HEARTBEAT_HOST_LOOPBACK_ENDPOINT = "http://127.0.0.1:3000/api/device/heartbeat";

    private LogEndpointResolver() {
        // no instances
    }

    public static String resolve(String overrideUrl) {
        return resolve(isDebugBuild(), overrideUrl);
    }

    public static String resolve(boolean debugBuild, String overrideUrl) {
        String normalizedOverride = normalize(overrideUrl);
        if (normalizedOverride != null) {
            return normalizedOverride;
        }
        return ADMIN_EMULATOR_ENDPOINT;
    }

    public static String[] releaseFallbackCandidates() {
        return new String[] { ADMIN_EMULATOR_ENDPOINT, ADMIN_HOST_LOOPBACK_ENDPOINT };
    }

    public static String resolveHeartbeat(String overrideUrl) {
        String normalizedOverride = normalize(overrideUrl);
        if (normalizedOverride != null) {
            return normalizedOverride;
        }
        return HEARTBEAT_EMULATOR_ENDPOINT;
    }

    public static String[] heartbeatFallbackCandidates() {
        return new String[] { HEARTBEAT_EMULATOR_ENDPOINT, HEARTBEAT_HOST_LOOPBACK_ENDPOINT };
    }

    public static boolean isDebugBuild() {
        try {
            Class<?> buildConfig = Class.forName("com.httpinterceptor.BuildConfig");
            return buildConfig.getField("DEBUG").getBoolean(null);
        } catch (Throwable ignored) {
            // compile.sh 路径下没有 BuildConfig，按 debug 处理更安全
            return true;
        }
    }

    private static String normalize(String url) {
        if (url == null) {
            return null;
        }
        String trimmed = url.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
