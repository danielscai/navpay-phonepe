package com.navpay.phonepe.unidbg;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.nio.file.Path;
import org.junit.jupiter.api.Test;

final class ChecksumPreparedRuntimeTest {

    @Test
    void preparedRuntimeCanBeResolvedForRegressionTests() throws Exception {
        Path repoRoot = ChecksumFixtureLoader.findRepoRoot();
        Path runtimeRoot = ChecksumRuntimePaths.resolveRuntimeRoot(repoRoot);
        assumeTrue(runtimeRoot.resolve("manifest.json").toFile().isFile(), "prepared runtime manifest missing");
        ChecksumRuntimePaths.validatePreparedRuntime(runtimeRoot);
        assertTrue(runtimeRoot.resolve("signature.bin").toFile().isFile());
    }
}
