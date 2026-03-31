package com.httpinterceptor.interceptor;

import org.junit.Test;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

public class DeviceInfoEnricherTest {

    @Test
    public void enrichesMissingDeviceFieldsWithAndroidIdOnly() {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("androidId", "existing-android-id");
        payload.put("model", "keep-me");

        DeviceSnapshot snapshot = new DeviceSnapshot(
            "snapshot-android-id",
            "Pixel 8",
            "Google",
            "Pixel 8",
            "14",
            34,
            "Asia/Shanghai",
            "zh-CN"
        );

        Map<String, Object> enriched = DeviceInfoEnricher.enrich(payload, snapshot);
        String legacyIdentityKey = "client" + "DeviceId";

        assertEquals("existing-android-id", enriched.get("androidId"));
        assertFalse(enriched.containsKey(legacyIdentityKey));
        assertEquals("Pixel 8", enriched.get("deviceName"));
        assertEquals("Google", enriched.get("brand"));
        assertEquals("keep-me", enriched.get("model"));
        assertEquals("14", enriched.get("osVersion"));
        assertEquals(34, enriched.get("sdkInt"));
        assertEquals("Asia/Shanghai", enriched.get("timezone"));
        assertEquals("zh-CN", enriched.get("locale"));
    }

    @Test
    public void androidIdCacheRetriesWhenLookupReturnsUnknown() throws Exception {
        AndroidIdCache cache = new AndroidIdCache();
        AtomicInteger calls = new AtomicInteger();

        String first = cache.get(() -> {
            calls.incrementAndGet();
            return "unknown";
        });
        String second = cache.get(() -> {
            calls.incrementAndGet();
            return "real-id";
        });

        assertEquals("unknown", first);
        assertEquals("real-id", second);
        assertEquals(2, calls.get());
    }

    @Test
    public void androidIdCacheMemoizesRealValuesOnly() throws Exception {
        AndroidIdCache cache = new AndroidIdCache();
        AtomicInteger calls = new AtomicInteger();

        String first = cache.get(() -> {
            calls.incrementAndGet();
            return "real-id";
        });
        String second = cache.get(() -> {
            calls.incrementAndGet();
            return "different-id";
        });

        assertEquals("real-id", first);
        assertEquals("real-id", second);
        assertEquals(1, calls.get());
    }
}
