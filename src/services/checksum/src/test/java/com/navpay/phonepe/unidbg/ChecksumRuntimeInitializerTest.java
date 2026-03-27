package com.navpay.phonepe.unidbg;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

final class ChecksumRuntimeInitializerTest {

    @Test
    void writesSignatureAndManifestIntoRuntimeDirectory() throws Exception {
        Path tempDir = Files.createTempDirectory("checksum-runtime-init");
        byte[] signature = "test-signature".getBytes(StandardCharsets.UTF_8);

        ChecksumRuntimeInitializer.writeRuntimeArtifacts(
                tempDir,
                Path.of("/tmp/example.apk"),
                Path.of("/tmp/original.apk"),
                "abc123",
                signature,
                new String[]{
                        "libphonepe-cryptography-support-lib.so",
                        "liba41935.so",
                        "libc++_shared.so"
                });

        assertArrayEquals(signature, Files.readAllBytes(tempDir.resolve("signature.bin")));
        String manifest = Files.readString(tempDir.resolve("manifest.json"));
        assertTrue(manifest.contains("\"apkSha256\":\"abc123\""));
        assertTrue(manifest.contains("\"signatureSourceApk\":\"/tmp/original.apk\""));
        assertTrue(manifest.contains("\"signatureLength\":14"));
    }
}
