package com.phonepehelper;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.pm.ProviderInfo;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Bundle;
import android.text.TextUtils;

public final class NavpayBridgeVersionProvider extends ContentProvider {
    private static final int MATCH_VERSION = 1;
    private static final android.content.UriMatcher URI_MATCHER = new android.content.UriMatcher(android.content.UriMatcher.NO_MATCH);

    static {
        URI_MATCHER.addURI(NavpayBridgeVersionContract.AUTHORITY, NavpayBridgeVersionContract.PATH_VERSION, MATCH_VERSION);
    }

    private volatile BridgeVersionSnapshot snapshot = BridgeVersionSnapshot.defaults();

    @Override
    public boolean onCreate() {
        snapshot = loadSnapshot(getContext());
        return true;
    }

    @Override
    public MatrixCursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        ensureUri(uri);
        String[] columns = (projection == null || projection.length == 0)
                ? NavpayBridgeVersionContract.DEFAULT_PROJECTION
                : projection;
        MatrixCursor cursor = new MatrixCursor(columns, 1);
        MatrixCursor.RowBuilder row = cursor.newRow();
        BridgeVersionSnapshot current = snapshot == null ? BridgeVersionSnapshot.defaults() : snapshot;
        for (String column : columns) {
            row.add(valueForColumn(column, current));
        }
        Context context = getContext();
        if (context != null) {
            cursor.setNotificationUri(context.getContentResolver(), NavpayBridgeVersionContract.CONTENT_URI);
        }
        return cursor;
    }

    @Override
    public String getType(Uri uri) {
        ensureUri(uri);
        return NavpayBridgeVersionContract.MIME_TYPE;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        ensureUri(uri);
        return null;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        ensureUri(uri);
        return 0;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        ensureUri(uri);
        return 0;
    }

    private void ensureUri(Uri uri) {
        if (URI_MATCHER.match(uri) != MATCH_VERSION) {
            throw new IllegalArgumentException("Unsupported URI: " + uri);
        }
    }

    private static BridgeVersionSnapshot loadSnapshot(Context context) {
        if (context == null) {
            return BridgeVersionSnapshot.defaults();
        }
        try {
            PackageManager packageManager = context.getPackageManager();
            if (packageManager == null) {
                return BridgeVersionSnapshot.defaults();
            }
            ProviderInfo providerInfo = packageManager.resolveContentProvider(
                    NavpayBridgeVersionContract.AUTHORITY,
                    PackageManager.GET_META_DATA
            );
            if (providerInfo == null || providerInfo.metaData == null) {
                return BridgeVersionSnapshot.defaults();
            }
            return new BridgeVersionSnapshot(
                    readString(providerInfo.metaData, NavpayBridgeVersionContract.META_DATA_BRIDGE_VERSION, NavpayBridgeVersionContract.DEFAULT_BRIDGE_VERSION),
                    readInt(providerInfo.metaData, NavpayBridgeVersionContract.META_DATA_BRIDGE_SCHEMA_VERSION, NavpayBridgeVersionContract.DEFAULT_BRIDGE_SCHEMA_VERSION),
                    readLong(providerInfo.metaData, NavpayBridgeVersionContract.META_DATA_BRIDGE_BUILT_AT_MS, NavpayBridgeVersionContract.DEFAULT_BRIDGE_BUILT_AT_MS)
            );
        } catch (Throwable ignored) {
            return BridgeVersionSnapshot.defaults();
        }
    }

    private static Object valueForColumn(String column, BridgeVersionSnapshot snapshot) {
        if (NavpayBridgeVersionContract.COLUMN_BRIDGE_VERSION.equals(column)) {
            return snapshot.bridgeVersion;
        }
        if (NavpayBridgeVersionContract.COLUMN_BRIDGE_SCHEMA_VERSION.equals(column)) {
            return Integer.valueOf(snapshot.bridgeSchemaVersion);
        }
        if (NavpayBridgeVersionContract.COLUMN_BRIDGE_BUILT_AT_MS.equals(column)) {
            return Long.valueOf(snapshot.bridgeBuiltAtMs);
        }
        return null;
    }

    private static String readString(Bundle metaData, String key, String defaultValue) {
        Object value = metaData == null ? null : metaData.get(key);
        if (value == null) {
            return defaultValue;
        }
        String text = String.valueOf(value).trim();
        return TextUtils.isEmpty(text) ? defaultValue : text;
    }

    private static int readInt(Bundle metaData, String key, int defaultValue) {
        Object value = metaData == null ? null : metaData.get(key);
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }
        String text = value == null ? "" : String.valueOf(value).trim();
        if (TextUtils.isEmpty(text)) {
            return defaultValue;
        }
        try {
            return Integer.parseInt(text);
        } catch (Throwable ignored) {
            return defaultValue;
        }
    }

    private static long readLong(Bundle metaData, String key, long defaultValue) {
        Object value = metaData == null ? null : metaData.get(key);
        if (value instanceof Number) {
            return ((Number) value).longValue();
        }
        String text = value == null ? "" : String.valueOf(value).trim();
        if (TextUtils.isEmpty(text)) {
            return defaultValue;
        }
        try {
            return Long.parseLong(text);
        } catch (Throwable ignored) {
            return defaultValue;
        }
    }

    private static final class BridgeVersionSnapshot {
        final String bridgeVersion;
        final int bridgeSchemaVersion;
        final long bridgeBuiltAtMs;

        BridgeVersionSnapshot(String bridgeVersion, int bridgeSchemaVersion, long bridgeBuiltAtMs) {
            this.bridgeVersion = bridgeVersion;
            this.bridgeSchemaVersion = bridgeSchemaVersion;
            this.bridgeBuiltAtMs = bridgeBuiltAtMs;
        }

        static BridgeVersionSnapshot defaults() {
            return new BridgeVersionSnapshot(
                    NavpayBridgeVersionContract.DEFAULT_BRIDGE_VERSION,
                    NavpayBridgeVersionContract.DEFAULT_BRIDGE_SCHEMA_VERSION,
                    NavpayBridgeVersionContract.DEFAULT_BRIDGE_BUILT_AT_MS
            );
        }
    }
}
