package com.navpay.phonepe.unidbg;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Instant;

public final class ChecksumRuntimeInitializer {

    private ChecksumRuntimeInitializer() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 3 || !"init".equals(args[0])) {
            System.err.println("Usage: ChecksumRuntimeInitializer init <vm-apk-path> <runtime-dir> [signature-apk-path]");
            System.exit(2);
        }

        Path apkPath = Path.of(args[1]).toAbsolutePath().normalize();
        Path runtimeRoot = Path.of(args[2]).toAbsolutePath().normalize();
        Path signatureApkPath = args.length >= 4
                ? Path.of(args[3]).toAbsolutePath().normalize()
                : apkPath;
        byte[] signature = extractSignature(signatureApkPath);
        writeRuntimeArtifacts(
                runtimeRoot,
                apkPath,
                signatureApkPath,
                sha256(apkPath),
                signature,
                new String[]{
                        "libphonepe-cryptography-support-lib.so",
                        "liba41935.so",
                        "libc++_shared.so"
                });
    }

    static byte[] extractSignature(Path apkPath) throws Exception {
        return ApkSignatureExtractor.extractFirstCertificate(apkPath.toFile());
    }

    static String sha256(Path apkPath) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(Files.readAllBytes(apkPath));
        StringBuilder sb = new StringBuilder(hash.length * 2);
        for (byte b : hash) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    static void writeRuntimeArtifacts(Path runtimeRoot, Path apkPath, Path signatureApkPath, String apkSha256, byte[] signature,
                                      String[] libraries) throws IOException {
        Files.createDirectories(runtimeRoot);
        Files.createDirectories(runtimeRoot.resolve("lib/arm64-v8a"));
        Files.write(ChecksumRuntimePaths.runtimeSignature(runtimeRoot), signature);
        Files.writeString(ChecksumRuntimePaths.runtimeManifest(runtimeRoot),
                buildManifest(apkPath, signatureApkPath, apkSha256, signature.length, libraries),
                StandardCharsets.UTF_8);
    }

    private static String buildManifest(Path apkPath, Path signatureApkPath, String apkSha256, int signatureLength,
                                        String[] libraries) {
        StringBuilder sb = new StringBuilder();
        sb.append("{\n");
        sb.append("  \"sourceApk\":\"").append(escapeJson(apkPath.toString())).append("\",\n");
        sb.append("  \"signatureSourceApk\":\"").append(escapeJson(signatureApkPath.toString())).append("\",\n");
        sb.append("  \"apkSha256\":\"").append(escapeJson(apkSha256)).append("\",\n");
        sb.append("  \"generatedAt\":\"").append(Instant.now().toString()).append("\",\n");
        sb.append("  \"signatureLength\":").append(signatureLength).append(",\n");
        sb.append("  \"libraries\":[");
        for (int i = 0; i < libraries.length; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append("\"").append(escapeJson(libraries[i])).append("\"");
        }
        sb.append("]\n");
        sb.append("}\n");
        return sb.toString();
    }

    private static String escapeJson(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
