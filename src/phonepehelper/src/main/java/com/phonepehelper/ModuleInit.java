package com.phonepehelper;

import android.content.Context;

import android.util.Log;

import com.PhonePeTweak.Def.PhonePeHelper;

public final class ModuleInit {
    private static final String TAG = "PPHelper";
    private static volatile boolean initialized = false;

    private ModuleInit() {}

    public static void init(Context context) {
        if (context == null) {
            return;
        }
        if (initialized) {
            return;
        }
        initialized = true;

        Context appContext = context.getApplicationContext();
        PhonePeHelper.init(appContext);
        Log.i(TAG, "PhonePeHelper initialized (minimal)");
    }
}
