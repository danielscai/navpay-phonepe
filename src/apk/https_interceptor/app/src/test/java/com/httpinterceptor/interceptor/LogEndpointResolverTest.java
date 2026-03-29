package com.httpinterceptor.interceptor;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class LogEndpointResolverTest {

    @Test
    public void resolvesDebugDefaultToAdminInterceptLogsApi() {
        assertEquals(
            "http://10.0.2.2:3000/api/admin/intercept/logs",
            LogEndpointResolver.resolve(true, null)
        );
    }

    @Test
    public void resolvesReleaseDefaultToAdminInterceptLogsApi() {
        assertEquals(
            "http://10.0.2.2:3000/api/admin/intercept/logs",
            LogEndpointResolver.resolve(false, null)
        );
    }

    @Test
    public void resolvesHeartbeatDefaultToDeviceHeartbeatApi() {
        assertEquals(
            "http://10.0.2.2:3000/api/device/heartbeat",
            LogEndpointResolver.resolveHeartbeat(null)
        );
    }

    @Test
    public void heartbeatOverrideWinsOverDefault() {
        assertEquals(
            "https://example.com/custom-heartbeat",
            LogEndpointResolver.resolveHeartbeat("https://example.com/custom-heartbeat")
        );
    }

    @Test
    public void overrideUrlWinsOverBuildTypeDefaults() {
        assertEquals(
            "https://example.com/custom",
            LogEndpointResolver.resolve(true, "https://example.com/custom")
        );
    }
}
