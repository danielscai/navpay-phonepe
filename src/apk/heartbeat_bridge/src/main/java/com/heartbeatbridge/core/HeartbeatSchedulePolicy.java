package com.heartbeatbridge;

public final class HeartbeatSchedulePolicy {
    private static final long HEARTBEAT_INTERVAL_MS = 30_000L;

    public long initialDelayMs() {
        return 0L;
    }

    public long heartbeatIntervalMs() {
        return HEARTBEAT_INTERVAL_MS;
    }

    public long nextDelayMs(long lastStartedAtMs, long nowMs) {
        if (lastStartedAtMs <= 0L) {
            return initialDelayMs();
        }
        long elapsedMs = Math.max(0L, nowMs - lastStartedAtMs);
        long remainingMs = heartbeatIntervalMs() - elapsedMs;
        return Math.max(0L, remainingMs);
    }
}
