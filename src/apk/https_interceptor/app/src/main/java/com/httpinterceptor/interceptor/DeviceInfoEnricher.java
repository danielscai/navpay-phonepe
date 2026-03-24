package com.httpinterceptor.interceptor;

import java.util.Map;

final class DeviceInfoEnricher {

    private DeviceInfoEnricher() {
        // no instances
    }

    static Map<String, Object> enrich(Map<String, Object> payload, DeviceSnapshot snapshot) {
        if (payload == null) {
            throw new IllegalArgumentException("payload == null");
        }
        if (snapshot == null) {
            snapshot = new DeviceSnapshot(
                "unknown",
                "unknown",
                "unknown",
                "unknown",
                "unknown",
                "unknown",
                -1,
                "unknown",
                "unknown"
            );
        }

        String canonicalDeviceId = firstNonEmpty(
            normalizedString(payload.get("androidId")),
            normalizedString(payload.get("clientDeviceId")),
            normalizedString(snapshot.androidId),
            normalizedString(snapshot.clientDeviceId)
        );
        if (isMissingOrEmpty(payload, "androidId")) {
            payload.put("androidId", canonicalDeviceId);
        }
        if (isMissingOrEmpty(payload, "clientDeviceId")) {
            payload.put("clientDeviceId", canonicalDeviceId);
        }
        if (isMissingOrEmpty(payload, "deviceName")) {
            payload.put("deviceName", snapshot.deviceName);
        }
        if (isMissingOrEmpty(payload, "brand")) {
            payload.put("brand", snapshot.brand);
        }
        if (isMissingOrEmpty(payload, "model")) {
            payload.put("model", snapshot.model);
        }
        if (isMissingOrEmpty(payload, "osVersion")) {
            payload.put("osVersion", snapshot.osVersion);
        }
        if (isMissingOrEmpty(payload, "sdkInt")) {
            payload.put("sdkInt", snapshot.sdkInt);
        }
        if (isMissingOrEmpty(payload, "timezone")) {
            payload.put("timezone", snapshot.timezone);
        }
        if (isMissingOrEmpty(payload, "locale")) {
            payload.put("locale", snapshot.locale);
        }

        return payload;
    }

    private static String firstNonEmpty(String... values) {
        if (values == null) {
            return "unknown";
        }
        for (String value : values) {
            String normalized = normalizedString(value);
            if (normalized != null) {
                return normalized;
            }
        }
        return "unknown";
    }

    private static String normalizedString(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        if (trimmed.isEmpty() || "unknown".equalsIgnoreCase(trimmed)) {
            return null;
        }
        return trimmed;
    }

    private static String normalizedString(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof String) {
            return normalizedString((String) value);
        }
        String text = String.valueOf(value).trim();
        return text.isEmpty() ? null : text;
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
}
