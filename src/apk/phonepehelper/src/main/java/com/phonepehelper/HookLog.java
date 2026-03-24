package com.phonepehelper;

import android.util.Log;

final class HookLog {
    private HookLog() {}

    static void i(String tag, String msg) {
        Log.i(tag, msg);
    }

    static void w(String tag, String msg) {
        Log.w(tag, msg);
    }

    static void e(String tag, String msg, Throwable t) {
        Log.e(tag, msg, t);
    }
}
