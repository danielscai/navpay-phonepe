package com.heartbeatbridge;

import org.json.JSONObject;

public final class HeartbeatPingHandler {
    public static final class PingResult {
        public final boolean handled;
        public final String commandId;
        public final String commandType;
        public final String resultCode;
        public final String resultMessage;
        public final JSONObject responsePayload;

        private PingResult(
                boolean handled,
                String commandId,
                String commandType,
                String resultCode,
                String resultMessage,
                JSONObject responsePayload
        ) {
            this.handled = handled;
            this.commandId = commandId;
            this.commandType = commandType;
            this.resultCode = resultCode;
            this.resultMessage = resultMessage;
            this.responsePayload = responsePayload;
        }
    }

    private HeartbeatPingHandler() {}

    public static PingResult handle(HeartbeatCommandCodec.CommandEnvelope command, long nowMs) {
        if (!HeartbeatCommandCodec.isPing(command)) {
            return new PingResult(false, command == null ? "" : command.commandId, command == null ? "" : command.commandType, "IGNORED", "unsupported command", null);
        }

        JSONObject payload = new JSONObject();
        try {
            payload.put(HeartbeatProtocol.FIELD_COMMAND_ID, command.commandId);
            payload.put(HeartbeatProtocol.FIELD_COMMAND_TYPE, HeartbeatProtocol.COMMAND_TYPE_PING);
            payload.put("result", HeartbeatProtocol.COMMAND_RESULT_PONG);
            payload.put("handledAtMs", nowMs);
        } catch (Throwable ignored) {
            // keep the handler non-fatal
        }

        return new PingResult(
                true,
                command.commandId,
                HeartbeatProtocol.COMMAND_TYPE_PING,
                "PONG",
                HeartbeatProtocol.COMMAND_RESULT_PONG,
                payload
        );
    }
}
