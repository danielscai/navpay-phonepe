package com.heartbeatbridge;

import android.content.Context;
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
        Log.i(TAG, "heartbeat scheduler started, intervalMs=" + SCHEDULE_POLICY.heartbeatIntervalMs());
        scheduleNext(appContext, SCHEDULE_POLICY.initialDelayMs());
    }

    private static void scheduleNext(Context appContext, long delayMs) {
        SCHEDULER.schedule(
                () -> {
                    long startedAtMs = System.currentTimeMillis();
                    HeartbeatSender.sendHeartbeatAsync(appContext, startedAtMs);
                    scheduleNext(appContext, SCHEDULE_POLICY.nextDelayMs(startedAtMs, System.currentTimeMillis()));
                },
                delayMs,
                TimeUnit.MILLISECONDS
        );
    }
}
