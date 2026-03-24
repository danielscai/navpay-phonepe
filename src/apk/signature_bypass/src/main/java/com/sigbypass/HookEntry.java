package com.sigbypass;

import android.content.Context;
import android.util.Log;

import top.canyie.pine.Pine;
import top.canyie.pine.PineConfig;

/**
 * Hook 入口类
 *
 * 这是签名绕过模块的主入口点。
 * 需要在 Application.attachBaseContext() 中尽早调用 init() 方法。
 *
 * 使用方法：
 * 在 PhonePeApplication.attachBaseContext() 中添加：
 *
 *   HookEntry.init(context);
 *
 * 或者在 smali 中注入：
 *
 *   invoke-static {p0}, Lcom/sigbypass/HookEntry;->init(Landroid/content/Context;)V
 */
public class HookEntry {

    private static final String TAG = SignatureConfig.LOG_TAG;
    private static boolean initialized = false;
    private static Context appContext;

    /**
     * 初始化签名绕过模块
     *
     * @param context Application Context
     */
    public static void init(Context context) {
        if (initialized) {
            Log.d(TAG, "Already initialized, skipping");
            return;
        }

        Log.i(TAG, "Initializing signature bypass...");

        try {
            // 保存 Context
            appContext = context.getApplicationContext();
            if (appContext == null) {
                appContext = context;
            }

            // 配置 Pine
            configurePine();

            // 初始化 Pine
            Pine.ensureInitialized();
            Log.i(TAG, "Pine initialized successfully");

            // 安装签名 Hook
            String packageName = context.getPackageName();
            boolean success = SignatureHook.install(packageName);

            if (success) {
                Log.i(TAG, "Signature bypass initialized for: " + packageName);
            } else {
                Log.e(TAG, "Failed to install signature hook");
            }

            initialized = true;

        } catch (Throwable e) {
            Log.e(TAG, "Failed to initialize: " + e.getMessage(), e);
        }
    }

    /**
     * 配置 Pine Hook 框架
     */
    private static void configurePine() {
        // 关闭调试模式（生产环境）
        PineConfig.debug = false;

        // 禁用 Hidden API 策略检查
        // 这允许我们访问 Android 的内部 API
        PineConfig.disableHiddenApiPolicy = true;

        // 关闭 debuggable 标志
        PineConfig.debuggable = false;

        // 设置 Hook 模式
        // 模式 2: 使用 inline hook，兼容性更好
        Pine.setHookMode(2);

        Log.d(TAG, "Pine configured");
    }

    /**
     * 获取应用 Context
     *
     * @return Application Context
     */
    public static Context getContext() {
        return appContext;
    }

    /**
     * 检查是否已初始化
     *
     * @return true 如果已初始化
     */
    public static boolean isInitialized() {
        return initialized;
    }

    /**
     * 获取宿主应用包名
     *
     * @return 包名，如果未初始化返回 null
     */
    public static String getHostPackageName() {
        if (appContext != null) {
            return appContext.getPackageName();
        }
        return null;
    }
}
