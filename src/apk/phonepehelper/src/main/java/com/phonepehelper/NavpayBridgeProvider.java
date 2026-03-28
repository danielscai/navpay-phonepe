package com.phonepehelper;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;

import org.json.JSONObject;

public final class NavpayBridgeProvider extends ContentProvider {
    private static final int MATCH_USER_DATA = 1;
    private static final android.content.UriMatcher URI_MATCHER = new android.content.UriMatcher(android.content.UriMatcher.NO_MATCH);

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
        if (!NavpayBridgeContract.METHOD_CHECKSUM.equals(method)) {
            return super.call(method, arg, extras);
        }

        String path = readString(extras, NavpayBridgeContract.EXTRA_CHECKSUM_PATH);
        if (path.isEmpty() && arg != null) {
            path = arg.trim();
        }
        String body = readString(extras, NavpayBridgeContract.EXTRA_CHECKSUM_BODY);
        String uuid = readString(extras, NavpayBridgeContract.EXTRA_CHECKSUM_UUID);

        try {
            JSONObject response = ChecksumServer.buildChecksumResponse(getContext(), path, body, uuid);
            return toChecksumBundle(response);
        } catch (Throwable t) {
            Bundle failure = new Bundle();
            failure.putBoolean(NavpayBridgeContract.EXTRA_CHECKSUM_OK, false);
            failure.putString(NavpayBridgeContract.EXTRA_CHECKSUM_ERROR, "internal_error");
            failure.putString(NavpayBridgeContract.EXTRA_CHECKSUM_RESPONSE_JSON,
                    "{\"ok\":false,\"error\":\"internal_error\"}");
            return failure;
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

    private static String readString(Bundle extras, String key) {
        if (extras == null || key == null) {
            return "";
        }
        String value = extras.getString(key);
        return value == null ? "" : value.trim();
    }

    private static Bundle toChecksumBundle(JSONObject response) {
        Bundle result = new Bundle();
        if (response == null) {
            result.putBoolean(NavpayBridgeContract.EXTRA_CHECKSUM_OK, false);
            result.putString(NavpayBridgeContract.EXTRA_CHECKSUM_ERROR, "checksum_failed");
            result.putString(NavpayBridgeContract.EXTRA_CHECKSUM_RESPONSE_JSON,
                    "{\"ok\":false,\"error\":\"checksum_failed\"}");
            return result;
        }

        boolean ok = response.optBoolean(NavpayBridgeContract.EXTRA_CHECKSUM_OK, false);
        result.putBoolean(NavpayBridgeContract.EXTRA_CHECKSUM_OK, ok);
        if (ok) {
            String uuid = response.optString(NavpayBridgeContract.EXTRA_CHECKSUM_UUID, "");
            if (!uuid.isEmpty()) {
                result.putString(NavpayBridgeContract.EXTRA_CHECKSUM_UUID, uuid);
            }
            JSONObject data = response.optJSONObject(NavpayBridgeContract.EXTRA_CHECKSUM_DATA);
            String checksum = data == null ? "" : data.optString(NavpayBridgeContract.EXTRA_CHECKSUM_CHECKSUM, "");
            if (!checksum.isEmpty()) {
                result.putString(NavpayBridgeContract.EXTRA_CHECKSUM_CHECKSUM, checksum);
            }
            Bundle dataBundle = new Bundle();
            if (!checksum.isEmpty()) {
                dataBundle.putString(NavpayBridgeContract.EXTRA_CHECKSUM_CHECKSUM, checksum);
            }
            result.putBundle(NavpayBridgeContract.EXTRA_CHECKSUM_DATA, dataBundle);
        } else {
            result.putString(NavpayBridgeContract.EXTRA_CHECKSUM_ERROR,
                    response.optString(NavpayBridgeContract.EXTRA_CHECKSUM_ERROR, "checksum_failed"));
        }
        result.putString(NavpayBridgeContract.EXTRA_CHECKSUM_RESPONSE_JSON, response.toString());
        return result;
    }
}
