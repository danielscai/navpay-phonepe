package com.phonepe.checksumclient

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

class ApiClient(private val authManager: AuthManager) {
    private val jsonMedia = "application/json".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(5, java.util.concurrent.TimeUnit.SECONDS)
        .writeTimeout(5, java.util.concurrent.TimeUnit.SECONDS)
        .build()

    suspend fun login(username: String, password: String): LoginResult = withContext(Dispatchers.IO) {
        val payload = JSONObject().apply {
            put("username", username)
            put("password", password)
        }
        val req = Request.Builder()
            .url("${BASE_URL}/auth/login")
            .post(payload.toString().toRequestBody(jsonMedia))
            .build()
        val resp = client.newCall(req).execute()
        val body = resp.body?.string().orEmpty()
        if (!resp.isSuccessful) {
            throw RuntimeException("login failed: ${resp.code} $body")
        }
        val json = JSONObject(body)
        val token = json.getString("token")
        val expiresAt = json.getLong("expiresAt")
        val user = json.getJSONObject("user")
        val profile = UserProfile(
            username = user.getString("username"),
            name = user.getString("name"),
            phone = user.getString("phone"),
            email = user.getString("email")
        )
        authManager.saveToken(token, expiresAt, profile.username)
        LoginResult(token, expiresAt, profile)
    }

    suspend fun logout(): Boolean = withContext(Dispatchers.IO) {
        val token = authManager.getToken() ?: return@withContext false
        val req = Request.Builder()
            .url("${BASE_URL}/auth/logout")
            .post("".toRequestBody(jsonMedia))
            .addHeader("Authorization", "Bearer $token")
            .build()
        val resp = client.newCall(req).execute()
        resp.isSuccessful
    }

    suspend fun getProfile(): UserProfile = withContext(Dispatchers.IO) {
        val json = getAuthed("${BASE_URL}/me")
        UserProfile(
            username = json.getString("username"),
            name = json.getString("name"),
            phone = json.getString("phone"),
            email = json.getString("email")
        )
    }

    suspend fun updateProfile(name: String, phone: String, email: String): UserProfile = withContext(Dispatchers.IO) {
        val payload = JSONObject().apply {
            put("name", name)
            put("phone", phone)
            put("email", email)
        }
        val json = postAuthed("${BASE_URL}/me", payload)
        UserProfile(
            username = json.getString("username"),
            name = json.getString("name"),
            phone = json.getString("phone"),
            email = json.getString("email")
        )
    }

    suspend fun getMyOrders(): List<Order> = withContext(Dispatchers.IO) {
        val json = getAuthed("${BASE_URL}/orders/my")
        parseOrders(json.getJSONArray("orders"))
    }

    suspend fun getOpenOrders(): List<Order> = withContext(Dispatchers.IO) {
        val json = getAuthed("${BASE_URL}/orders/open")
        parseOrders(json.getJSONArray("orders"))
    }

    suspend fun claimOrder(orderId: String): Order = withContext(Dispatchers.IO) {
        val json = postAuthed("${BASE_URL}/orders/${orderId}/claim", JSONObject())
        val order = json.getJSONObject("order")
        parseOrder(order)
    }

    suspend fun getEarnings(): EarningsResponse = withContext(Dispatchers.IO) {
        val json = getAuthed("${BASE_URL}/earnings")
        val total = json.getDouble("total")
        val list = parseEarnings(json.getJSONArray("earnings"))
        EarningsResponse(total, list)
    }

    private fun getAuthed(url: String): JSONObject {
        val token = authManager.getToken() ?: throw RuntimeException("missing token")
        val req = Request.Builder()
            .url(url)
            .get()
            .addHeader("Authorization", "Bearer $token")
            .build()
        val resp = client.newCall(req).execute()
        val body = resp.body?.string().orEmpty()
        if (resp.code == 401) {
            authManager.clear()
            throw AuthException("token_invalid")
        }
        if (!resp.isSuccessful) {
            throw RuntimeException("request failed: ${resp.code} $body")
        }
        return JSONObject(body)
    }

    private fun postAuthed(url: String, payload: JSONObject): JSONObject {
        val token = authManager.getToken() ?: throw RuntimeException("missing token")
        val req = Request.Builder()
            .url(url)
            .post(payload.toString().toRequestBody(jsonMedia))
            .addHeader("Authorization", "Bearer $token")
            .build()
        val resp = client.newCall(req).execute()
        val body = resp.body?.string().orEmpty()
        if (resp.code == 401) {
            authManager.clear()
            throw AuthException("token_invalid")
        }
        if (!resp.isSuccessful) {
            throw RuntimeException("request failed: ${resp.code} $body")
        }
        return JSONObject(body)
    }

    private fun parseOrders(array: JSONArray): List<Order> {
        val list = ArrayList<Order>()
        for (i in 0 until array.length()) {
            list.add(parseOrder(array.getJSONObject(i)))
        }
        return list
    }

    private fun parseOrder(obj: JSONObject): Order {
        return Order(
            id = obj.getString("id"),
            amount = obj.getDouble("amount"),
            currency = obj.getString("currency"),
            status = obj.getString("status"),
            createdAt = obj.getString("createdAt"),
            paymentApp = obj.optString("paymentApp", ""),
            assignedTo = if (obj.isNull("assignedTo")) null else obj.optString("assignedTo", ""),
            claimedAt = if (obj.isNull("claimedAt")) null else obj.optString("claimedAt", ""),
            claimExpiresAt = if (obj.isNull("claimExpiresAt")) null else obj.optLong("claimExpiresAt")
        )
    }

    private fun parseEarnings(array: JSONArray): List<Earning> {
        val list = ArrayList<Earning>()
        for (i in 0 until array.length()) {
            val obj = array.getJSONObject(i)
            list.add(
                Earning(
                    id = obj.getString("id"),
                    amount = obj.getDouble("amount"),
                    currency = obj.getString("currency"),
                    note = obj.getString("note"),
                    createdAt = obj.getString("createdAt")
                )
            )
        }
        return list
    }

    companion object {
        const val BASE_URL = "http://10.0.2.2:3000"
    }
}

class AuthException(message: String) : RuntimeException(message)
