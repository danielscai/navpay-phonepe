package com.navpay.phonepe.unidbg;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class ChecksumRuntimeConfigTest {

    @Test
    void runtimeSignatureOverridesApkLookup() throws Exception {
        Path runtimeRoot = Files.createTempDirectory("checksum-runtime");
        Files.createDirectories(runtimeRoot.resolve("lib/arm64-v8a"));
        byte[] expected = new byte[]{1, 2, 3};
        Files.write(runtimeRoot.resolve("signature.bin"), expected);
        Files.writeString(runtimeRoot.resolve("manifest.json"), "{}");
        Files.write(runtimeRoot.resolve("lib/arm64-v8a/libphonepe-cryptography-support-lib.so"), new byte[]{1});
        Files.write(runtimeRoot.resolve("lib/arm64-v8a/liba41935.so"), new byte[]{1});
        Files.write(runtimeRoot.resolve("lib/arm64-v8a/libc++_shared.so"), new byte[]{1});

        Map<String, String> report = new LinkedHashMap<>();
        byte[] actual = UnidbgChecksumProbe.resolveSignatureBytesForConfig(runtimeRoot.toString(), "/tmp/missing.apk", report);
        assertArrayEquals(expected, actual);
    }
}
