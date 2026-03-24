package com.sigbypass;

import java.lang.reflect.Method;

/**
 * 简化的反射工具类
 *
 * 提供便捷的反射方法查找功能
 */
public class ReflectUtils {

    /**
     * 获取指定类的方法
     *
     * @param className 类的完整名称
     * @param methodName 方法名
     * @param paramTypes 参数类型数组
     * @return 找到的方法，如果未找到返回 null
     */
    public static Method findMethod(String className, String methodName, Class<?>... paramTypes) {
        try {
            Class<?> clazz = Class.forName(className);
            return findMethod(clazz, methodName, paramTypes);
        } catch (ClassNotFoundException e) {
            logError("Class not found: " + className, e);
            return null;
        }
    }

    /**
     * 获取指定类的方法
     *
     * @param clazz 类
     * @param methodName 方法名
     * @param paramTypes 参数类型数组
     * @return 找到的方法，如果未找到返回 null
     */
    public static Method findMethod(Class<?> clazz, String methodName, Class<?>... paramTypes) {
        try {
            // 先尝试公共方法
            return clazz.getMethod(methodName, paramTypes);
        } catch (NoSuchMethodException e) {
            // 再尝试声明的方法（包括私有）
            try {
                Method method = clazz.getDeclaredMethod(methodName, paramTypes);
                method.setAccessible(true);
                return method;
            } catch (NoSuchMethodException e2) {
                // 尝试父类
                Class<?> superClass = clazz.getSuperclass();
                if (superClass != null) {
                    return findMethod(superClass, methodName, paramTypes);
                }
                logError("Method not found: " + methodName, e2);
                return null;
            }
        }
    }

    /**
     * 记录错误日志
     */
    private static void logError(String message, Throwable e) {
        if (SignatureConfig.DEBUG) {
            android.util.Log.e(SignatureConfig.LOG_TAG, message, e);
        }
    }

    /**
     * 记录调试日志
     */
    public static void logDebug(String message) {
        if (SignatureConfig.DEBUG) {
            android.util.Log.d(SignatureConfig.LOG_TAG, message);
        }
    }

    /**
     * 记录信息日志
     */
    public static void logInfo(String message) {
        android.util.Log.i(SignatureConfig.LOG_TAG, message);
    }
}
