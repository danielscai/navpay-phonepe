package com.heartbeatbridge;

import android.content.Context;
import android.util.Log;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class HeartbeatScheduler {
    private static final String TAG = "HeartbeatBridge";
    private static final long HEARTBEAT_INTERVAL_MS = 30_000L;
    private static final ScheduledExecutorService SCHEDULER = Executors.newSingleThreadScheduledExecutor();
    private static final AtomicBoolean STARTED = new AtomicBoolean(false);

    private HeartbeatScheduler() {}

    public static void startIfNeeded(Context context) {
        if (context == null || !STARTED.compareAndSet(false, true)) {
            return;
        }

        final Context appContext = context.getApplicationContext() != null ? context.getApplicationContext() : context;
        Log.i(TAG, "heartbeat scheduler started, intervalMs=" + HEARTBEAT_INTERVAL_MS);
        HeartbeatSender.sendHeartbeatAsync(appContext, System.currentTimeMillis());
        SCHEDULER.scheduleAtFixedRate(
                () -> HeartbeatSender.sendHeartbeatAsync(appContext, System.currentTimeMillis()),
                HEARTBEAT_INTERVAL_MS,
                HEARTBEAT_INTERVAL_MS,
                TimeUnit.MILLISECONDS
        );
    }
}
