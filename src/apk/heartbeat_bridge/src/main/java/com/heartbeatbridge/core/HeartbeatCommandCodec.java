package com.heartbeatbridge;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
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
        List<CommandEnvelope> envelopes = parseAll(commandHeaderValue, responseBody);
        return envelopes.isEmpty() ? null : envelopes.get(0);
    }

    public static List<CommandEnvelope> parseAll(String commandHeaderValue, String responseBody) {
        List<CommandEnvelope> out = new ArrayList<>();
        CommandEnvelope fromHeader = parseHeaderValue(commandHeaderValue, responseBody);
        if (fromHeader != null) {
            out.add(fromHeader);
            return out;
        }
        out.addAll(parseBodyAll(responseBody));
        return out;
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

    private static List<CommandEnvelope> parseBodyAll(String responseBody) {
        List<CommandEnvelope> out = new ArrayList<>();
        if (isBlank(responseBody)) {
            return out;
        }
        JSONObject json = tryParseJson(responseBody);
        if (json == null) {
            return out;
        }
        JSONArray commands = json.optJSONArray(HeartbeatProtocol.FIELD_COMMANDS);
        if (commands != null) {
            for (int i = 0; i < commands.length(); i++) {
                JSONObject commandJson = commands.optJSONObject(i);
                CommandEnvelope parsed = parseCommandJson(commandJson, responseBody);
                if (parsed != null) {
                    out.add(parsed);
                }
            }
            if (!out.isEmpty()) {
                return out;
            }
        }
        JSONObject commandJson = json.optJSONObject(HeartbeatProtocol.FIELD_COMMAND);
        CommandEnvelope nested = parseCommandJson(commandJson, responseBody);
        if (nested != null) {
            out.add(nested);
            return out;
        }

        String commandType = json.optString(HeartbeatProtocol.FIELD_COMMAND_TYPE, "");
        String commandId = json.optString(HeartbeatProtocol.FIELD_COMMAND_ID, "");
        if (isBlank(commandType) || isBlank(commandId)) {
            return out;
        }
        out.add(new CommandEnvelope(
                normalize(commandType),
                commandId.trim(),
                json.optJSONObject(HeartbeatProtocol.FIELD_COMMAND_PAYLOAD),
                null,
                responseBody
        ));
        return out;
    }

    private static CommandEnvelope parseCommandJson(JSONObject commandJson, String responseBody) {
        if (commandJson == null) {
            return null;
        }
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
