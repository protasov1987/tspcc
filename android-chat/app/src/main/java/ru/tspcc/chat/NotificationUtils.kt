package ru.tspcc.chat

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.appcompat.app.AppCompatActivity
import ru.tspcc.chat.storage.Prefs
import android.media.RingtoneManager

object NotificationUtils {
    const val CHANNEL_ID = "chat_messages"

    fun ensureNotifications(activity: AppCompatActivity) {
        val soundEnabled = Prefs.isNotificationSoundEnabled(activity)
        val vibrationEnabled = Prefs.isNotificationVibrationEnabled(activity)
        val soundType = Prefs.getNotificationSoundType(activity)
        val vibrationPattern = Prefs.getNotificationVibrationPattern(activity)
        createChannel(activity, soundEnabled, vibrationEnabled, soundType, vibrationPattern)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) ==
                android.content.pm.PackageManager.PERMISSION_GRANTED
            if (!granted) {
                ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
            }
        }
    }

    fun createChannel(
        context: Context,
        soundEnabled: Boolean,
        vibrationEnabled: Boolean,
        soundType: Int,
        vibrationPattern: Int
    ) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val existing = manager.getNotificationChannel(CHANNEL_ID)
            if (existing != null) {
                val hasSound = existing.sound != null
                val hasVibration = existing.shouldVibrate()
                val desiredSound = if (soundEnabled) getSoundUri(soundType) else null
                val desiredVibration = getVibrationPattern(vibrationEnabled, vibrationPattern)
                val soundMatches = if (soundEnabled) existing.sound == desiredSound else existing.sound == null
                val vibrationMatches = if (vibrationEnabled) {
                    val existingPattern = existing.vibrationPattern
                    existingPattern != null && existingPattern.contentEquals(desiredVibration)
                } else {
                    !existing.shouldVibrate()
                }
                if (hasSound == soundEnabled && hasVibration == vibrationEnabled && soundMatches && vibrationMatches) {
                    return
                }
                manager.deleteNotificationChannel(CHANNEL_ID)
            }
            val channel = NotificationChannel(CHANNEL_ID, "Сообщения", NotificationManager.IMPORTANCE_DEFAULT)
            val vibration = getVibrationPattern(vibrationEnabled, vibrationPattern)
            channel.enableVibration(vibrationEnabled)
            channel.vibrationPattern = vibration
            if (soundEnabled) {
                val attrs = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
                val soundUri = getSoundUri(soundType)
                channel.setSound(soundUri, attrs)
            } else {
                channel.setSound(null, null)
            }
            manager.createNotificationChannel(channel)
        }
    }

    fun getSoundUri(soundType: Int): Uri {
        return when (soundType) {
            1 -> RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            2 -> RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            else -> RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        }
    }

    fun getVibrationPattern(enabled: Boolean, patternType: Int): LongArray {
        if (!enabled) return longArrayOf(0)
        return when (patternType) {
            1 -> longArrayOf(0, 400, 200, 400, 200, 400)
            else -> longArrayOf(0, 200, 100, 200)
        }
    }
}
