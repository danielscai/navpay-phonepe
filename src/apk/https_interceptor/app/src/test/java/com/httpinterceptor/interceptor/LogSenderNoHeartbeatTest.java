package com.httpinterceptor.interceptor;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

import static org.junit.Assert.assertFalse;

public class LogSenderNoHeartbeatTest {

    @Test
    public void logSenderShouldNotOwnHeartbeatLogic() throws Exception {
        String source = new String(
            Files.readAllBytes(Paths.get("src/main/java/com/httpinterceptor/interceptor/LogSender.java")),
            StandardCharsets.UTF_8
        );

        assertFalse(source.contains("enqueueHeartbeatLog"));
        assertFalse(source.contains("sendHeartbeat("));
        assertFalse(source.contains("HEARTBEAT_INTERVAL_MS"));
        assertFalse(source.contains("resolveHeartbeat("));
    }
}
