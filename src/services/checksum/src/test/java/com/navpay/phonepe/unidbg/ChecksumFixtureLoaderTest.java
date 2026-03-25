package com.navpay.phonepe.unidbg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

final class ChecksumFixtureLoaderTest {

    @Test
    void resolvesProbeTargetApkSystemPropertyBeforeRepoCache() throws Exception {
        Path tempApk = Files.createTempFile("checksum-probe", ".apk");
        String previous = System.getProperty("probe.target.apk");
        try {
            System.setProperty("probe.target.apk", tempApk.toString());
            Path resolved = ChecksumFixtureLoader.resolveTargetApkPath();
            assertEquals(tempApk.toAbsolutePath().normalize(), resolved);
        } finally {
            if (previous == null) {
                System.clearProperty("probe.target.apk");
            } else {
                System.setProperty("probe.target.apk", previous);
            }
            Files.deleteIfExists(tempApk);
        }
    }

    @Test
    void failsFastWhenProbeTargetApkOverridePointsToMissingFile() throws Exception {
        String previous = System.getProperty("probe.target.apk");
        try {
            System.setProperty("probe.target.apk", "/tmp/navpay-missing-checksum.apk");
            IOException error = assertThrows(IOException.class, ChecksumFixtureLoader::resolveTargetApkPath);
            assertEquals("configured checksum APK does not exist: /tmp/navpay-missing-checksum.apk (provide -Dprobe.target.apk=/absolute/path/to/patched_signed.apk or PROBE_TARGET_APK=/absolute/path/to/patched_signed.apk)", error.getMessage());
        } finally {
            if (previous == null) {
                System.clearProperty("probe.target.apk");
            } else {
                System.setProperty("probe.target.apk", previous);
            }
        }
    }
}
