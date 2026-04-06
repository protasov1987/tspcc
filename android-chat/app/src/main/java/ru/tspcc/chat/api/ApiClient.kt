package ru.tspcc.chat.api

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.JavaNetCookieJar
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import ru.tspcc.chat.model.*
import ru.tspcc.chat.storage.Prefs
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import java.net.CookieManager
import java.net.CookiePolicy
import java.util.UUID

object ApiClient {
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    private val moshi: Moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()

    private val loginAdapter = moshi.adapter(LoginResponse::class.java)
    private val sessionAdapter = moshi.adapter(SessionResponse::class.java)
    private val usersAdapter = moshi.adapter(UsersResponse::class.java)
    private val directAdapter = moshi.adapter(DirectResponse::class.java)
    private val messagesAdapter = moshi.adapter(MessagesResponse::class.java)
    private val messageAdapter = moshi.adapter(MessageResponse::class.java)

    private val cookieManager = CookieManager().apply {
        setCookiePolicy(CookiePolicy.ACCEPT_ALL)
    }

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .cookieJar(JavaNetCookieJar(cookieManager))
            .build()
    }

    private fun baseUrl(context: Context): String = Prefs.getBaseUrl(context).trimEnd('/')

    private fun buildRequest(context: Context, method: String, path: String, bodyJson: String? = null): Request {
        val url = baseUrl(context) + path
        val builder = Request.Builder()
            .url(url)
            .addHeader("X-Client-Platform", "android")
        if (method == "POST" || method == "PUT" || method == "DELETE") {
            val csrf = Prefs.getCsrfToken(context)
            if (!csrf.isNullOrBlank()) {
                builder.addHeader("X-CSRF-Token", csrf)
            }
        }
        if (bodyJson != null) {
            builder.method(method, bodyJson.toRequestBody(jsonMediaType))
        } else {
            builder.method(method, null)
        }
        return builder.build()
    }

    suspend fun login(context: Context, password: String): LoginResponse = withContext(Dispatchers.IO) {
        val payload = "{\"password\":${jsonEscape(password)}}"
        val req = buildRequest(context, "POST", "/api/login", payload)
        client.newCall(req).execute().use { resp ->
            val body = resp.body?.string().orEmpty()
            return@withContext loginAdapter.fromJson(body) ?: LoginResponse(success = false, error = "Bad response")
        }
    }

    suspend fun getSession(context: Context): SessionResponse = withContext(Dispatchers.IO) {
        val req = buildRequest(context, "GET", "/api/session")
        client.newCall(req).execute().use { resp ->
            val body = resp.body?.string().orEmpty()
            return@withContext sessionAdapter.fromJson(body) ?: SessionResponse(error = "Bad response")
        }
    }

    suspend fun getUsers(context: Context): UsersResponse = withContext(Dispatchers.IO) {
        val req = buildRequest(context, "GET", "/api/chat/users")
        client.newCall(req).execute().use { resp ->
            val body = resp.body?.string().orEmpty()
            return@withContext usersAdapter.fromJson(body) ?: UsersResponse()
        }
    }

    suspend fun ensureDirect(context: Context, peerId: String): DirectResponse = withContext(Dispatchers.IO) {
        val payload = "{\"peerId\":${jsonEscape(peerId)}}"
        val req = buildRequest(context, "POST", "/api/chat/direct", payload)
        client.newCall(req).execute().use { resp ->
            val body = resp.body?.string().orEmpty()
            return@withContext directAdapter.fromJson(body) ?: DirectResponse(error = "Bad response")
        }
    }

    suspend fun getMessages(context: Context, conversationId: String, limit: Int = 50): MessagesResponse = withContext(Dispatchers.IO) {
        val req = buildRequest(context, "GET", "/api/chat/conversations/${conversationId}/messages?limit=$limit")
        client.newCall(req).execute().use { resp ->
            val body = resp.body?.string().orEmpty()
            return@withContext messagesAdapter.fromJson(body) ?: MessagesResponse()
        }
    }

    suspend fun sendMessage(context: Context, conversationId: String, text: String): MessageResponse = withContext(Dispatchers.IO) {
        val clientMsgId = UUID.randomUUID().toString()
        val payload = "{\"text\":${jsonEscape(text)},\"clientMsgId\":${jsonEscape(clientMsgId)}}"
        val req = buildRequest(context, "POST", "/api/chat/conversations/${conversationId}/messages", payload)
        client.newCall(req).execute().use { resp ->
            val body = resp.body?.string().orEmpty()
            return@withContext messageAdapter.fromJson(body) ?: MessageResponse(error = "Bad response")
        }
    }

    suspend fun markDelivered(context: Context, conversationId: String, lastDeliveredSeq: Int): Boolean = withContext(Dispatchers.IO) {
        val payload = "{\"lastDeliveredSeq\":$lastDeliveredSeq}"
        val req = buildRequest(context, "POST", "/api/chat/conversations/${conversationId}/delivered", payload)
        client.newCall(req).execute().use { resp ->
            return@withContext resp.isSuccessful
        }
    }

    suspend fun markRead(context: Context, conversationId: String, lastReadSeq: Int): Boolean = withContext(Dispatchers.IO) {
        val payload = "{\"lastReadSeq\":$lastReadSeq}"
        val req = buildRequest(context, "POST", "/api/chat/conversations/${conversationId}/read", payload)
        client.newCall(req).execute().use { resp ->
            return@withContext resp.isSuccessful
        }
    }

    suspend fun registerFcmTokenIfAvailable(context: Context, token: String): Boolean = withContext(Dispatchers.IO) {
        val endpointPath = Prefs.getFcmEndpointPath(context).trim()
        if (endpointPath.isBlank()) return@withContext false
        val path = if (endpointPath.startsWith("/")) endpointPath else "/$endpointPath"
        val platform = "android"
        val device = android.os.Build.MODEL ?: ""
        val payload = "{\"token\":${jsonEscape(token)},\"platform\":${jsonEscape(platform)},\"device\":${jsonEscape(device)}}"
        val req = buildRequest(context, "POST", path, payload)
        client.newCall(req).execute().use { resp ->
            return@withContext resp.isSuccessful
        }
    }

    fun getOkHttpClient(): OkHttpClient = client

    fun clearCookies() {
        cookieManager.cookieStore.removeAll()
    }

    private fun jsonEscape(value: String): String {
        val escaped = value.replace("\\", "\\\\").replace("\"", "\\\"")
        return "\"$escaped\""
    }
}
