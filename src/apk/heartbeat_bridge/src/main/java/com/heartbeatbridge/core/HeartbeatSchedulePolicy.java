package com.heartbeatbridge;

import java.util.concurrent.ThreadLocalRandom;

public final class HeartbeatSchedulePolicy {
    private static final long HEARTBEAT_INTERVAL_MS = 30_000L;
    private static final long HEARTBEAT_JITTER_MS = 2_000L;

    public long initialDelayMs(String androidId, long nowMs) {
        long normalizedNowMs = Math.max(0L, nowMs);
        long phaseMs = normalizedNowMs % HEARTBEAT_INTERVAL_MS;
        long slotMs = stableOffsetMs(androidId);
        return (slotMs - phaseMs + HEARTBEAT_INTERVAL_MS) % HEARTBEAT_INTERVAL_MS;
    }

    public long heartbeatIntervalMs() {
        return HEARTBEAT_INTERVAL_MS;
    }

    public long nextHeartbeatJitterMs() {
        return ThreadLocalRandom.current().nextLong(-HEARTBEAT_JITTER_MS, HEARTBEAT_JITTER_MS + 1L);
    }

    public long nextDelayMs(long lastStartedAtMs, long nowMs) {
        if (lastStartedAtMs <= 0L) {
            return 0L;
        }
        long elapsedMs = Math.max(0L, nowMs - lastStartedAtMs);
        long remainingMs = heartbeatIntervalMs() - elapsedMs;
        return Math.max(0L, remainingMs);
    }

    private long stableOffsetMs(String androidId) {
        String normalizedAndroidId = androidId == null ? "" : androidId.trim();
        long positiveHash = normalizedAndroidId.hashCode() & 0x7fff_ffffL;
        return positiveHash % HEARTBEAT_INTERVAL_MS;
    }
}
