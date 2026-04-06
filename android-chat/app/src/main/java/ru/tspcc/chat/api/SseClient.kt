package ru.tspcc.chat.api

import android.content.Context
import okhttp3.Request
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources

class SseClient(
    private val context: Context,
    private val onEvent: (event: String, data: String) -> Unit,
    private val onError: (Throwable) -> Unit = {}
) {
    private var eventSource: EventSource? = null

    fun connect() {
        val baseUrl = ru.tspcc.chat.storage.Prefs.getBaseUrl(context).trimEnd('/')
        val request = Request.Builder()
            .url("$baseUrl/api/chat/stream")
            .addHeader("X-Client-Platform", "android")
            .build()

        val factory = EventSources.createFactory(ApiClient.getOkHttpClient())
        eventSource = factory.newEventSource(request, object : EventSourceListener() {
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                val eventName = type ?: "message"
                onEvent(eventName, data)
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: okhttp3.Response?) {
                if (t != null) onError(t)
            }
        })
    }

    fun close() {
        eventSource?.cancel()
        eventSource = null
    }
}
