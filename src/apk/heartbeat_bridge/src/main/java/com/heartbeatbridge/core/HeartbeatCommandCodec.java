package com.heartbeatbridge;

import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

public final class HeartbeatCommandCodec {
    public static final class CommandEnvelope {
        public final String commandType;
        public final String commandId;
        public final JSONObject commandPayload;
        public final String rawHeaderValue;
        public final String rawBody;

        private CommandEnvelope(String commandType, String commandId, JSONObject commandPayload, String rawHeaderValue, String rawBody) {
            this.commandType = commandType;
            this.commandId = commandId;
            this.commandPayload = commandPayload;
            this.rawHeaderValue = rawHeaderValue;
            this.rawBody = rawBody;
        }
    }

    private HeartbeatCommandCodec() {}

    public static CommandEnvelope parse(String commandHeaderValue, String responseBody) {
        CommandEnvelope fromHeader = parseHeaderValue(commandHeaderValue, responseBody);
        if (fromHeader != null) {
            return fromHeader;
        }
        return parseBody(responseBody);
    }

    public static String buildAckHeaderValue(String commandId) {
        if (commandId == null) {
            return "";
        }
        String trimmed = commandId.trim();
        return trimmed.isEmpty() ? "" : trimmed;
    }

    public static boolean isPing(CommandEnvelope command) {
        return command != null && HeartbeatProtocol.COMMAND_TYPE_PING.equals(normalize(command.commandType));
    }

    private static CommandEnvelope parseHeaderValue(String headerValue, String responseBody) {
        if (headerValue == null) {
            return null;
        }
        Map<String, String> values = parseKeyValueSegments(headerValue);
        String commandType = values.get(HeartbeatProtocol.FIELD_COMMAND_TYPE);
        String commandId = values.get(HeartbeatProtocol.FIELD_COMMAND_ID);
        if (isBlank(commandType) || isBlank(commandId)) {
            return null;
        }
        JSONObject payload = null;
        String payloadText = values.get(HeartbeatProtocol.FIELD_COMMAND_PAYLOAD);
        if (!isBlank(payloadText)) {
            payload = parsePayload(payloadText);
        }
        return new CommandEnvelope(normalize(commandType), commandId.trim(), payload, headerValue, responseBody);
    }

    private static CommandEnvelope parseBody(String responseBody) {
        if (isBlank(responseBody)) {
            return null;
        }
        JSONObject json = tryParseJson(responseBody);
        if (json == null) {
            return null;
        }
        JSONObject commandJson = json.optJSONObject(HeartbeatProtocol.FIELD_COMMAND);
        if (commandJson != null) {
            String commandType = commandJson.optString(HeartbeatProtocol.FIELD_COMMAND_TYPE, "");
            String commandId = commandJson.optString(HeartbeatProtocol.FIELD_COMMAND_ID, "");
            if (isBlank(commandType) || isBlank(commandId)) {
                return null;
            }
            return new CommandEnvelope(
                    normalize(commandType),
                    commandId.trim(),
                    commandJson.optJSONObject(HeartbeatProtocol.FIELD_COMMAND_PAYLOAD),
                    null,
                    responseBody
            );
        }

        String commandType = json.optString(HeartbeatProtocol.FIELD_COMMAND_TYPE, "");
        String commandId = json.optString(HeartbeatProtocol.FIELD_COMMAND_ID, "");
        if (isBlank(commandType) || isBlank(commandId)) {
            return null;
        }
        return new CommandEnvelope(
                normalize(commandType),
                commandId.trim(),
                json.optJSONObject(HeartbeatProtocol.FIELD_COMMAND_PAYLOAD),
                null,
                responseBody
        );
    }

    private static Map<String, String> parseKeyValueSegments(String value) {
        Map<String, String> out = new LinkedHashMap<>();
        String[] segments = value.split(";");
        for (String segment : segments) {
            String[] pair = segment.split("=", 2);
            if (pair.length != 2) {
                continue;
            }
            String key = pair[0] == null ? "" : pair[0].trim();
            String raw = pair[1] == null ? "" : pair[1].trim();
            if (key.isEmpty() || raw.isEmpty()) {
                continue;
            }
            out.put(key, raw);
        }
        return out;
    }

    private static JSONObject parsePayload(String payloadText) {
        JSONObject json = tryParseJson(payloadText);
        return json != null ? json : new JSONObject();
    }

    private static JSONObject tryParseJson(String value) {
        try {
            return new JSONObject(value);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static String normalize(String value) {
        if (value == null) {
            return "";
        }
        String trimmed = value.trim();
        if (trimmed.isEmpty()) {
            return "";
        }
        return trimmed.toLowerCase(Locale.US);
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }
}
