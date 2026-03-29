package com.phonepehelper;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;

import org.json.JSONObject;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

public final class NavpayBridgeProvider extends ContentProvider {
    private static final int MATCH_USER_DATA = 1;
    private static final android.content.UriMatcher URI_MATCHER = new android.content.UriMatcher(android.content.UriMatcher.NO_MATCH);

    private static final Set<String> CHECKSUM_METHODS = new HashSet<>(Arrays.asList(
            "checksum",
            "computechecksum",
            "providerchecksum",
            "navpaychecksum"
    ));
    private static final Set<String> HEARTBEAT_METHODS = new HashSet<>(Arrays.asList(
            "heartbeat",
            "providerheartbeat",
            "navpayheartbeat"
    ));

    private static final String[] PATH_KEYS = new String[]{
            NavpayBridgeContract.EXTRA_CHECKSUM_PATH,
            "encodedPath", "encoded_path",
            "requestPath", "request_path",
            "uriPath", "uri_path",
            "urlPath", "url_path",
            "url", "requestUrl", "request_url"
    };

    private static final String[] BODY_KEYS = new String[]{
            NavpayBridgeContract.EXTRA_CHECKSUM_BODY,
            "requestBody", "request_body",
            "rawBody", "raw_body",
            "payload", "payloadJson", "json",
            "bodyString", "body_string"
    };

    private static final String[] UUID_KEYS = new String[]{
            NavpayBridgeContract.EXTRA_CHECKSUM_UUID,
            "requestId", "request_id",
            "traceId", "trace_id",
            "nonce", "requestNonce", "request_nonce",
            "correlationId", "correlation_id"
    };
    private static final String[] HEARTBEAT_TIMESTAMP_KEYS = new String[]{
            NavpayBridgeContract.EXTRA_HEARTBEAT_TIMESTAMP,
            "ts", "time"
    };

    static {
        URI_MATCHER.addURI(NavpayBridgeContract.AUTHORITY, NavpayBridgeContract.PATH_USER_DATA, MATCH_USER_DATA);
    }

    private NavpayBridgeDbHelper helper;

    @Override
    public boolean onCreate() {
        helper = NavpayBridgeDbHelper.getInstance(getContext());
        return helper != null;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        ensureUri(uri);
        Cursor cursor = helper == null ? NavpayBridgeDbHelper.querySnapshot(getContext(), projection) : helper.queryLatest(projection);
        if (cursor != null && getContext() != null) {
            cursor.setNotificationUri(getContext().getContentResolver(), NavpayBridgeContract.CONTENT_URI);
        }
        return cursor;
    }

    @Override
    public String getType(Uri uri) {
        ensureUri(uri);
        return NavpayBridgeContract.MIME_TYPE;
    }

    @Override
    public Bundle call(String method, String arg, Bundle extras) {
        String normalizedMethod = normalizeMethod(method);
        if (isHeartbeatMethod(normalizedMethod)) {
            Bundle result = buildHeartbeatBundle(extras);
            long timestamp = result.getLong("timestamp", System.currentTimeMillis());
            NavpayHeartbeatSender.sendHeartbeatAsync(getContext(), timestamp);
            return result;
        }
        if (!isChecksumMethod(normalizedMethod)) {
            return super.call(method, arg, extras);
        }

        String path = resolvePath(arg, extras);
        String body = resolveValue(extras, BODY_KEYS);
        String uuid = resolveValue(extras, UUID_KEYS);

        if (path.isEmpty()) {
            JSONObject error = new JSONObject();
            try {
                error.put("ok", false);
                error.put("error", "missing path");
            } catch (Throwable ignored) {
                // no-op
            }
            return toHttpLikeBundle(error);
        }

        try {
            JSONObject response = ChecksumServer.buildChecksumResponse(getContext(), path, body, uuid);
            return toHttpLikeBundle(response);
        } catch (Throwable t) {
            JSONObject error = new JSONObject();
            try {
                error.put("ok", false);
                error.put("error", "internal_error: " + t.getClass().getSimpleName());
            } catch (Throwable ignored) {
                // no-op
            }
            return toHttpLikeBundle(error);
        }
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        ensureUri(uri);
        long rowId = upsert(values);
        if (rowId < 0L) {
            return null;
        }
        return Uri.withAppendedPath(NavpayBridgeContract.CONTENT_URI, String.valueOf(NavpayBridgeContract.ROW_ID));
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        ensureUri(uri);
        long rowId = upsert(values);
        return rowId < 0L ? 0 : 1;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        ensureUri(uri);
        return 0;
    }

    private void ensureUri(Uri uri) {
        if (URI_MATCHER.match(uri) != MATCH_USER_DATA) {
            throw new IllegalArgumentException("Unsupported URI: " + uri);
        }
    }

