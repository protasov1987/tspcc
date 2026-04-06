package ru.tspcc.chat.fcm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import ru.tspcc.chat.ChatActivity
import ru.tspcc.chat.NotificationUtils
import ru.tspcc.chat.R
import ru.tspcc.chat.storage.Prefs

class MyFirebaseService : FirebaseMessagingService() {

    private val logTag = "FCM"

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(logTag, "FCM onNewToken received")
        Prefs.setFcmToken(this, token)
        // Если админ указал endpoint в настройках, пробуем зарегистрировать токен.
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val ok = ru.tspcc.chat.api.ApiClient.registerFcmTokenIfAvailable(this@MyFirebaseService, token)
                Log.d(logTag, "FCM token register result (Service): $ok")
            } catch (_: Exception) {
                Log.d(logTag, "FCM token register failed (Service)")
                // ignore
            }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        Log.d(logTag, "FCM onMessageReceived data=${message.data.keys} notification=${message.notification != null}")
        val title = message.notification?.title ?: "Новое сообщение"
        val body = message.notification?.body ?: "Откройте чат"

        val peerId = message.data["peerId"]
        val userName = message.data["userName"]
        val conversationId = message.data["conversationId"]

        val intent = Intent(this, ChatActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (!peerId.isNullOrBlank()) putExtra(ChatActivity.EXTRA_USER_ID, peerId)
            if (!userName.isNullOrBlank()) putExtra(ChatActivity.EXTRA_USER_NAME, userName)
            if (!conversationId.isNullOrBlank()) putExtra(ChatActivity.EXTRA_CONVERSATION_ID, conversationId)
        }

        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val channelId = NotificationUtils.CHANNEL_ID
        val soundEnabled = Prefs.isNotificationSoundEnabled(this)
        val vibrationEnabled = Prefs.isNotificationVibrationEnabled(this)
        val soundType = Prefs.getNotificationSoundType(this)
        val vibrationPattern = Prefs.getNotificationVibrationPattern(this)
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationUtils.createChannel(this, soundEnabled, vibrationEnabled, soundType, vibrationPattern)
        }

        val notification = NotificationCompat.Builder(this, channelId)
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

        notificationManager.notify(1001, notification)
    }
}
