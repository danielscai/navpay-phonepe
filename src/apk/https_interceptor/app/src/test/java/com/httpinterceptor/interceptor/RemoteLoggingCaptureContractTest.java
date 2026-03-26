package com.httpinterceptor.interceptor;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

import static org.junit.Assert.assertTrue;

public class RemoteLoggingCaptureContractTest {

    @Test
    public void hookUtilMustInjectNetworkInterceptor() throws Exception {
        String src = new String(
            Files.readAllBytes(Paths.get("src/main/java/com/httpinterceptor/hook/HookUtil.java")),
            StandardCharsets.UTF_8
        );
        assertTrue(src.contains("addNetworkInterceptor(new RemoteLoggingInterceptor())"));
    }

    @Test
    public void requestGzipBodyMustBeCapturedAsReplayableBase64Marker() throws Exception {
        String src = new String(
            Files.readAllBytes(Paths.get("src/main/java/com/httpinterceptor/interceptor/RemoteLoggingInterceptor.java")),
            StandardCharsets.UTF_8
        );
        assertTrue(src.contains("REQUEST_GZIP_BASE64_PREFIX"));
        assertTrue(src.contains("Base64.getEncoder().encodeToString"));
        assertTrue(src.contains("decodeBodyBytes(bytes, headers, requestBody)"));
    }

    @Test
    public void interceptorMustBridgeTrafficToPhonePeTokenCapture() throws Exception {
        String src = new String(
            Files.readAllBytes(Paths.get("src/main/java/com/httpinterceptor/interceptor/RemoteLoggingInterceptor.java")),
            StandardCharsets.UTF_8
        );
        assertTrue(src.contains("PhonePeTokenCapture.captureFromTraffic("));
    }
}
