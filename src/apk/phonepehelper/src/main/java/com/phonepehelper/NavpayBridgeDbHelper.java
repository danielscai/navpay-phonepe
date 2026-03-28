package com.phonepehelper;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.text.TextUtils;

import org.json.JSONObject;

public final class NavpayBridgeDbHelper extends SQLiteOpenHelper {
    private static final Object LOCK = new Object();
    private static volatile NavpayBridgeDbHelper instance;

    private static final String SQL_CREATE_TABLE =
            "CREATE TABLE IF NOT EXISTS " + NavpayBridgeContract.TABLE_USER_DATA + " ("
                    + NavpayBridgeContract.COLUMN_ID + " INTEGER PRIMARY KEY NOT NULL,"
                    + NavpayBridgeContract.COLUMN_PAYLOAD + " TEXT NOT NULL,"
                    + NavpayBridgeContract.COLUMN_VERSION + " TEXT NOT NULL,"
                    + NavpayBridgeContract.COLUMN_UPDATED_AT + " INTEGER NOT NULL"
                    + ")";

    private static final String[] DEFAULT_PROJECTION = new String[] {
            NavpayBridgeContract.COLUMN_ID,
            NavpayBridgeContract.COLUMN_PAYLOAD,
            NavpayBridgeContract.COLUMN_VERSION,
            NavpayBridgeContract.COLUMN_UPDATED_AT
    };

    private final Context appContext;

    private NavpayBridgeDbHelper(Context context) {
        super(context, NavpayBridgeContract.DATABASE_NAME, null, NavpayBridgeContract.DATABASE_VERSION);
        this.appContext = context;
    }

    public static NavpayBridgeDbHelper getInstance(Context context) {
        if (context == null) {
            return null;
        }
        Context appCtx = context.getApplicationContext();
        if (appCtx == null) {
            appCtx = context;
        }
        NavpayBridgeDbHelper local = instance;
        if (local == null) {
            synchronized (LOCK) {
                local = instance;
                if (local == null) {
                    local = new NavpayBridgeDbHelper(appCtx);
                    instance = local;
                }
            }
        }
        return local;
    }

    public static boolean persistSnapshot(Context context, JSONObject snapshot) {
        if (context == null) {
            return false;
        }
        NavpayBridgeDbHelper helper = getInstance(context);
        if (helper == null) {
            return false;
        }
        long updatedAt = System.currentTimeMillis();
        String payload = snapshot == null ? "{}" : snapshot.toString();
        String version = resolveVersion(snapshot, updatedAt);
        return helper.upsertLatest(payload, version, updatedAt) >= 0;
    }

    public static Cursor querySnapshot(Context context, String[] projection) {
        NavpayBridgeDbHelper helper = getInstance(context);
        if (helper == null) {
            return buildDefaultCursor(projection);
        }
        return helper.queryLatest(projection);
    }

    public static long upsertSnapshot(Context context, String payload, String version, long updatedAt) {
        NavpayBridgeDbHelper helper = getInstance(context);
        if (helper == null) {
            return -1L;
        }
        return helper.upsertLatest(payload, version, updatedAt);
    }

    public static long upsertSnapshot(Context context, JSONObject snapshot) {
        if (context == null) {
            return -1L;
        }
        NavpayBridgeDbHelper helper = getInstance(context);
        if (helper == null) {
            return -1L;
        }
        long updatedAt = System.currentTimeMillis();
        String payload = snapshot == null ? "{}" : snapshot.toString();
        String version = resolveVersion(snapshot, updatedAt);
        return helper.upsertLatest(payload, version, updatedAt);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL(SQL_CREATE_TABLE);
        seedRow(db);
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        db.execSQL("DROP TABLE IF EXISTS " + NavpayBridgeContract.TABLE_USER_DATA);
        onCreate(db);
    }

    public synchronized Cursor queryLatest(String[] projection) {
        SQLiteDatabase db = getReadableDatabase();
        String[] actualProjection = resolveProjection(projection);
        Cursor cursor = db.query(
                NavpayBridgeContract.TABLE_USER_DATA,
                actualProjection,
                NavpayBridgeContract.COLUMN_ID + "=?",
                new String[] { String.valueOf(NavpayBridgeContract.ROW_ID) },
                null,
                null,
                null,
                "1");
        if (cursor != null && cursor.getCount() > 0) {
            return cursor;
        }
        if (cursor != null) {
            cursor.close();
        }
        seedRow(getWritableDatabase());
        Cursor retry = db.query(
                NavpayBridgeContract.TABLE_USER_DATA,
                actualProjection,
                NavpayBridgeContract.COLUMN_ID + "=?",
                new String[] { String.valueOf(NavpayBridgeContract.ROW_ID) },
                null,
                null,
                null,
                "1");
        if (retry != null && retry.getCount() > 0) {
            return retry;
        }
        if (retry != null) {
            retry.close();
        }
        return buildDefaultCursor(actualProjection);
    }

