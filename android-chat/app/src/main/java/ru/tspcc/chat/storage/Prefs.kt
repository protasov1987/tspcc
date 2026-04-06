package ru.tspcc.chat.storage

import android.content.Context
import android.content.SharedPreferences
import ru.tspcc.chat.BuildConfig

object Prefs {
    private const val PREFS_NAME = "tspcc_chat"
    private const val KEY_BASE_URL = "base_url"
    private const val KEY_CSRF = "csrf_token"
    private const val KEY_USER_ID = "user_id"
    private const val KEY_FCM_TOKEN = "fcm_token"
    private const val KEY_FCM_ENDPOINT = "fcm_endpoint"
    private const val KEY_NOTIFY_SOUND = "notify_sound"
    private const val KEY_NOTIFY_VIBRATION = "notify_vibration"
    private const val KEY_NOTIFY_SOUND_TYPE = "notify_sound_type"
    private const val KEY_NOTIFY_VIBRATION_PATTERN = "notify_vibration_pattern"
    private const val KEY_CHAT_SOUND = "chat_sound"
    private const val KEY_CHAT_VIBRATION = "chat_vibration"
    private const val KEY_CHAT_SOUND_TYPE = "chat_sound_type"
    private const val KEY_CHAT_VIBRATION_PATTERN = "chat_vibration_pattern"

    private fun prefs(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun getBaseUrl(context: Context): String {
        return prefs(context).getString(KEY_BASE_URL, BuildConfig.BASE_URL) ?: BuildConfig.BASE_URL
    }

    fun setBaseUrl(context: Context, value: String) {
        prefs(context).edit().putString(KEY_BASE_URL, value.trim()).apply()
    }

    fun getCsrfToken(context: Context): String? {
        return prefs(context).getString(KEY_CSRF, null)
    }

    fun setCsrfToken(context: Context, value: String?) {
        prefs(context).edit().putString(KEY_CSRF, value).apply()
    }

    fun getUserId(context: Context): String? {
        return prefs(context).getString(KEY_USER_ID, null)
    }

    fun setUserId(context: Context, value: String?) {
        prefs(context).edit().putString(KEY_USER_ID, value).apply()
    }

    fun getFcmToken(context: Context): String? {
        return prefs(context).getString(KEY_FCM_TOKEN, null)
    }

    fun setFcmToken(context: Context, value: String?) {
        prefs(context).edit().putString(KEY_FCM_TOKEN, value).apply()
    }

    fun getFcmEndpointPath(context: Context): String {
        return prefs(context).getString(KEY_FCM_ENDPOINT, "/api/fcm/subscribe") ?: "/api/fcm/subscribe"
    }

    fun setFcmEndpointPath(context: Context, value: String) {
        prefs(context).edit().putString(KEY_FCM_ENDPOINT, value.trim()).apply()
    }

    fun isNotificationSoundEnabled(context: Context): Boolean {
        return prefs(context).getBoolean(KEY_NOTIFY_SOUND, true)
    }

    fun setNotificationSoundEnabled(context: Context, value: Boolean) {
        prefs(context).edit().putBoolean(KEY_NOTIFY_SOUND, value).apply()
    }

    fun isNotificationVibrationEnabled(context: Context): Boolean {
        return prefs(context).getBoolean(KEY_NOTIFY_VIBRATION, true)
    }

    fun setNotificationVibrationEnabled(context: Context, value: Boolean) {
        prefs(context).edit().putBoolean(KEY_NOTIFY_VIBRATION, value).apply()
    }

    fun getNotificationSoundType(context: Context): Int {
        return prefs(context).getInt(KEY_NOTIFY_SOUND_TYPE, 0)
    }

    fun setNotificationSoundType(context: Context, value: Int) {
        prefs(context).edit().putInt(KEY_NOTIFY_SOUND_TYPE, value).apply()
    }

    fun getNotificationVibrationPattern(context: Context): Int {
        return prefs(context).getInt(KEY_NOTIFY_VIBRATION_PATTERN, 0)
    }

    fun setNotificationVibrationPattern(context: Context, value: Int) {
        prefs(context).edit().putInt(KEY_NOTIFY_VIBRATION_PATTERN, value).apply()
    }

    fun isChatSoundEnabled(context: Context): Boolean {
        return prefs(context).getBoolean(KEY_CHAT_SOUND, true)
    }

    fun setChatSoundEnabled(context: Context, value: Boolean) {
        prefs(context).edit().putBoolean(KEY_CHAT_SOUND, value).apply()
    }

    fun isChatVibrationEnabled(context: Context): Boolean {
        return prefs(context).getBoolean(KEY_CHAT_VIBRATION, true)
    }

    fun setChatVibrationEnabled(context: Context, value: Boolean) {
        prefs(context).edit().putBoolean(KEY_CHAT_VIBRATION, value).apply()
    }

    fun getChatSoundType(context: Context): Int {
        return prefs(context).getInt(KEY_CHAT_SOUND_TYPE, 0)
    }

    fun setChatSoundType(context: Context, value: Int) {
        prefs(context).edit().putInt(KEY_CHAT_SOUND_TYPE, value).apply()
    }

    fun getChatVibrationPattern(context: Context): Int {
        return prefs(context).getInt(KEY_CHAT_VIBRATION_PATTERN, 0)
    }

    fun setChatVibrationPattern(context: Context, value: Int) {
        prefs(context).edit().putInt(KEY_CHAT_VIBRATION_PATTERN, value).apply()
    }
}
