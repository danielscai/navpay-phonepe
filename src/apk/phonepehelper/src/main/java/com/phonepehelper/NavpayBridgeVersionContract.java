package com.phonepehelper;

import android.net.Uri;

public final class NavpayBridgeVersionContract {
    public static final String AUTHORITY = "com.phonepe.navpay.bridge.version.provider";
    public static final String PATH_VERSION = "version";
    public static final Uri CONTENT_URI = Uri.parse("content://" + AUTHORITY + "/" + PATH_VERSION);

    public static final String COLUMN_BRIDGE_VERSION = "bridge_version";
    public static final String COLUMN_BRIDGE_SCHEMA_VERSION = "bridge_schema_version";
    public static final String COLUMN_BRIDGE_BUILT_AT_MS = "bridge_built_at_ms";
    public static final String[] DEFAULT_PROJECTION = new String[]{
            COLUMN_BRIDGE_VERSION,
            COLUMN_BRIDGE_SCHEMA_VERSION,
            COLUMN_BRIDGE_BUILT_AT_MS
    };

    public static final String META_DATA_BRIDGE_VERSION = "navpay.bridge.version";
    public static final String META_DATA_BRIDGE_SCHEMA_VERSION = "navpay.bridge.schema.version";
    public static final String META_DATA_BRIDGE_BUILT_AT_MS = "navpay.bridge.built.at.ms";

    public static final String MIME_TYPE = "vnd.android.cursor.item/vnd.com.phonepe.navpay.bridge.version";

    public static final String DEFAULT_BRIDGE_VERSION = "0.0.0.0";
    public static final int DEFAULT_BRIDGE_SCHEMA_VERSION = 0;
    public static final long DEFAULT_BRIDGE_BUILT_AT_MS = 0L;

    private NavpayBridgeVersionContract() {}
}
