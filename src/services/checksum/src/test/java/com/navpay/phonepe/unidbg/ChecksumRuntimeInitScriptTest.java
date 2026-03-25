package com.navpay.phonepe.unidbg;

import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

final class ChecksumRuntimeInitScriptTest {

    @Test
    void initScriptFailsFastWhenApkIsMissing() throws Exception {
        Path repoRoot = ChecksumFixtureLoader.findRepoRoot();
        Process process = new ProcessBuilder(
                "bash",
                repoRoot.resolve("src/services/checksum/scripts/init_runtime.sh").toString(),
                "/tmp/navpay-missing.apk")
                .directory(repoRoot.toFile())
                .redirectErrorStream(true)
                .start();

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (InputStream in = process.getInputStream()) {
            in.transferTo(out);
        }

        int exit = process.waitFor();
        String output = out.toString(StandardCharsets.UTF_8);
        assertNotEquals(0, exit);
        assertTrue(output.contains("missing apk"));
    }
}
