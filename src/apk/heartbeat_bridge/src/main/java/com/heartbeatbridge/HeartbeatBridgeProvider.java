package com.heartbeatbridge;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;

public final class HeartbeatBridgeProvider extends ContentProvider {
    @Override
    public boolean onCreate() {
        HeartbeatScheduler.startIfNeeded(getContext());
        return true;
    }

    @Override
    public Bundle call(String method, String arg, Bundle extras) {
        String normalizedMethod = normalizeMethod(method);
        if (!isHeartbeatMethod(normalizedMethod)) {
            return super.call(method, arg, extras);
        }

        long timestamp = extractTimestamp(extras);
        Bundle result = new Bundle();
        result.putBoolean(HeartbeatBridgeContract.EXTRA_OK, true);
        result.putLong(HeartbeatBridgeContract.EXTRA_TIMESTAMP, timestamp);
        result.putString(HeartbeatBridgeContract.EXTRA_STATUS, "alive");
        result.putString(HeartbeatBridgeContract.EXTRA_APP_NAME, HeartbeatBridgeContract.APP_NAME_PHONEPE);
        HeartbeatSender.sendHeartbeatAsync(getContext(), timestamp);
        return result;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public String getType(Uri uri) {
        return "vnd.android.cursor.item/vnd.com.phonepe.navpay.heartbeat";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }

    private static boolean isHeartbeatMethod(String normalizedMethod) {
        return HeartbeatBridgeContract.METHOD_HEARTBEAT.equals(normalizedMethod)
                || normalizeMethod(HeartbeatBridgeContract.METHOD_HEARTBEAT_PROVIDER).equals(normalizedMethod)
                || normalizeMethod(HeartbeatBridgeContract.METHOD_HEARTBEAT_NAVPAY).equals(normalizedMethod);
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

    private static long extractTimestamp(Bundle extras) {
        if (extras == null) {
            return System.currentTimeMillis();
        }
        long value = extras.getLong(HeartbeatBridgeContract.EXTRA_TIMESTAMP, -1L);
        return value > 0L ? value : System.currentTimeMillis();
    }
}
