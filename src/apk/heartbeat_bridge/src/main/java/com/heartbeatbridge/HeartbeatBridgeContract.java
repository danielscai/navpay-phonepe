package com.heartbeatbridge;

import android.net.Uri;

public final class HeartbeatBridgeContract {
    public static final String AUTHORITY = "com.phonepe.navpay.heartbeat.provider";
    public static final String PATH_HEARTBEAT = "heartbeat";
    public static final Uri CONTENT_URI = Uri.parse("content://" + AUTHORITY + "/" + PATH_HEARTBEAT);

    public static final String METHOD_HEARTBEAT = "heartbeat";
    public static final String METHOD_HEARTBEAT_PROVIDER = "providerHeartbeat";
    public static final String METHOD_HEARTBEAT_NAVPAY = "navpayHeartbeat";

    public static final String EXTRA_OK = "ok";
    public static final String EXTRA_STATUS = "status";
    public static final String EXTRA_TIMESTAMP = "timestamp";
    public static final String EXTRA_APP_NAME = "appName";
    public static final String EXTRA_CLIENT_DEVICE_ID = "clientDeviceId";

    public static final String APP_NAME_PHONEPE = "phonepe";

    private HeartbeatBridgeContract() {}
}
