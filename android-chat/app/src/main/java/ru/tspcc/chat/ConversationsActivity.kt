package ru.tspcc.chat

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import androidx.core.widget.addTextChangedListener
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessaging
import android.util.Log
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.tspcc.chat.api.ApiClient
import ru.tspcc.chat.api.SseClient
import ru.tspcc.chat.model.UserDto
import ru.tspcc.chat.storage.Prefs
import ru.tspcc.chat.ui.adapters.ConversationsAdapter

class ConversationsActivity : AppCompatActivity() {

    private val logTag = "FCM"

    private lateinit var adapter: ConversationsAdapter
    private var sseClient: SseClient? = null
    private var allUsers: List<UserDto> = emptyList()
    private var searchQuery: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_conversations)

        NotificationUtils.ensureNotifications(this)

        val list = findViewById<RecyclerView>(R.id.conversationsList)
        val refreshLayout = findViewById<SwipeRefreshLayout>(R.id.conversationsRefresh)
        val statusView = findViewById<TextView>(R.id.conversationsStatus)
        val settingsButton = findViewById<Button>(R.id.settingsButton)
        val searchInput = findViewById<EditText>(R.id.searchUserInput)

        adapter = ConversationsAdapter { user ->
            openChat(user)
        }

        list.layoutManager = LinearLayoutManager(this)
        list.adapter = adapter

        settingsButton.setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }

        searchInput.addTextChangedListener { editable ->
            searchQuery = editable?.toString().orEmpty()
            applyFilter()
        }

        refreshLayout.setOnRefreshListener {
            lifecycleScope.launch {
                try {
                    refreshUsers(statusView)
                } finally {
                    refreshLayout.isRefreshing = false
                }
            }
        }

        lifecycleScope.launch {
            statusView.text = "Загрузка..."
            refreshUsers(statusView)
        }
    }

    override fun onStart() {
        super.onStart()
        refreshFcmTokenRegistration()
        startSse()
        lifecycleScope.launch {
            refreshUsers(findViewById(R.id.conversationsStatus))
        }
    }

    override fun onStop() {
        super.onStop()
        stopSse()
    }

    private fun startSse() {
        stopSse()
        sseClient = SseClient(this, onEvent = { event, data ->
            when (event) {
                "unread_count", "user_status", "delivered_update", "read_update" -> {
                    runOnUiThread {
                        lifecycleScope.launch { refreshUsers(findViewById(R.id.conversationsStatus)) }
                    }
                }
                "message_new" -> {
                    try {
                        val json = JSONObject(data)
                        val message = json.optJSONObject("message")
                        val senderId = message?.optString("senderId")?.trim().orEmpty()
                        val conversationId = message?.optString("conversationId")?.trim()
                        val messageText = message?.optString("text")
                        val currentUserId = Prefs.getUserId(this)
                        if (senderId.isNotBlank() && senderId != currentUserId) {
                            bumpUnread(senderId)
                            showLocalNotification(senderId, messageText, conversationId)
                        }
                    } catch (_: Exception) {
                        // ignore
                    }
                }
                else -> {
                    // ignore unknown events
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

    private suspend fun refreshUsers(statusView: TextView) {
        try {
            val response = ApiClient.getUsers(this)
            val list = mutableListOf<UserDto>()
            list.addAll(response.users)
            if (list.none { it.id == SYSTEM_ID }) {
                list.add(UserDto(id = SYSTEM_ID, name = getString(R.string.label_system)))
            }
            allUsers = list
            applyFilter()
            statusView.text = ""
        } catch (ex: Exception) {
            statusView.text = ex.message ?: "Ошибка"
        }
    }

    private fun applyFilter() {
        val query = searchQuery.trim()
        val filtered = if (query.isBlank()) {
            allUsers
        } else {
            val lower = query.lowercase()
            allUsers.filter { user ->
                val name = (user.name ?: user.id).lowercase()
                name.contains(lower)
            }
        }
        adapter.submitList(filtered)
    }

    private fun openChat(user: UserDto) {
        if ((user.unreadCount ?: 0) > 0) {
            allUsers = allUsers.map { item ->
                if (item.id == user.id) item.copy(unreadCount = 0) else item
            }
            applyFilter()
        }
        val intent = Intent(this, ChatActivity::class.java)
        intent.putExtra(ChatActivity.EXTRA_USER_ID, user.id)
        intent.putExtra(ChatActivity.EXTRA_USER_NAME, user.name ?: user.id)
        intent.putExtra(ChatActivity.EXTRA_CONVERSATION_ID, user.conversationId)
        startActivity(intent)
    }

    companion object {
        const val SYSTEM_ID = "system"
    }

    private fun refreshFcmTokenRegistration() {
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful) {
                Log.d(logTag, "FCM token fetch failed (Conversations)", task.exception)
                return@addOnCompleteListener
            }
            val token = task.result ?: return@addOnCompleteListener
            Log.d(logTag, "FCM token acquired in ConversationsActivity")
            Prefs.setFcmToken(this, token)
            lifecycleScope.launch {
                try {
                    val ok = ApiClient.registerFcmTokenIfAvailable(this@ConversationsActivity, token)
                    Log.d(logTag, "FCM token register result (Conversations): $ok")
                } catch (_: Exception) {
                    Log.d(logTag, "FCM token register failed (Conversations)")
                    // ignore
                }
            }
        }
    }

    private fun showLocalNotification(userId: String, messageText: String?, conversationId: String?) {
        val user = allUsers.firstOrNull { it.id == userId }
        val title = user?.name ?: userId
        val body = if (!messageText.isNullOrBlank()) messageText else "Новое сообщение"

        val intent = Intent(this, ChatActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(ChatActivity.EXTRA_USER_ID, userId)
            putExtra(ChatActivity.EXTRA_USER_NAME, title)
            if (!conversationId.isNullOrBlank()) putExtra(ChatActivity.EXTRA_CONVERSATION_ID, conversationId)
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            userId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val soundEnabled = Prefs.isNotificationSoundEnabled(this)
        val vibrationEnabled = Prefs.isNotificationVibrationEnabled(this)
        val soundType = Prefs.getNotificationSoundType(this)
        val vibrationPattern = Prefs.getNotificationVibrationPattern(this)
        NotificationUtils.createChannel(this, soundEnabled, vibrationEnabled, soundType, vibrationPattern)

        val notification = NotificationCompat.Builder(this, NotificationUtils.CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .apply {
                if (soundEnabled) {
                    setSound(NotificationUtils.getSoundUri(soundType))
                } else {
                    setSound(null)
                }
                if (vibrationEnabled) {
                    setVibrate(NotificationUtils.getVibrationPattern(true, vibrationPattern))
                } else {
                    setVibrate(longArrayOf(0))
                }
            }
            .build()

        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(userId.hashCode(), notification)
    }

    private fun bumpUnread(userId: String) {
        allUsers = allUsers.map { item ->
            if (item.id == userId) {
                val current = item.unreadCount ?: 0
                item.copy(unreadCount = current + 1)
            } else {
                item
            }
        }
        applyFilter()
    }
}