    private long upsert(ContentValues values) {
        if (helper != null) {
            return helper.upsertLatest(values);
        }
        if (getContext() == null) {
            return -1L;
        }
        String payload = values == null ? "{}" : values.getAsString(NavpayBridgeContract.COLUMN_PAYLOAD);
        String version = values == null ? null : values.getAsString(NavpayBridgeContract.COLUMN_VERSION);
        Long updatedAtValue = values == null ? null : values.getAsLong(NavpayBridgeContract.COLUMN_UPDATED_AT);
        long updatedAt = updatedAtValue == null ? System.currentTimeMillis() : updatedAtValue.longValue();
        return NavpayBridgeDbHelper.upsertSnapshot(getContext(), payload, version, updatedAt);
    }

    private static boolean isChecksumMethod(String normalizedMethod) {
        return CHECKSUM_METHODS.contains(normalizedMethod);
    }

    private static boolean isHeartbeatMethod(String normalizedMethod) {
        return HEARTBEAT_METHODS.contains(normalizedMethod);
    }

    private static String normalizeMethod(String method) {
        if (method == null) {
            return "";
        }
        StringBuilder normalized = new StringBuilder(method.length());
        for (int i = 0; i < method.length(); i++) {
            char c = method.charAt(i);
            if (Character.isLetterOrDigit(c)) {
                normalized.append(Character.toLowerCase(c));
            }
        }
        return normalized.toString();
    }

    private static Bundle buildHeartbeatBundle(Bundle extras) {
        long timestamp = resolveLong(extras, HEARTBEAT_TIMESTAMP_KEYS, System.currentTimeMillis());
        Bundle result = new Bundle();
        result.putBoolean("ok", true);
        result.putLong("timestamp", timestamp);
        result.putString("status", "alive");
        return result;
    }

    private static String resolvePath(String arg, Bundle extras) {
        String path = resolveValue(extras, PATH_KEYS);
        if (path.isEmpty() && looksLikePath(arg)) {
            path = arg.trim();
        }
        if (path.isEmpty()) {
            return "";
        }
        int q = path.indexOf('?');
        if (q >= 0) {
            path = path.substring(0, q);
        }
        int h = path.indexOf('#');
        if (h >= 0) {
            path = path.substring(0, h);
        }
        return path.trim();
    }

    private static String resolveValue(Bundle extras, String[] keys) {
        if (extras == null) {
            return "";
        }
        for (String key : keys) {
            if (!extras.containsKey(key)) {
                continue;
            }
            Object value = extras.get(key);
            if (value == null) {
                continue;
            }
            String text = String.valueOf(value).trim();
            if (!text.isEmpty()) {
                return text;
            }
        }
        return "";
    }

    private static boolean looksLikePath(String value) {
        if (value == null) {
            return false;
        }
        String trimmed = value.trim();
        if (trimmed.isEmpty()) {
            return false;
        }
        return trimmed.startsWith("/") || trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.contains("/");
    }

    private static long resolveLong(Bundle extras, String[] keys, long defaultValue) {
        if (extras == null) {
            return defaultValue;
        }
        for (String key : keys) {
            if (!extras.containsKey(key)) {
                continue;
            }
            Object value = extras.get(key);
            if (value == null) {
                continue;
            }
            if (value instanceof Number) {
                return ((Number) value).longValue();
            }
            String text = String.valueOf(value).trim();
            if (text.isEmpty()) {
                continue;
            }
            try {
                return Long.parseLong(text);
            } catch (NumberFormatException ignored) {
                // continue to next key
            }
        }
        return defaultValue;
    }

    private static Bundle toHttpLikeBundle(JSONObject response) {
        Bundle result = new Bundle();
        if (response == null) {
            result.putBoolean("ok", false);
            result.putString("error", "checksum_failed");
            return result;
        }

        boolean ok = response.optBoolean("ok", false);
        result.putBoolean("ok", ok);
        if (ok) {
            String uuid = response.optString("uuid", "");
            JSONObject data = response.optJSONObject("data");
            String checksum = data == null ? "" : data.optString("checksum", "");

            Bundle dataBundle = new Bundle();
            if (!checksum.isEmpty()) {
                dataBundle.putString("checksum", checksum);
                // Keep http-like nested shape while mirroring checksum on top-level
                // so adb content call can display it directly.
                result.putString("checksum", checksum);
            }
            result.putBundle("data", dataBundle);
            if (!uuid.isEmpty()) {
                result.putString("uuid", uuid);
            }
        } else {
            result.putString("error", response.optString("error", "checksum_failed"));
        }

        return result;
    }
}
