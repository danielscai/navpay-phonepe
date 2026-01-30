package com.httpinterceptor.interceptor;

import java.io.IOException;

import okhttp3.Interceptor;
import okhttp3.Request;
import okhttp3.Response;

/**
 * 最小化拦截器：仅验证注入链路，不做任何日志或解析。
 */
public class RemoteLoggingInterceptor implements Interceptor {

    @Override
    public Response intercept(Chain chain) throws IOException {
        Request request = chain.request();
        return safeProceed(chain, request);
    }

    private static Response safeProceed(Chain chain, Request request) throws IOException {
        try {
            return chain.proceed(request);
        } catch (NoSuchMethodError e) {
            // 运行时 Chain.proceed 被混淆为 a(Request)
            try {
                return (Response) chain.getClass()
                    .getMethod("a", Request.class)
                    .invoke(chain, request);
            } catch (Throwable t) {
                if (t instanceof IOException) {
                    throw (IOException) t;
                }
                if (t.getCause() instanceof IOException) {
                    throw (IOException) t.getCause();
                }
                throw new IOException("Proceed failed", t);
            }
        }
    }
}
