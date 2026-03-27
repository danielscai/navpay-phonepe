package com.navpay.phonepe.unidbg;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class ChecksumRuntimeConfigTest {

    @Test
    void runtimeSignatureOverridesApkLookup() throws Exception {
        Path runtimeRoot = createRuntimeRoot();
        byte[] expected = new byte[]{1, 2, 3};
        Files.write(runtimeRoot.resolve("signature.bin"), expected);

        Map<String, String> report = new LinkedHashMap<>();
        byte[] actual = UnidbgChecksumProbe.resolveSignatureBytesForConfig(runtimeRoot.toString(), "/tmp/missing.apk", report);
        assertArrayEquals(expected, actual);
    }

    @Test
    void runtimeSnapshotOverridesDeviceIdAndAdjustedTime() throws Exception {
        Path runtimeRoot = createRuntimeRoot();
        Files.writeString(runtimeRoot.resolve("runtime_snapshot.json"),
                "{\n"
                        + "  \"deviceId\": \"runtime-device-id\",\n"
                        + "  \"serverTimeOffsetMs\": 321,\n"
                        + "  \"adjustedTimeMs\": 1712345678901\n"
                        + "}\n");

        ChecksumRuntimeSnapshot snapshot = ChecksumRuntimeSnapshot.load(runtimeRoot);

        assertEquals("runtime-device-id", snapshot.deviceId());
        assertEquals(Long.valueOf(321L), snapshot.serverTimeOffsetMs());
        assertEquals(Long.valueOf(1712345678901L), snapshot.adjustedTimeMs());
    }

    @Test
    void missingRuntimeSnapshotReturnsEmptyConfig() throws Exception {
        Path runtimeRoot = createRuntimeRoot();

        ChecksumRuntimeSnapshot snapshot = ChecksumRuntimeSnapshot.load(runtimeRoot);

        assertEquals("", snapshot.deviceId());
        assertEquals(null, snapshot.serverTimeOffsetMs());
        assertEquals(null, snapshot.adjustedTimeMs());
        assertFalse(snapshot.hasRuntimeValues());
    }

    @Test
    void runtimeClockUsesServerOffsetInsteadOfFreezingAdjustedSnapshotTime() throws Exception {
        long before = System.currentTimeMillis();
        long actual = UnidbgChecksumProbe.resolveConfiguredTimeMsForTest(
                ChecksumRuntimeSnapshot.of("runtime-device-id", 250L, 1712345678901L));
        long after = System.currentTimeMillis();

        assertTrue(actual >= before + 250L);
        assertTrue(actual <= after + 250L + 50L);
    }

    private static Path createRuntimeRoot() throws Exception {
        Path runtimeRoot = Files.createTempDirectory("checksum-runtime");
        Files.createDirectories(runtimeRoot.resolve("lib/arm64-v8a"));
        Files.writeString(runtimeRoot.resolve("manifest.json"), "{}");
        Files.write(runtimeRoot.resolve("signature.bin"), new byte[]{9});
        Files.write(runtimeRoot.resolve("lib/arm64-v8a/libphonepe-cryptography-support-lib.so"), new byte[]{1});
        Files.write(runtimeRoot.resolve("lib/arm64-v8a/liba41935.so"), new byte[]{1});
        Files.write(runtimeRoot.resolve("lib/arm64-v8a/libc++_shared.so"), new byte[]{1});
        return runtimeRoot;
    }
}
