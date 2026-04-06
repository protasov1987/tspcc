package ru.tspcc.chat

import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.media.RingtoneManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.tspcc.chat.api.ApiClient
import ru.tspcc.chat.api.SseClient
import ru.tspcc.chat.model.MessageDto
import ru.tspcc.chat.storage.Prefs
import ru.tspcc.chat.ui.adapters.MessagesAdapter

class ChatActivity : AppCompatActivity() {

    private lateinit var adapter: MessagesAdapter
    private var conversationId: String? = null
    private var peerId: String? = null
    private var sseClient: SseClient? = null
    private var currentUserId: String? = null
    private var lastDeliveredSeq: Int = 0
    private var lastReadSeq: Int = 0

    private val knownMessageIds = mutableSetOf<String>()
    private val knownClientMsgIds = mutableSetOf<String>()

    private val moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()
    private val messageAdapter = moshi.adapter(MessageDto::class.java)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_chat)

        val titleView = findViewById<TextView>(R.id.chatTitle)
        val listView = findViewById<RecyclerView>(R.id.messagesList)
        val refreshLayout = findViewById<SwipeRefreshLayout>(R.id.messagesRefresh)
        val inputRow = findViewById<View>(R.id.inputRow)
        val input = findViewById<EditText>(R.id.messageInput)
        val sendButton = findViewById<Button>(R.id.sendButton)
        val systemLabel = findViewById<TextView>(R.id.systemReadonlyLabel)

        peerId = intent.getStringExtra(EXTRA_USER_ID)
        val peerName = intent.getStringExtra(EXTRA_USER_NAME) ?: peerId
        conversationId = intent.getStringExtra(EXTRA_CONVERSATION_ID)

        titleView.text = peerName ?: "Чат"

        currentUserId = Prefs.getUserId(this)
        adapter = MessagesAdapter(currentUserId)
        listView.layoutManager = LinearLayoutManager(this)
        listView.adapter = adapter

        val isSystem = peerId == ConversationsActivity.SYSTEM_ID
        if (isSystem) {
            inputRow.visibility = View.GONE
            systemLabel.visibility = View.VISIBLE
        }

        sendButton.setOnClickListener {
            val text = input.text?.toString().orEmpty()
            if (text.isBlank()) return@setOnClickListener
            val convId = conversationId ?: return@setOnClickListener
            lifecycleScope.launch {
                try {
                    val response = ApiClient.sendMessage(this@ChatActivity, convId, text)
                    val msg = response.message
                    if (msg != null) {
                        if (addMessageIfNew(msg)) {
                            listView.scrollToPosition(adapter.itemCount - 1)
                        }
                        input.setText("")
                    }
                } catch (_: Exception) {
                    // ignore
                }
            }
        }

        refreshLayout.setOnRefreshListener {
            lifecycleScope.launch {
                try {
                    ensureConversationAndLoad()
                } finally {
                    refreshLayout.isRefreshing = false
                }
            }
        }

        lifecycleScope.launch {
            ensureConversationAndLoad()
        }
    }

    override fun onStart() {
        super.onStart()
        startSse()
        lifecycleScope.launch {
            ensureConversationAndLoad()
        }
    }

    override fun onStop() {
        super.onStop()
        stopSse()
    }

    private suspend fun ensureConversationAndLoad() {
        val peer = peerId ?: return
        if (peer == ConversationsActivity.SYSTEM_ID) {
            if (conversationId.isNullOrBlank()) {
                return
            }
        }

        if (conversationId.isNullOrBlank() && peer != ConversationsActivity.SYSTEM_ID) {
            val direct = ApiClient.ensureDirect(this, peer)
            conversationId = direct.conversationId
        }

        val convId = conversationId ?: return
        val response = ApiClient.getMessages(this, convId)
        adapter.submitList(response.messages)
        val state = response.states[peer] ?: response.states[convId]
        if (state != null) {
            lastDeliveredSeq = maxOf(lastDeliveredSeq, state.lastDeliveredSeq ?: 0)
            lastReadSeq = maxOf(lastReadSeq, state.lastReadSeq ?: 0)
        }
        adapter.updateState(lastDeliveredSeq, lastReadSeq)
        knownMessageIds.clear()
        knownClientMsgIds.clear()
        response.messages.forEach { msg ->
            if (msg.id.isNotBlank()) knownMessageIds.add(msg.id)
            if (!msg.clientMsgId.isNullOrBlank()) knownClientMsgIds.add(msg.clientMsgId)
        }
        if (adapter.itemCount > 0) {
            findViewById<RecyclerView>(R.id.messagesList).scrollToPosition(adapter.itemCount - 1)
        }
        val lastSeq = adapter.getLastSeq()
        if (lastSeq > 0) {
            ApiClient.markDelivered(this, convId, lastSeq)
            ApiClient.markRead(this, convId, lastSeq)
        }
    }

    private fun startSse() {
        stopSse()
        sseClient = SseClient(this, onEvent = { event, data ->
            val convId = conversationId ?: return@SseClient
            when (event) {
                "message_new" -> {
                    try {
                        val json = JSONObject(data)
                        val eventConversationId = json.optString("conversationId")
                        if (eventConversationId != convId) return@SseClient
                        val messageJson = json.optJSONObject("message")?.toString() ?: return@SseClient
                        val message = messageAdapter.fromJson(messageJson) ?: return@SseClient
                        runOnUiThread {
                            if (addMessageIfNew(message)) {
                                findViewById<RecyclerView>(R.id.messagesList).scrollToPosition(adapter.itemCount - 1)
                            }
                        }
                        if (message.senderId != currentUserId) {
                            playChatAlert()
                            lifecycleScope.launch {
                                ApiClient.markDelivered(this@ChatActivity, convId, message.seq)
                                ApiClient.markRead(this@ChatActivity, convId, message.seq)
                            }
                        }
                    } catch (_: Exception) {
                        // ignore
                    }
                }
                "delivered_update", "read_update" -> {
                    try {
                        val json = JSONObject(data)
                        val eventConversationId = json.optString("conversationId")
                        if (eventConversationId != convId) return@SseClient
                        val userId = json.optString("userId")
                        if (userId.isNotBlank() && userId != peerId) return@SseClient
                        val delivered = json.optInt("lastDeliveredSeq", 0)
                        val read = json.optInt("lastReadSeq", 0)
                        var updated = false
                        if (delivered > lastDeliveredSeq) {
                            lastDeliveredSeq = delivered
                            updated = true
                        }
                        if (read > lastReadSeq) {
                            lastReadSeq = read
                            updated = true
                        }
                        if (updated) {
                            runOnUiThread {
                                adapter.updateState(lastDeliveredSeq, lastReadSeq)
                            }
                        }
                    } catch (_: Exception) {
                        // ignore
                    }
                }
                else -> {
                    // ignore
                }
            }
        }, onError = {
            // ignore
        })
        sseClient?.connect()
    }

    private fun stopSse() {
        sseClient?.close()
        sseClient = null
    }

    private fun addMessageIfNew(message: MessageDto): Boolean {
        if (message.id.isNotBlank() && knownMessageIds.contains(message.id)) return false
        if (!message.clientMsgId.isNullOrBlank() && knownClientMsgIds.contains(message.clientMsgId)) return false
        if (message.id.isNotBlank()) knownMessageIds.add(message.id)
        if (!message.clientMsgId.isNullOrBlank()) knownClientMsgIds.add(message.clientMsgId)
        adapter.append(message)
        return true
    }

    private fun playChatAlert() {
        val soundEnabled = Prefs.isChatSoundEnabled(this)
        val vibrationEnabled = Prefs.isChatVibrationEnabled(this)
        val soundType = Prefs.getChatSoundType(this)
        val vibrationPattern = Prefs.getChatVibrationPattern(this)

        if (soundEnabled) {
            val uri = NotificationUtils.getSoundUri(soundType)
            val ringtone = RingtoneManager.getRingtone(this, uri)
            ringtone?.play()
        }

        if (vibrationEnabled) {
            val pattern = NotificationUtils.getVibrationPattern(true, vibrationPattern)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val manager = getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager
                manager.defaultVibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
            } else {
                @Suppress("DEPRECATION")
                val vibrator = getSystemService(VIBRATOR_SERVICE) as Vibrator
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
                } else {
                    @Suppress("DEPRECATION")
                    vibrator.vibrate(pattern, -1)
                }
            }
        }
    }

    companion object {
        const val EXTRA_USER_ID = "user_id"
        const val EXTRA_USER_NAME = "user_name"
        const val EXTRA_CONVERSATION_ID = "conversation_id"
    }
}
