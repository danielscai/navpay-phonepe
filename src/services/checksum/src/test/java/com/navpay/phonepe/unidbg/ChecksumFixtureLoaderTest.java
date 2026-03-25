package com.navpay.phonepe.unidbg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

final class ChecksumFixtureLoaderTest {

    @Test
    void resolvesPreparedRuntimeSystemPropertyBeforeRepoDefault() throws Exception {
        Path tempRuntime = Files.createTempDirectory("checksum-runtime");
        String previous = System.getProperty("probe.runtime.root");
        try {
            System.setProperty("probe.runtime.root", tempRuntime.toString());
            Path resolved = ChecksumFixtureLoader.resolvePreparedRuntimeRoot();
            assertEquals(tempRuntime.toAbsolutePath().normalize(), resolved);
        } finally {
            if (previous == null) {
                System.clearProperty("probe.runtime.root");
            } else {
                System.setProperty("probe.runtime.root", previous);
            }
            Files.deleteIfExists(tempRuntime);
        }
    }

    @Test
    void failsFastWhenPreparedRuntimeOverridePointsToMissingDirectory() throws Exception {
        String previous = System.getProperty("probe.runtime.root");
        try {
            System.setProperty("probe.runtime.root", "/tmp/navpay-missing-checksum-runtime");
            IOException error = assertThrows(IOException.class, ChecksumFixtureLoader::resolvePreparedRuntimeRoot);
            assertEquals("configured checksum runtime does not exist: /tmp/navpay-missing-checksum-runtime (provide -Dprobe.runtime.root=/absolute/path/to/runtime or PROBE_RUNTIME_ROOT=/absolute/path/to/runtime)", error.getMessage());
        } finally {
            if (previous == null) {
                System.clearProperty("probe.runtime.root");
            } else {
                System.setProperty("probe.runtime.root", previous);
            }
        }
    }
}
