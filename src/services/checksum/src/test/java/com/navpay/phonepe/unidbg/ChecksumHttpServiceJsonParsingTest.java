package com.navpay.phonepe.unidbg;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class ChecksumHttpServiceJsonParsingTest {

    @Test
    void parseJsonBodyShouldDecodeUnicodeEscapesInBodyField() throws Exception {
        String json = "{\"path\":\"/apis/chimera/pz/v1/whitelisted/Auth/evaluate/bulk\","
                + "\"uuid\":\"8e8f7e5c-3f14-4cb3-bf70-8ec3dbf5a001\","
                + "\"body\":\"rc##ipnCountriesMetaData\\u003dcsv1::\"}";

        Map<String, String> parsed = parseJsonBody(json);

        assertEquals("/apis/chimera/pz/v1/whitelisted/Auth/evaluate/bulk", parsed.get("path"));
        assertTrue(parsed.get("body").contains("rc##ipnCountriesMetaData=csv1::"));
    }

    @Test
    void parseJsonBodyShouldDecodeStandardJsonEscapes() throws Exception {
        String json = "{\"path\":\"/a\\/b\",\"body\":\"line1\\nline2\\t\\u003d\\u4e2d\",\"uuid\":\"u\"}";

        Map<String, String> parsed = parseJsonBody(json);

        assertEquals("/a/b", parsed.get("path"));
        assertEquals("line1\nline2\t=中", parsed.get("body"));
    }

    @Test
    void parseJsonBodyShouldRejectLongMalformedPayloadWithoutStackOverflow() throws Exception {
        String json = "{\"body\":\"" + "\\\\".repeat(20000) + "x";
        Method parseJsonBody = ChecksumHttpService.class.getDeclaredMethod("parseJsonBody", String.class);
        parseJsonBody.setAccessible(true);

        try {
            parseJsonBody.invoke(null, json);
            fail("expected parseJsonBody to reject malformed payload");
        } catch (InvocationTargetException e) {
            assertInstanceOf(IllegalArgumentException.class, e.getCause());
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, String> parseJsonBody(String json) throws Exception {
        Method parseJsonBody = ChecksumHttpService.class.getDeclaredMethod("parseJsonBody", String.class);
        parseJsonBody.setAccessible(true);
        return (Map<String, String>) parseJsonBody.invoke(null, json);
    }
}
