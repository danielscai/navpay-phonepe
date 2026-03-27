package com.navpay.phonepe.unidbg;

import java.nio.file.Files;
import java.nio.file.Path;

final class ChecksumRuntimePaths {

    private static final String RUNTIME_RELATIVE_PATH = "src/services/checksum/runtime";
    private static final String LIB_DIR_RELATIVE_PATH = "lib/arm64-v8a";
    private static final String REPO_MARKER = "package.json";

    private ChecksumRuntimePaths() {
    }

    static Path resolveRepoRoot(Path start) {
        Path current = start.toAbsolutePath().normalize();
        while (current != null) {
            if (Files.isRegularFile(current.resolve(REPO_MARKER))
                    && Files.isDirectory(current.resolve("src/services/checksum"))) {
                return current;
            }
            current = current.getParent();
        }
        throw new IllegalStateException("unable to locate repo root from " + start.toAbsolutePath().normalize());
    }

    static Path resolveRuntimeRoot(Path repoRoot) {
        return repoRoot.resolve(RUNTIME_RELATIVE_PATH).toAbsolutePath().normalize();
    }

    static Path runtimeManifest(Path runtimeRoot) {
        return runtimeRoot.resolve("manifest.json");
    }

    static Path runtimeSignature(Path runtimeRoot) {
        return runtimeRoot.resolve("signature.bin");
    }

    static Path runtimeSnapshot(Path runtimeRoot) {
        return runtimeRoot.resolve("runtime_snapshot.json");
    }

    static Path runtimeLib(Path runtimeRoot, String libName) {
        return runtimeRoot.resolve(LIB_DIR_RELATIVE_PATH).resolve(libName);
    }

    static void validatePreparedRuntime(Path runtimeRoot) {
        requireRegularFile(runtimeManifest(runtimeRoot), "missing runtime manifest");
        requireRegularFile(runtimeSignature(runtimeRoot), "missing runtime signature");
        requireRegularFile(runtimeLib(runtimeRoot, "libphonepe-cryptography-support-lib.so"), "missing runtime library");
        requireRegularFile(runtimeLib(runtimeRoot, "liba41935.so"), "missing runtime dependency library");
        requireRegularFile(runtimeLib(runtimeRoot, "libc++_shared.so"), "missing runtime libc++ library");
    }

    private static void requireRegularFile(Path path, String message) {
        if (!Files.isRegularFile(path)) {
            throw new IllegalStateException(message + ": " + path.toAbsolutePath().normalize());
        }
    }
}
