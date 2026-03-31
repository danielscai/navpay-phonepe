package com.heartbeatbridge;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

public final class HeartbeatCommandRegistry {
    private static final Set<String> SUPPORTED_COMMANDS = Collections.unmodifiableSet(
            new LinkedHashSet<>(Arrays.asList(
                    HeartbeatProtocol.COMMAND_TYPE_PING
            ))
    );

    private HeartbeatCommandRegistry() {}

    public static Set<String> supportedCommandTypes() {
        return SUPPORTED_COMMANDS;
    }

    public static boolean isSupported(String commandType) {
        if (commandType == null) {
            return false;
        }
        return SUPPORTED_COMMANDS.contains(commandType.trim().toLowerCase(Locale.US));
    }
}
