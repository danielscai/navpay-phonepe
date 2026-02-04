package com.phonepe.checksumclient

import android.content.Context

class AuthManager(context: Context) {
    private val prefs = context.getSharedPreferences("navpay_auth", Context.MODE_PRIVATE)

    fun saveToken(token: String, expiresAt: Long, username: String) {
        prefs.edit()
            .putString("token", token)
            .putLong("expires_at", expiresAt)
            .putString("username", username)
            .apply()
    }

    fun getToken(): String? = prefs.getString("token", null)

    fun getUsername(): String? = prefs.getString("username", null)

    fun isTokenValid(): Boolean {
        val token = getToken() ?: return false
        val exp = prefs.getLong("expires_at", 0L)
        return token.isNotEmpty() && exp > System.currentTimeMillis()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }
}
