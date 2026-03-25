package com.navpay.phonepe.unidbg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class ChecksumHttpServiceRealFixtureTest {

    private static final String FIXED_UUID = "8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001";

    @Test
    void realFixtureProducesStableStructure() throws Exception {
        ChecksumFixtureLoader.RealFixture fixture = ChecksumFixtureLoader.load();
        ChecksumFixtureLoader.ExpectedSnapshot expected = ChecksumFixtureLoader.loadExpected();
        Path runtimeRoot = resolveRuntimeRootForTest();
        Object service = newService(runtimeRoot);

        Method handleChecksum = ChecksumHttpService.class.getDeclaredMethod("handleChecksum", Map.class);
        handleChecksum.setAccessible(true);

        Map<String, String> request = new LinkedHashMap<>();
        request.put("path", fixture.path());
        request.put("body", fixture.body());
        request.put("uuid", FIXED_UUID);

        String response = (String) handleChecksum.invoke(service, request);
        assertNotNull(response);
        assertTrue(response.contains("\"ok\":true"));
        assertTrue(response.contains("\"structureOk\":true"));
        assertTrue(response.contains("\"checksum\":\""));

        String checksum = ChecksumFixtureLoader.extractJsonString(response, "checksum");
        int length = ChecksumFixtureLoader.extractJsonInt(response, "length");
        int decodedLength = ChecksumFixtureLoader.extractJsonInt(response, "decodedLength");
        String mode = ChecksumFixtureLoader.extractJsonString(response, "mode");
        boolean structureOk = ChecksumFixtureLoader.extractJsonBoolean(response, "structureOk");
        boolean asciiLike = ChecksumFixtureLoader.extractJsonBoolean(response, "asciiLike");
        int hyphenCount = ChecksumFixtureLoader.extractJsonInt(response, "hyphenCount");

        assertFalse(checksum.isEmpty());
        assertEquals(expected.length(), length);
        assertEquals(expected.decodedLength(), decodedLength);
        assertEquals(expected.mode(), mode);
        assertEquals(expected.structureOk(), structureOk);
        assertEquals(expected.asciiLike(), asciiLike);
        assertEquals(expected.hyphenCount(), hyphenCount);
    }

    private static Path resolveRuntimeRootForTest() throws Exception {
        try {
            Path runtimeRoot = ChecksumFixtureLoader.resolvePreparedRuntimeRoot();
            ChecksumRuntimePaths.validatePreparedRuntime(runtimeRoot);
            return runtimeRoot;
        } catch (Exception e) {
            if (ChecksumFixtureLoader.hasExplicitRuntimeOverride()) {
                throw new IllegalStateException(e.getMessage(), e);
            }
            assumeTrue(false, e.getMessage());
            throw new IllegalStateException("unreachable", e);
        }
    }

    private static Object newService(Path runtimeRoot) throws Exception {
        Constructor<ChecksumHttpService> ctor = ChecksumHttpService.class.getDeclaredConstructor(
                String.class,
                String.class,
                String.class,
                boolean.class
        );
        ctor.setAccessible(true);
        return ctor.newInstance(
                runtimeRoot.toString(),
                ChecksumRuntimePaths.runtimeLib(runtimeRoot, "libphonepe-cryptography-support-lib.so").toString(),
                "e755b7-first",
                false);
    }
}
