package com.httpinterceptor.interceptor;

import android.util.Log;

import java.security.SecureRandom;
import java.security.cert.X509Certificate;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

import okhttp3.OkHttpClient;

/**
 * SSL/TLS 证书验证绕过工具
 *
 * 原理说明：
 * 1. 恶意软件 pev70 通过替换 CertificatePinner 类来禁用证书固定
 * 2. 这使得 HTTPS 请求可以被中间人攻击拦截
 *
 * 安全研究用途：
 * - 用于测试应用是否正确实现了证书固定
 * - 用于安全审计和渗透测试
 *
 * 警告：仅用于安全研究，请勿用于恶意目的
 */
public class CertificatePinnerBypass {

    private static final String TAG = "CertBypass";

    /**
     * 创建信任所有证书的 TrustManager
     */
    public static X509TrustManager createTrustAllManager() {
        return new X509TrustManager() {
            @Override
            public void checkClientTrusted(X509Certificate[] chain, String authType) {
                // 不验证客户端证书
                Log.d(TAG, "checkClientTrusted bypassed for: " + authType);
            }

            @Override
            public void checkServerTrusted(X509Certificate[] chain, String authType) {
                // 不验证服务器证书 - 这就是恶意软件绕过 SSL 的方式
                Log.d(TAG, "checkServerTrusted bypassed for: " + authType);
                if (chain != null && chain.length > 0) {
                    Log.d(TAG, "Server cert subject: " + chain[0].getSubjectDN().getName());
                }
            }

            @Override
            public X509Certificate[] getAcceptedIssuers() {
                return new X509Certificate[0];
            }
        };
    }

    /**
     * 创建信任所有主机名的 HostnameVerifier
     */
    public static HostnameVerifier createTrustAllHostnameVerifier() {
        return new HostnameVerifier() {
            @Override
            public boolean verify(String hostname, SSLSession session) {
                Log.d(TAG, "Hostname verification bypassed for: " + hostname);
                return true;
            }
        };
    }

    /**
     * 创建绕过 SSL 验证的 SSLSocketFactory
     */
    public static SSLSocketFactory createTrustAllSSLSocketFactory(X509TrustManager trustManager) {
        try {
            SSLContext sslContext = SSLContext.getInstance("TLS");
            sslContext.init(null, new TrustManager[]{trustManager}, new SecureRandom());
            return sslContext.getSocketFactory();
        } catch (Exception e) {
            throw new RuntimeException("Failed to create SSL socket factory", e);
        }
    }

    /**
     * 配置 OkHttpClient.Builder 以绕过 SSL 验证
     *
     * 这模拟了恶意软件中 CertificatePinner.java 的行为
     */
    public static OkHttpClient.Builder configureTrustAll(OkHttpClient.Builder builder) {
        X509TrustManager trustManager = createTrustAllManager();
        SSLSocketFactory sslSocketFactory = createTrustAllSSLSocketFactory(trustManager);

        builder.sslSocketFactory(sslSocketFactory, trustManager);
        builder.hostnameVerifier(createTrustAllHostnameVerifier());

        Log.d(TAG, "SSL certificate verification disabled");
        return builder;
    }
}
