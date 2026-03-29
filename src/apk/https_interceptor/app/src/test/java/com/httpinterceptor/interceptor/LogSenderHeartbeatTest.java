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
        assertEquals("phonepe", payload.get("sourceApp"));
        assertEquals("app://phonepe/heartbeat", payload.get("url"));
        assertEquals("HEARTBEAT", payload.get("method"));
        assertEquals("cid-123", payload.get("clientDeviceId"));
        assertFalse(payload.containsKey("protocol"));
        assertFalse(payload.containsKey("status_code"));
    }
}
