package com.httpinterceptor.interceptor;

import org.junit.Test;

import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

public class LogSenderHeartbeatTest {

    @Test
    public void buildHeartbeatPayloadMapContainsOnlyExpectedFields() {
        Map<String, Object> payload = LogSender.buildHeartbeatPayloadMap("cid-123", 1700000000123L);

        assertEquals(1700000000123L, payload.get("timestamp"));
        assertEquals("phonepe", payload.get("appName"));
        assertEquals("cid-123", payload.get("clientDeviceId"));
        assertEquals(3, payload.size());
        assertFalse(payload.containsKey("sourceApp"));
        assertFalse(payload.containsKey("url"));
        assertFalse(payload.containsKey("method"));
        assertFalse(payload.containsKey("protocol"));
        assertFalse(payload.containsKey("status_code"));
    }
}
