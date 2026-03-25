package com.navpay.phonepe.unidbg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.nio.file.Path;
import org.junit.jupiter.api.Test;

final class ChecksumRuntimeLayoutTest {

    @Test
    void runtimeLayoutDefaultsToServiceRuntimeDirectory() throws Exception {
        Path repoRoot = ChecksumFixtureLoader.findRepoRoot();
        Path runtimeRoot = ChecksumRuntimePaths.resolveRuntimeRoot(repoRoot);
        assertEquals(repoRoot.resolve("src/services/checksum/runtime"), runtimeRoot);
    }

    @Test
    void runtimeLayoutRejectsMissingManifest() {
        assertThrows(IllegalStateException.class, () ->
                ChecksumRuntimePaths.validatePreparedRuntime(Path.of("/tmp/navpay-missing-runtime")));
    }
}
