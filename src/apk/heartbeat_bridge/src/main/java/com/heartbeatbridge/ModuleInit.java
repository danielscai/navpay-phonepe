package com.heartbeatbridge;

import android.content.Context;
import android.util.Log;

public final class ModuleInit {
    private static final String TAG = "HeartbeatBridge";

    private ModuleInit() {}

    public static void init(Context context) {
        if (context == null) {
            Log.w(TAG, "heartbeat bridge init skipped: context null");
            return;
        }
        HeartbeatScheduler.startIfNeeded(context);
        Log.i(TAG, "heartbeat bridge initialized");
    }
}
