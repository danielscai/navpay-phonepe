package com.httpinterceptor.interceptor;

final class AndroidIdCache {

    interface Lookup {
        String fetch() throws Exception;
    }

    private static final String UNKNOWN = "unknown";

    private String cachedAndroidId;

    synchronized String get(Lookup lookup) {
        if (cachedAndroidId != null) {
            return cachedAndroidId;
        }

        String resolved = UNKNOWN;
        try {
            if (lookup != null) {
                resolved = normalize(lookup.fetch());
            }
        } catch (Throwable ignored) {
            resolved = UNKNOWN;
        }

        if (!UNKNOWN.equals(resolved)) {
            cachedAndroidId = resolved;
            return cachedAndroidId;
        }

        return UNKNOWN;
    }

    private static String normalize(String value) {
        if (value == null) {
            return UNKNOWN;
        }
        String trimmed = value.trim();
        if (trimmed.isEmpty() || UNKNOWN.equalsIgnoreCase(trimmed)) {
            return UNKNOWN;
        }
        return trimmed;
    }
}
