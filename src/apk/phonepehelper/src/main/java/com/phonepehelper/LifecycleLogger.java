package com.phonepehelper;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;

import com.PhonePeTweak.Def.PhonePeHelper;

final class LifecycleLogger implements Application.ActivityLifecycleCallbacks {
    private static final String TAG = "PPHelper";

    @Override
    public void onActivityCreated(Activity activity, Bundle savedInstanceState) {
        HookLog.i(TAG, "Activity created: " + activity.getClass().getName());
    }

    @Override
    public void onActivityStarted(Activity activity) {
        HookLog.i(TAG, "Activity started: " + activity.getClass().getName());
    }

    @Override
    public void onActivityResumed(Activity activity) {
        HookLog.i(TAG, "Activity resumed: " + activity.getClass().getName());
        HookLog.iKV(TAG, "syncResult", PhonePeHelper.performTokenSync(), "token sync on resume");
    }

    @Override
    public void onActivityPaused(Activity activity) {
        HookLog.i(TAG, "Activity paused: " + activity.getClass().getName());
    }

    @Override
    public void onActivityStopped(Activity activity) {
        HookLog.i(TAG, "Activity stopped: " + activity.getClass().getName());
    }

    @Override
    public void onActivitySaveInstanceState(Activity activity, Bundle outState) {
        HookLog.i(TAG, "Activity save state: " + activity.getClass().getName());
    }

    @Override
    public void onActivityDestroyed(Activity activity) {
        HookLog.i(TAG, "Activity destroyed: " + activity.getClass().getName());
    }
}
