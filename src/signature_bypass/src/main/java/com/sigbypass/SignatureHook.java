package com.sigbypass;

import android.content.pm.PackageInfo;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;

import java.lang.reflect.Method;

import top.canyie.pine.Pine;
import top.canyie.pine.callback.MethodHook;

/**
 * 签名 Hook 核心类
 *
 * 通过 Hook PackageManager.getPackageInfo() 方法，
 * 在应用查询自身签名时返回原始签名，从而绕过签名校验。
 *
 * Hook 原理：
 * 1. 应用调用 getPackageInfo(packageName, flags) 获取包信息
 * 2. 当 flags 包含 GET_SIGNATURES (64) 或 GET_SIGNING_CERTIFICATES (0x8000000) 时
 * 3. 系统会在返回的 PackageInfo 中填充签名信息
 * 4. 我们在方法返回后（afterCall）将签名替换为原始签名
 */
public class SignatureHook {

    /**
     * GET_SIGNATURES flag 值
     * 用于获取 PackageInfo.signatures
     */
    private static final int GET_SIGNATURES = 64;

    /**
     * GET_SIGNING_CERTIFICATES flag 值
     * 用于获取 PackageInfo.signingInfo (Android P+)
     */
    private static final int GET_SIGNING_CERTIFICATES = 0x08000000;

    /**
     * 宿主应用包名（运行时获取）
     */
    private static String hostPackageName;

    /**
     * 安装签名 Hook
     *
     * @param packageName 宿主应用包名
     * @return true 如果 Hook 成功
     */
    public static boolean install(String packageName) {
        hostPackageName = packageName;

        // 查找 getPackageInfo 方法
        Method getPackageInfoMethod = ReflectUtils.findMethod(
            "android.app.ApplicationPackageManager",
            "getPackageInfo",
            String.class,
            int.class
        );

        if (getPackageInfoMethod == null) {
            ReflectUtils.logInfo("ERROR: getPackageInfo method not found");
            return false;
        }

        try {
            // 安装 Hook
            Pine.hook(getPackageInfoMethod, new SignatureMethodHook());
            ReflectUtils.logInfo("Signature hook installed successfully");
            return true;
        } catch (Throwable e) {
            ReflectUtils.logInfo("ERROR: Failed to install hook: " + e.getMessage());
            return false;
        }
    }

    /**
     * getPackageInfo 方法的 Hook 回调
     */
    private static class SignatureMethodHook extends MethodHook {

        @Override
        public void beforeCall(Pine.CallFrame callFrame) {
            // 不需要在调用前做任何事
        }

        @Override
        public void afterCall(Pine.CallFrame callFrame) {
            try {
                // 获取方法参数
                String packageName = (String) callFrame.args[0];
                int flags = (Integer) callFrame.args[1];

                // 只处理目标包名
                if (!isTargetPackage(packageName)) {
                    return;
                }

                // 获取返回的 PackageInfo
                PackageInfo packageInfo = (PackageInfo) callFrame.getResult();
                if (packageInfo == null) {
                    return;
                }

                // 根据 flags 处理不同的签名请求
                if (flags == GET_SIGNATURES) {
                    handleGetSignatures(callFrame, packageInfo, packageName);
                } else if (flags == GET_SIGNING_CERTIFICATES) {
                    handleGetSigningCertificates(callFrame, packageInfo, packageName);
                }

            } catch (Throwable e) {
                ReflectUtils.logInfo("ERROR in afterCall: " + e.getMessage());
            }
        }

        /**
         * 检查是否是目标包名
         */
        private boolean isTargetPackage(String packageName) {
            if (hostPackageName != null) {
                return hostPackageName.equals(packageName);
            }
            return SignatureConfig.TARGET_PACKAGE.equals(packageName);
        }

        /**
         * 处理 GET_SIGNATURES 请求
         *
         * 替换 PackageInfo.signatures[0]
         */
        private void handleGetSignatures(Pine.CallFrame callFrame, PackageInfo packageInfo, String packageName) {
            // 确保 signatures 数组存在
            if (packageInfo.signatures == null) {
                packageInfo.signatures = new Signature[1];
                ReflectUtils.logDebug("Created signatures array for " + packageName);
            }

            // 记录原始签名（调试用）
            if (SignatureConfig.DEBUG && packageInfo.signatures[0] != null) {
                int originalHash = packageInfo.signatures[0].hashCode();
                ReflectUtils.logDebug("Original signature hash: " + originalHash);
            }

            // 替换为原始签名
            packageInfo.signatures[0] = new Signature(SignatureConfig.ORIGINAL_SIGNATURE);

            // 记录新签名（调试用）
            if (SignatureConfig.DEBUG) {
                int newHash = packageInfo.signatures[0].hashCode();
                ReflectUtils.logDebug("Replaced signature hash: " + newHash);
            }

            // 设置修改后的结果
            callFrame.setResult(packageInfo);

            ReflectUtils.logInfo("Hooked GET_SIGNATURES for " + packageName);
        }

        /**
         * 处理 GET_SIGNING_CERTIFICATES 请求 (Android P+)
         *
         * 替换 PackageInfo.signingInfo.apkContentsSigners[0]
         */
        private void handleGetSigningCertificates(Pine.CallFrame callFrame, PackageInfo packageInfo, String packageName) {
            SigningInfo signingInfo = packageInfo.signingInfo;
            if (signingInfo == null) {
                ReflectUtils.logDebug("signingInfo is null for " + packageName);
                return;
            }

            // 获取签名数组
            Signature[] signers = signingInfo.getApkContentsSigners();
            if (signers == null) {
                signers = new Signature[1];
                ReflectUtils.logDebug("Created signers array for " + packageName);
            }

            // 记录原始签名（调试用）
            if (SignatureConfig.DEBUG && signers.length > 0 && signers[0] != null) {
                int originalHash = signers[0].hashCode();
                ReflectUtils.logDebug("Original certificate hash: " + originalHash);
            }

            // 替换为原始证书
            signers[0] = new Signature(SignatureConfig.ORIGINAL_CERTIFICATE);

            // 记录新签名（调试用）
            if (SignatureConfig.DEBUG) {
                int newHash = signers[0].hashCode();
                ReflectUtils.logDebug("Replaced certificate hash: " + newHash);
            }

            // 设置修改后的结果
            callFrame.setResult(packageInfo);

            ReflectUtils.logInfo("Hooked GET_SIGNING_CERTIFICATES for " + packageName);
        }
    }
}
