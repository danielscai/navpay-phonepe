package com.navpay.phonepe.unidbg;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

final class PhonePeHelperSnapshotContractTest {

    private static final Path HELPER_SOURCE = Path.of(
            "..", "..", "apk", "phonepehelper", "src", "main", "java",
            "com", "PhonePeTweak", "Def", "PhonePeHelper.java");

    @Test
    void buildSnapshotForNavpayShouldUseSimplePayloadShapeAtSource() throws IOException {
        String src = Files.readString(HELPER_SOURCE, StandardCharsets.UTF_8);
        String body = methodBody(src, "buildSnapshotForNavpay");

        assertTrue(body.contains("snapshot.put(\"requestMeta\""), "missing requestMeta in source payload");
        assertTrue(body.contains("snapshot.put(\"upis\""), "missing upis in source payload");
        assertTrue(body.contains("snapshot.put(\"collectedAtMs\""), "missing collectedAtMs in source payload");

        assertFalse(body.contains("snapshot.put(\"summary\""), "source payload must not contain summary envelope");
        assertFalse(body.contains("snapshot.put(\"events\""), "source payload must not contain events envelope");
        assertFalse(body.contains("snapshot.put(\"latestSample\""), "source payload must not contain latestSample envelope");
        assertFalse(body.contains("snapshot.put(\"rawSamples\""), "source payload must not contain rawSamples envelope");
        assertFalse(body.contains("snapshot.put(\"keySnapshot\""), "source payload must not contain keySnapshot envelope");
        assertFalse(body.contains("snapshot.put(\"rows\""), "source payload must not contain rows envelope");
    }

    @Test
    void requestMetaShouldStillExposeTokenField() throws IOException {
        String src = Files.readString(HELPER_SOURCE, StandardCharsets.UTF_8);
        String body = methodBody(src, "getRequestMetaInfoObj");
        assertTrue(
                body.contains("obj.put(\"token\", tokens.optJSONObject(\"1fa\"))"),
                "requestMeta.token should exist and map to token snapshot");
    }

    @Test
    void refreshTokenShouldWaitForCapturedTokenUpdateBeforeForcedUpload() throws IOException {
        String src = Files.readString(HELPER_SOURCE, StandardCharsets.UTF_8);
        String body = methodBody(src, "refreshToken");
        assertTrue(
                body.contains("waitFor1faTokenUpdate("),
                "refreshToken should wait for updated token capture after trigger");
        assertTrue(
                body.contains("publishTokenUpdateIfNeeded(true)"),
                "refreshToken should still force one upload after refresh");
    }

    private static String methodBody(String source, String methodName) {
        int signature = source.indexOf(" " + methodName + "(");
        if (signature < 0) {
            throw new IllegalStateException("method not found: " + methodName);
        }
        int open = source.indexOf('{', signature);
        if (open < 0) {
            throw new IllegalStateException("method has no body: " + methodName);
        }
        int depth = 0;
        for (int i = open; i < source.length(); i++) {
            char c = source.charAt(i);
            if (c == '{') depth++;
            if (c == '}') {
                depth--;
                if (depth == 0) {
                    return source.substring(open, i + 1);
                }
            }
        }
        throw new IllegalStateException("method body not closed: " + methodName);
    }
}