    public synchronized long upsertLatest(String payload, String version, long updatedAt) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues values = new ContentValues();
        values.put(NavpayBridgeContract.COLUMN_ID, NavpayBridgeContract.ROW_ID);
        values.put(NavpayBridgeContract.COLUMN_PAYLOAD, payload == null ? "{}" : payload);
        values.put(NavpayBridgeContract.COLUMN_VERSION, TextUtils.isEmpty(version) ? String.valueOf(updatedAt) : version);
        values.put(NavpayBridgeContract.COLUMN_UPDATED_AT, updatedAt);
        long rowId = db.insertWithOnConflict(
                NavpayBridgeContract.TABLE_USER_DATA,
                null,
                values,
                SQLiteDatabase.CONFLICT_REPLACE);
        notifySnapshotChanged();
        return rowId;
    }

    public synchronized long upsertLatest(ContentValues values) {
        if (values == null) {
            return upsertLatest("{}", String.valueOf(System.currentTimeMillis()), System.currentTimeMillis());
        }
        String payload = values.getAsString(NavpayBridgeContract.COLUMN_PAYLOAD);
        String version = values.getAsString(NavpayBridgeContract.COLUMN_VERSION);
        Long updatedAtValue = values.getAsLong(NavpayBridgeContract.COLUMN_UPDATED_AT);
        long updatedAt = updatedAtValue == null ? System.currentTimeMillis() : updatedAtValue.longValue();
        return upsertLatest(payload, version, updatedAt);
    }

    private void seedRow(SQLiteDatabase db) {
        ContentValues values = new ContentValues();
        values.put(NavpayBridgeContract.COLUMN_ID, NavpayBridgeContract.ROW_ID);
        values.put(NavpayBridgeContract.COLUMN_PAYLOAD, "{}");
        values.put(NavpayBridgeContract.COLUMN_VERSION, "0");
        values.put(NavpayBridgeContract.COLUMN_UPDATED_AT, 0L);
        db.insertWithOnConflict(
                NavpayBridgeContract.TABLE_USER_DATA,
                null,
                values,
                SQLiteDatabase.CONFLICT_IGNORE);
    }

    private void notifySnapshotChanged() {
        if (appContext == null) {
            return;
        }
        appContext.getContentResolver().notifyChange(NavpayBridgeContract.CONTENT_URI, null);
    }

    private static Cursor buildDefaultCursor(String[] projection) {
        String[] actualProjection = resolveProjection(projection);
        MatrixCursor cursor = new MatrixCursor(actualProjection, 1);
        Object[] row = new Object[actualProjection.length];
        for (int i = 0; i < actualProjection.length; i++) {
            row[i] = defaultValueForColumn(actualProjection[i]);
        }
        cursor.addRow(row);
        return cursor;
    }

    private static String[] resolveProjection(String[] projection) {
        if (projection == null || projection.length == 0) {
            return DEFAULT_PROJECTION;
        }
        return projection;
    }

    private static Object defaultValueForColumn(String column) {
        if (NavpayBridgeContract.COLUMN_ID.equals(column)) {
            return NavpayBridgeContract.ROW_ID;
        }
        if (NavpayBridgeContract.COLUMN_PAYLOAD.equals(column)) {
            return "{}";
        }
        if (NavpayBridgeContract.COLUMN_VERSION.equals(column)) {
            return "0";
        }
        if (NavpayBridgeContract.COLUMN_UPDATED_AT.equals(column)) {
            return 0L;
        }
        return null;
    }

    private static String resolveVersion(JSONObject snapshot, long updatedAt) {
        if (snapshot != null) {
            long lastCollectedAtMs = snapshot.optLong("lastCollectedAtMs", -1L);
            if (lastCollectedAtMs > 0L) {
                return String.valueOf(lastCollectedAtMs);
            }
            JSONObject summary = snapshot.optJSONObject("summary");
            if (summary != null) {
                long summaryLastCollectedAtMs = summary.optLong("lastCollectedAtMs", -1L);
                if (summaryLastCollectedAtMs > 0L) {
                    return String.valueOf(summaryLastCollectedAtMs);
                }
            }
            JSONObject latestSample = snapshot.optJSONObject("latestSample");
            if (latestSample != null) {
                long collectedAtMs = latestSample.optLong("collectedAtMs", -1L);
                if (collectedAtMs > 0L) {
                    return String.valueOf(collectedAtMs);
                }
            }
            long collectedAtMs = snapshot.optLong("collectedAtMs", -1L);
            if (collectedAtMs > 0L) {
                return String.valueOf(collectedAtMs);
            }
        }
        return String.valueOf(updatedAt);
    }
}
