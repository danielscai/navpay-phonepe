package com.navpay.phonepe.unidbg;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

final class ChecksumRuntimeManifestTest {

    @Test
    void loadsVmAndSignatureSourceApkPaths() throws Exception {
        Path runtimeRoot = Files.createTempDirectory("checksum-runtime-manifest");
        Files.writeString(
                runtimeRoot.resolve("manifest.json"),
                "{\n" +
                        "  \"sourceApk\":\"/tmp/vm.apk\",\n" +
                        "  \"signatureSourceApk\":\"/tmp/original.apk\"\n" +
                        "}\n",
                StandardCharsets.UTF_8);

        ChecksumRuntimeManifest manifest = ChecksumRuntimeManifest.load(runtimeRoot);

        assertEquals("/tmp/vm.apk", manifest.sourceApk());
        assertEquals("/tmp/original.apk", manifest.signatureSourceApk());
    }
}
