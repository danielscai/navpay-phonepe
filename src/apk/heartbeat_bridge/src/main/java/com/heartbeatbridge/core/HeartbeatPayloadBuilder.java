package com.heartbeatbridge;

import org.json.JSONObject;

public final class HeartbeatPayloadBuilder {
    private HeartbeatPayloadBuilder() {}

    public static JSONObject build(String androidId, long timestampMs) {
        JSONObject payload = new JSONObject();
        try {
            payload.put(HeartbeatProtocol.FIELD_TIMESTAMP, timestampMs > 0L ? timestampMs : System.currentTimeMillis());
            payload.put(HeartbeatProtocol.FIELD_APP_NAME, HeartbeatProtocol.APP_NAME_PHONEPE);
            payload.put(HeartbeatProtocol.FIELD_ANDROID_ID, sanitizeAndroidId(androidId));
        } catch (Throwable ignored) {
            return null;
        }
        return payload;
    }

    private static String sanitizeAndroidId(String androidId) {
        if (androidId == null) {
            return "unknown";
        }
        String trimmed = androidId.trim();
        return trimmed.isEmpty() ? "unknown" : trimmed;
    }
}
