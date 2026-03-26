package com.phonepehelper;

import android.util.Log;

final class HookLog {
    private static final String PREFIX = "[phonepehelper]";

    private HookLog() {}

    static void i(String tag, String msg) {
        Log.i(tag, PREFIX + " " + msg);
    }

    static void w(String tag, String msg) {
        Log.w(tag, PREFIX + " " + msg);
    }

    static void e(String tag, String msg, Throwable t) {
        Log.e(tag, PREFIX + " " + msg, t);
    }

    static void iKV(String tag, String key, Object value, String msg) {
        Log.i(tag, PREFIX + " " + msg + " " + key + "=" + String.valueOf(value));
    }
}
