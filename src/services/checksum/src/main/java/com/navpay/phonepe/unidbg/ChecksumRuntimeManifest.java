package com.navpay.phonepe.unidbg;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class ChecksumRuntimeManifest {

    private static final Pattern JSON_STRING_FIELD =
            Pattern.compile("\"([^\"]+)\"\\s*:\\s*\"((?:\\\\.|[^\\\\\"])*)\"");

    private final String sourceApk;
    private final String signatureSourceApk;

    private ChecksumRuntimeManifest(String sourceApk, String signatureSourceApk) {
        this.sourceApk = sourceApk == null ? "" : sourceApk;
        this.signatureSourceApk = signatureSourceApk == null ? "" : signatureSourceApk;
    }

    static ChecksumRuntimeManifest load(Path runtimeRoot) {
        Path manifestPath = ChecksumRuntimePaths.runtimeManifest(runtimeRoot);
        if (!Files.isRegularFile(manifestPath)) {
            return new ChecksumRuntimeManifest("", "");
        }
        try {
            String json = Files.readString(manifestPath, StandardCharsets.UTF_8);
            return new ChecksumRuntimeManifest(
                    readJsonString(json, "sourceApk"),
                    readJsonString(json, "signatureSourceApk"));
        } catch (IOException e) {
            throw new IllegalStateException("failed to read runtime manifest: " + manifestPath.toAbsolutePath().normalize(), e);
        }
    }

    String sourceApk() {
        return sourceApk;
    }

    String signatureSourceApk() {
        return signatureSourceApk;
    }

    private static String readJsonString(String json, String field) {
        Matcher matcher = JSON_STRING_FIELD.matcher(json);
        while (matcher.find()) {
            if (field.equals(matcher.group(1))) {
                return matcher.group(2)
                        .replace("\\\\", "\\")
                        .replace("\\\"", "\"");
            }
        }
        return "";
    }
}
