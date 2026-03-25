package com.navpay.phonepe.unidbg;

import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

final class ChecksumStartScriptTest {

    @Test
    void startScriptFailsFastWhenPortIsAlreadyInUse() throws Exception {
        Path repoRoot = ChecksumFixtureLoader.findRepoRoot();
        try (ServerSocket socket = new ServerSocket(0)) {
            int port = socket.getLocalPort();
            ProcessBuilder builder = new ProcessBuilder(
                    "bash",
                    repoRoot.resolve("src/services/checksum/scripts/start_http_service.sh").toString());
            builder.directory(repoRoot.toFile());
            builder.redirectErrorStream(true);
            builder.environment().put("CHECKSUM_HTTP_PORT", Integer.toString(port));
            Process process = builder.start();

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (InputStream in = process.getInputStream()) {
                in.transferTo(out);
            }

            int exit = process.waitFor();
            String output = out.toString(StandardCharsets.UTF_8);
            assertNotEquals(0, exit);
            assertTrue(output.contains("port already in use"));
        }
    }
}
