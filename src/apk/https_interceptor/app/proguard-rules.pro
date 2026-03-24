# 保留 OkHttp
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**

# 保留拦截器
-keep class com.httpinterceptor.interceptor.** { *; }
