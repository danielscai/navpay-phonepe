package com.phonepehelper;

import android.net.Uri;

public final class NavpayBridgeContract {
    public static final String AUTHORITY = "com.phonepe.navpay.provider";
    public static final String PATH_USER_DATA = "user_data";
    public static final Uri CONTENT_URI = Uri.parse("content://" + AUTHORITY + "/" + PATH_USER_DATA);
    public static final String METHOD_CHECKSUM = "checksum";
    public static final String EXTRA_CHECKSUM_PATH = "path";
    public static final String EXTRA_CHECKSUM_BODY = "body";
    public static final String EXTRA_CHECKSUM_UUID = "uuid";
    public static final String EXTRA_CHECKSUM_OK = "ok";
    public static final String EXTRA_CHECKSUM_ERROR = "error";
    public static final String EXTRA_CHECKSUM_DATA = "data";
    public static final String EXTRA_CHECKSUM_CHECKSUM = "checksum";
    public static final String EXTRA_CHECKSUM_RESPONSE_JSON = "response_json";

    public static final String DATABASE_NAME = "navpay_bridge.db";
    public static final int DATABASE_VERSION = 1;

    public static final String TABLE_USER_DATA = "user_data";
    public static final String COLUMN_ID = "_id";
    public static final String COLUMN_PAYLOAD = "payload";
    public static final String COLUMN_VERSION = "version";
    public static final String COLUMN_UPDATED_AT = "updated_at";

    public static final long ROW_ID = 1L;
    public static final String MIME_TYPE = "vnd.android.cursor.item/vnd.com.phonepe.navpay.provider.user_data";

    private NavpayBridgeContract() {}
}
