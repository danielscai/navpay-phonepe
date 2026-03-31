package com.heartbeatbridge;

public final class HeartbeatProtocol {
    public static final String PROTOCOL_VERSION = "1";
    public static final String HEADER_PROTOCOL_VERSION = "x-navpay-hb-version";
    public static final String HEADER_COMMAND = "x-navpay-hb-command";
    public static final String HEADER_COMMAND_ACK = "x-navpay-hb-command-ack";

    public static final String FIELD_TIMESTAMP = "timestamp";
    public static final String FIELD_APP_NAME = "appName";
    public static final String FIELD_ANDROID_ID = "androidId";
    public static final String FIELD_COMMAND = "command";
    public static final String FIELD_COMMAND_TYPE = "commandType";
    public static final String FIELD_COMMAND_ID = "commandId";
    public static final String FIELD_COMMAND_PAYLOAD = "commandPayload";

    public static final String APP_NAME_PHONEPE = "phonepe";
    public static final String COMMAND_TYPE_PING = "ping";
    public static final String COMMAND_RESULT_PONG = "pong";

    private HeartbeatProtocol() {}
}
