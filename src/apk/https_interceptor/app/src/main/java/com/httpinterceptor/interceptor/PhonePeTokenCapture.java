package com.httpinterceptor.interceptor;

import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.lang.reflect.Method;

final class PhonePeTokenCapture {

    private static final String TAG = "PhonePeTokenCapture";

    private static volatile boolean reflectionReady = false;
    private static volatile boolean reflectionInitAttempted = false;
    private static Method set1faMethod;
    private static Method setSsoMethod;
    private static Method setAuthMethod;
    private static Method setAccountsMethod;

    private PhonePeTokenCapture() {}

    static void captureFromTraffic(String url, String requestHeaders, String requestBearer, String responseBody) {
        if (url == null || url.isEmpty()) {
            return;
        }

        JSONObject root = parseJson(responseBody);
        JSONObject oneFa = null;
        JSONObject sso = null;
        JSONObject auth = null;
        JSONObject accounts = null;

        if (url.contains("/v5.0/tokens/1fa")) {
            oneFa = tokenFrom1faEndpoint(root);
        } else if (url.contains("/v5.0/token")) {
            JSONObject carrier = firstCarrier(root);
            oneFa = firstToken(carrier, "token", "oneFaToken", "oneFAToken");
            auth = firstToken(carrier, "authToken", "auth");
            sso = firstToken(carrier, "ssoToken", "sso");
            accounts = firstToken(carrier, "accountsToken", "accounts");
        }

        if (isEmpty(oneFa)) {
            JSONObject fromHeader = bearerFromHeaderValue(requestBearer);
            if (isEmpty(fromHeader)) {
                fromHeader = bearerFromHeadersText(requestHeaders);
            }
            if (!isEmpty(fromHeader)) {
                oneFa = fromHeader;
            }
        }

        if (isEmpty(oneFa) && isEmpty(sso) && isEmpty(auth) && isEmpty(accounts)) {
            return;
        }
        if (!ensureReflection()) {
            return;
        }

        invoke(set1faMethod, oneFa);
        invoke(setSsoMethod, sso);
        invoke(setAuthMethod, auth);
        invoke(setAccountsMethod, accounts);
        Log.i(TAG, "captured token bridge: oneFa=" + !isEmpty(oneFa) + ", sso=" + !isEmpty(sso)
            + ", auth=" + !isEmpty(auth) + ", accounts=" + !isEmpty(accounts));
    }

    private static JSONObject tokenFrom1faEndpoint(JSONObject root) {
        if (isEmpty(root)) {
            return new JSONObject();
        }
        if (root.has("token") || root.has("refreshToken") || root.has("expiry")) {
            return enrichObservedToken(root);
        }
        JSONObject nested = firstCarrier(root);
        if (!isEmpty(nested) && (nested.has("token") || nested.has("refreshToken") || nested.has("expiry"))) {
            return enrichObservedToken(nested);
        }
        return new JSONObject();
    }

    private static JSONObject firstCarrier(JSONObject root) {
        if (isEmpty(root)) {
            return new JSONObject();
        }
        JSONObject nested = root.optJSONObject("tokenResponse");
        if (!isEmpty(nested)) return nested;
        nested = root.optJSONObject("data");
        if (!isEmpty(nested)) return nested;
        nested = root.optJSONObject("result");
        if (!isEmpty(nested)) return nested;
        nested = root.optJSONObject("payload");
        if (!isEmpty(nested)) return nested;
        return root;
    }

    private static JSONObject firstToken(JSONObject carrier, String... keys) {
        if (isEmpty(carrier) || keys == null) {
            return new JSONObject();
        }
        for (String key : keys) {
            JSONObject obj = carrier.optJSONObject(key);
            if (!isEmpty(obj)) {
                return enrichObservedToken(obj);
            }
            String tokenValue = String.valueOf(carrier.opt(key));
            if (tokenValue != null && tokenValue.trim().length() > 12 && !"null".equalsIgnoreCase(tokenValue.trim())) {
                JSONObject wrapped = new JSONObject();
                try {
                    wrapped.put("token", tokenValue.trim());
                    wrapped.put("observedFrom", key);
                    wrapped.put("observedAtMs", System.currentTimeMillis());
                } catch (JSONException ignored) {
                    // ignore
                }
                return wrapped;
            }
        }
        return new JSONObject();
    }

    private static JSONObject bearerFromHeaderValue(String headerToken) {
        if (headerToken == null) {
            return new JSONObject();
        }
        String token = headerToken.trim();
        if (token.length() < 12) {
            return new JSONObject();
        }
        JSONObject out = new JSONObject();
        try {
            out.put("token", token);
            out.put("observedFrom", "authorization_header_direct");
            out.put("observedAtMs", System.currentTimeMillis());
        } catch (JSONException ignored) {
            // ignore
        }
        return out;
    }

    private static JSONObject bearerFromHeadersText(String headers) {
        if (headers == null || headers.isEmpty()) {
            return new JSONObject();
        }
        String token = "";
        String needle = "Authorization: Bearer ";
        int idx = headers.indexOf(needle);
        if (idx >= 0) {
            token = headers.substring(idx + needle.length()).trim();
            int lineEnd = token.indexOf('\n');
            if (lineEnd >= 0) {
                token = token.substring(0, lineEnd).trim();
            }
        }
        if (token.length() < 12) {
            return new JSONObject();
        }
        JSONObject out = new JSONObject();
        try {
            out.put("token", token);
            out.put("observedFrom", "authorization_header");
            out.put("observedAtMs", System.currentTimeMillis());
        } catch (JSONException ignored) {
            // ignore
        }
        return out;
    }

    private static JSONObject parseJson(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return new JSONObject();
        }
        try {
            return new JSONObject(raw);
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    private static JSONObject enrichObservedToken(JSONObject src) {
        if (src == null) {
            return new JSONObject();
        }
        JSONObject out = parseJson(src.toString());
        if (!out.has("observedAtMs")) {
            try {
                out.put("observedAtMs", System.currentTimeMillis());
            } catch (JSONException ignored) {
                // ignore
            }
        }
        return out;
    }

    private static boolean isEmpty(JSONObject obj) {
        return obj == null || obj.length() == 0;
    }

    private static boolean ensureReflection() {
        if (reflectionReady) {
            return true;
        }
        if (reflectionInitAttempted) {
            return false;
        }
        synchronized (PhonePeTokenCapture.class) {
            if (reflectionReady) {
                return true;
            }
            if (reflectionInitAttempted) {
                return false;
            }
            reflectionInitAttempted = true;
            try {
                Class<?> helperClass = Class.forName("com.PhonePeTweak.Def.PhonePeHelper");
                set1faMethod = helperClass.getMethod("set1faToken", JSONObject.class);
                setSsoMethod = helperClass.getMethod("saveSSOToken", JSONObject.class);
                setAuthMethod = helperClass.getMethod("saveAuthToken", JSONObject.class);
                setAccountsMethod = helperClass.getMethod("saveAccountsToken", JSONObject.class);
                reflectionReady = true;
                return true;
            } catch (Throwable t) {
                Log.w(TAG, "PhonePeHelper reflection unavailable", t);
                return false;
            }
        }
    }

    private static void invoke(Method method, JSONObject value) {
        if (method == null || isEmpty(value)) {
            return;
        }
        try {
            method.invoke(null, value);
        } catch (Throwable t) {
            Log.w(TAG, "invoke token setter failed: " + method.getName(), t);
        }
    }
}
