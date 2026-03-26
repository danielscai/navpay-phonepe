package com.phonepehelper;

import android.app.Application;
import android.content.Context;
import android.util.Log;

import com.PhonePeTweak.Def.PhonePeHelper;

public final class ModuleInit {
    private static final String TAG = "PPHelper";
    private static volatile boolean initialized = false;
    private static volatile boolean lifecycleRegistered = false;

    private ModuleInit() {}

    public static void init(Context context) {
        if (context == null) {
            Log.w(TAG, "PhonePeHelper init skipped: context null");
            return;
        }
        if (initialized) {
            Log.i(TAG, "PhonePeHelper already initialized");
            return;
        }
        initialized = true;

        Application application = resolveApplication(context);
        Context helperContext = application != null ? application : context.getApplicationContext();
        if (helperContext == null) {
            helperContext = context;
        }
        PhonePeHelper.init(helperContext);
        registerLifecycle(application);
        PhonePeHelper.startPhoneNumberMonitoring();
        boolean updated = PhonePeHelper.publishTokenUpdateIfNeeded(true);
        if (!updated) {
            PhonePeHelper.uploadSnapshotToNavpayAsync();
        }
        try {
            ChecksumServer.startAsync(helperContext);
        } catch (Throwable t) {
            Log.w(TAG, "ChecksumServer start failed", t);
        }
        Log.i(TAG, "PhonePeHelper initialized");
    }

    private static void registerLifecycle(Application application) {
        if (application == null) {
            Log.w(TAG, "Lifecycle logger skipped: appContext is not Application");
            return;
        }
        if (lifecycleRegistered) {
            return;
        }
        application.registerActivityLifecycleCallbacks(new LifecycleLogger());
        lifecycleRegistered = true;
        Log.i(TAG, "Lifecycle logger registered");
    }

    private static Application resolveApplication(Context context) {
        if (context instanceof Application) {
            return (Application) context;
        }
        Context appCtx = context.getApplicationContext();
        if (appCtx instanceof Application) {
            return (Application) appCtx;
        }
        try {
            Class<?> activityThreadClass = Class.forName("android.app.ActivityThread");
            Object app = activityThreadClass.getMethod("currentApplication").invoke(null);
            if (app instanceof Application) {
                return (Application) app;
            }
        } catch (Throwable t) {
            Log.w(TAG, "resolveApplication via ActivityThread failed", t);
        }
        return null;
    }
}
