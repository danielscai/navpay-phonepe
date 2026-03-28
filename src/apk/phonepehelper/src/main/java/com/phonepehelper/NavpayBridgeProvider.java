package com.phonepehelper;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;

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
}
