package com.httpinterceptor;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.method.ScrollingMovementMethod;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.httpinterceptor.interceptor.CertificatePinnerBypass;
import com.httpinterceptor.interceptor.LoggingInterceptor;
import com.httpinterceptor.interceptor.TokenInterceptor;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * HTTPS 请求拦截演示应用
 *
 * 功能：
 * 1. 发送 HTTP/HTTPS 请求
 * 2. 实时显示拦截到的请求/响应内容
 * 3. 演示 SSL 证书绕过
 * 4. 演示 Token 拦截
 *
 * 用于安全研究和教育目的
 */
public class MainActivity extends AppCompatActivity {

    private EditText etUrl;
    private EditText etRequestBody;
    private CheckBox cbBypassSsl;
    private CheckBox cbEnableTokenInterceptor;
    private Button btnGet;
    private Button btnPost;
    private Button btnClear;
    private TextView tvLog;
    private ScrollView scrollView;

    private Handler mainHandler;
    private StringBuilder logBuilder;
    private int requestCount = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        initViews();
        initListeners();

        mainHandler = new Handler(Looper.getMainLooper());
        logBuilder = new StringBuilder();

        appendLog("=== HTTPS 请求拦截演示 ===\n");
        appendLog("此工具基于恶意软件 pev70 的拦截机制原理\n");
        appendLog("用于安全研究和教育目的\n\n");
        appendLog("功能说明：\n");
        appendLog("1. 拦截所有 HTTP/HTTPS 请求\n");
        appendLog("2. 记录完整的请求头和请求体\n");
        appendLog("3. 记录完整的响应头和响应体\n");
        appendLog("4. 检测认证 Token 和敏感信息\n\n");
        appendLog("准备就绪，请输入 URL 并发送请求...\n\n");
    }

    private void initViews() {
        etUrl = findViewById(R.id.et_url);
        etRequestBody = findViewById(R.id.et_request_body);
        cbBypassSsl = findViewById(R.id.cb_bypass_ssl);
        cbEnableTokenInterceptor = findViewById(R.id.cb_token_interceptor);
        btnGet = findViewById(R.id.btn_get);
        btnPost = findViewById(R.id.btn_post);
        btnClear = findViewById(R.id.btn_clear);
        tvLog = findViewById(R.id.tv_log);
        scrollView = findViewById(R.id.scroll_view);

        tvLog.setMovementMethod(new ScrollingMovementMethod());

        // 设置默认 URL
        etUrl.setText("https://httpbin.org/get");
    }

    private void initListeners() {
        btnGet.setOnClickListener(v -> sendRequest("GET"));
        btnPost.setOnClickListener(v -> sendRequest("POST"));
        btnClear.setOnClickListener(v -> {
            logBuilder.setLength(0);
            tvLog.setText("");
            requestCount = 0;
            appendLog("日志已清空\n\n");
        });
    }

    private void sendRequest(String method) {
        String url = etUrl.getText().toString().trim();
        if (url.isEmpty()) {
            Toast.makeText(this, "请输入 URL", Toast.LENGTH_SHORT).show();
            return;
        }

        requestCount++;
        appendLog(">>> 发起请求 #" + requestCount + " <<<\n");
        appendLog("URL: " + url + "\n");
        appendLog("Method: " + method + "\n");
        appendLog("SSL 绕过: " + (cbBypassSsl.isChecked() ? "启用" : "禁用") + "\n");
        appendLog("Token 拦截: " + (cbEnableTokenInterceptor.isChecked() ? "启用" : "禁用") + "\n\n");

        // 创建 OkHttpClient
        OkHttpClient client = createOkHttpClient();

        // 构建请求
        Request.Builder requestBuilder = new Request.Builder().url(url);

        if ("POST".equals(method)) {
            String body = etRequestBody.getText().toString();
            if (body.isEmpty()) {
                body = "{}";
            }
            requestBuilder.post(RequestBody.create(body, MediaType.parse("application/json")));
        }

        Request request = requestBuilder.build();

        // 异步执行请求
        client.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                mainHandler.post(() -> {
                    appendLog("!!! 请求失败 !!!\n");
                    appendLog("错误: " + e.getMessage() + "\n\n");
                });
            }

            @Override
            public void onResponse(Call call, Response response) throws IOException {
                // 响应已经在拦截器中处理，这里只显示完成状态
                mainHandler.post(() -> {
                    appendLog(">>> 请求 #" + requestCount + " 完成 <<<\n\n");
                });
            }
        });
    }

    private OkHttpClient createOkHttpClient() {
        OkHttpClient.Builder builder = new OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS);

        // 添加日志拦截器（核心功能）
        builder.addInterceptor(new LoggingInterceptor(request -> {
            mainHandler.post(() -> {
                appendLog(request.toDisplayString());
                scrollToBottom();
            });
        }));

        // Token 拦截器（可选）
        if (cbEnableTokenInterceptor.isChecked()) {
            builder.addInterceptor(new TokenInterceptor((patternName, url, tokenInfo) -> {
                mainHandler.post(() -> {
                    appendLog("!!! TOKEN 检测 !!!\n");
                    appendLog("Pattern: " + patternName + "\n");
                    appendLog("URL: " + url + "\n");
                    appendLog("Token Info:\n" + tokenInfo + "\n\n");
                    scrollToBottom();
                });
            }));
        }

        // SSL 证书绕过（可选）
        if (cbBypassSsl.isChecked()) {
            CertificatePinnerBypass.configureTrustAll(builder);
            appendLog("[!] SSL 证书验证已禁用\n");
        }

        return builder.build();
    }

    private void appendLog(String text) {
        logBuilder.append(text);
        tvLog.setText(logBuilder.toString());
    }

    private void scrollToBottom() {
        scrollView.post(() -> scrollView.fullScroll(View.FOCUS_DOWN));
    }
}
