package com.heartbeatbridge;

import android.content.Context;
import android.provider.Settings;
import android.util.Log;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class HeartbeatScheduler {
    private static final String TAG = "HeartbeatBridge";
    private static final HeartbeatSchedulePolicy SCHEDULE_POLICY = new HeartbeatSchedulePolicy();
    private static final ScheduledExecutorService SCHEDULER = Executors.newSingleThreadScheduledExecutor();
    private static final AtomicBoolean STARTED = new AtomicBoolean(false);

    private HeartbeatScheduler() {}

    public static void startIfNeeded(Context context) {
        if (context == null || !STARTED.compareAndSet(false, true)) {
            return;
        }

        final Context appContext = context.getApplicationContext() != null ? context.getApplicationContext() : context;
        long nowMs = System.currentTimeMillis();
        long initialDelayMs = SCHEDULE_POLICY.initialDelayMs(resolveAndroidId(appContext), nowMs);
        Log.i(TAG, "heartbeat scheduler started, intervalMs=" + SCHEDULE_POLICY.heartbeatIntervalMs() + ", initialDelayMs=" + initialDelayMs);
        scheduleNext(appContext, initialDelayMs);
    }

    private static void scheduleNext(Context appContext, long delayMs) {
        SCHEDULER.schedule(
                () -> {
                    long startedAtMs = System.currentTimeMillis();
                    HeartbeatSender.sendHeartbeatAsync(appContext, startedAtMs);
                    long jitterMs = SCHEDULE_POLICY.nextHeartbeatJitterMs();
                    long waitMs = Math.max(0L, SCHEDULE_POLICY.nextDelayMs(startedAtMs, System.currentTimeMillis()) + jitterMs);
                    scheduleNext(appContext, waitMs);
                },
                delayMs,
                TimeUnit.MILLISECONDS
        );
    }

    private static String resolveAndroidId(Context context) {
        try {
            String value = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
            if (value != null) {
                String trimmed = value.trim();
                if (!trimmed.isEmpty()) {
                    return trimmed;
                }
            }
        } catch (Throwable ignored) {
            // no-op
        }
        return "unknown";
    }
}
