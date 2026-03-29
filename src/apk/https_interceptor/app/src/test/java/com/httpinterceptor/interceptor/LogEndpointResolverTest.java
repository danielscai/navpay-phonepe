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
    public void overrideUrlWinsOverBuildTypeDefaults() {
        assertEquals(
            "https://example.com/custom",
            LogEndpointResolver.resolve(true, "https://example.com/custom")
        );
    }

    @Test
    public void resolvesDebugHeartbeatDefaultToAdminDeviceHeartbeatApi() {
        assertEquals(
            "http://10.0.2.2:3000/api/device/heartbeat",
            LogEndpointResolver.resolveHeartbeatEndpoint(true, null)
        );
    }

    @Test
    public void resolvesReleaseHeartbeatDefaultToAdminDeviceHeartbeatApi() {
        assertEquals(
            "http://10.0.2.2:3000/api/device/heartbeat",
            LogEndpointResolver.resolveHeartbeatEndpoint(false, null)
        );
    }

    @Test
    public void heartbeatOverrideUrlWinsOverBuildTypeDefaults() {
        assertEquals(
            "https://example.com/device-heartbeat",
            LogEndpointResolver.resolveHeartbeatEndpoint(true, "https://example.com/device-heartbeat")
        );
    }
}
