package ru.tspcc.chat

import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.widget.SwitchCompat
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import ru.tspcc.chat.api.ApiClient
import ru.tspcc.chat.storage.Prefs

class SettingsActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        val baseUrlInput = findViewById<EditText>(R.id.baseUrlInput)
        val fcmEndpointInput = findViewById<EditText>(R.id.fcmEndpointInput)
        val fcmTokenValue = findViewById<TextView>(R.id.fcmTokenValue)
        val userIdValue = findViewById<TextView>(R.id.userIdValue)
        val csrfValue = findViewById<TextView>(R.id.csrfValue)
        val notifySoundSwitch = findViewById<SwitchCompat>(R.id.notifySoundSwitch)
        val notifyVibrationSwitch = findViewById<SwitchCompat>(R.id.notifyVibrationSwitch)
        val notifySoundTypeSpinner = findViewById<Spinner>(R.id.notifySoundTypeSpinner)
        val notifyVibrationPatternSpinner = findViewById<Spinner>(R.id.notifyVibrationPatternSpinner)
        val chatSoundSwitch = findViewById<SwitchCompat>(R.id.chatSoundSwitch)
        val chatVibrationSwitch = findViewById<SwitchCompat>(R.id.chatVibrationSwitch)
        val chatSoundTypeSpinner = findViewById<Spinner>(R.id.chatSoundTypeSpinner)
        val chatVibrationPatternSpinner = findViewById<Spinner>(R.id.chatVibrationPatternSpinner)
        val saveButton = findViewById<Button>(R.id.saveButton)
        val clearButton = findViewById<Button>(R.id.clearSessionButton)
        val sendFcmButton = findViewById<Button>(R.id.sendFcmButton)
        val statusView = findViewById<TextView>(R.id.settingsStatus)

        baseUrlInput.setText(Prefs.getBaseUrl(this))
        fcmEndpointInput.setText(Prefs.getFcmEndpointPath(this))
        fcmTokenValue.text = Prefs.getFcmToken(this) ?: ""
        userIdValue.text = "userId: ${Prefs.getUserId(this) ?: "-"}"
        csrfValue.text = "csrf: ${Prefs.getCsrfToken(this) ?: "-"}"
        notifySoundSwitch.isChecked = Prefs.isNotificationSoundEnabled(this)
        notifyVibrationSwitch.isChecked = Prefs.isNotificationVibrationEnabled(this)
        notifySoundTypeSpinner.setSelection(Prefs.getNotificationSoundType(this))
        notifyVibrationPatternSpinner.setSelection(Prefs.getNotificationVibrationPattern(this))
        chatSoundSwitch.isChecked = Prefs.isChatSoundEnabled(this)
        chatVibrationSwitch.isChecked = Prefs.isChatVibrationEnabled(this)
        chatSoundTypeSpinner.setSelection(Prefs.getChatSoundType(this))
        chatVibrationPatternSpinner.setSelection(Prefs.getChatVibrationPattern(this))

        saveButton.setOnClickListener {
            Prefs.setBaseUrl(this, baseUrlInput.text?.toString().orEmpty())
            Prefs.setFcmEndpointPath(this, fcmEndpointInput.text?.toString().orEmpty())
            Prefs.setNotificationSoundEnabled(this, notifySoundSwitch.isChecked)
            Prefs.setNotificationVibrationEnabled(this, notifyVibrationSwitch.isChecked)
            Prefs.setNotificationSoundType(this, notifySoundTypeSpinner.selectedItemPosition)
            Prefs.setNotificationVibrationPattern(this, notifyVibrationPatternSpinner.selectedItemPosition)
            Prefs.setChatSoundEnabled(this, chatSoundSwitch.isChecked)
            Prefs.setChatVibrationEnabled(this, chatVibrationSwitch.isChecked)
            Prefs.setChatSoundType(this, chatSoundTypeSpinner.selectedItemPosition)
            Prefs.setChatVibrationPattern(this, chatVibrationPatternSpinner.selectedItemPosition)
            statusView.text = "Сохранено"
        }

        notifySoundSwitch.setOnCheckedChangeListener { _, isChecked ->
            Prefs.setNotificationSoundEnabled(this, isChecked)
            NotificationUtils.ensureNotifications(this)
        }

        notifyVibrationSwitch.setOnCheckedChangeListener { _, isChecked ->
            Prefs.setNotificationVibrationEnabled(this, isChecked)
            NotificationUtils.ensureNotifications(this)
        }

        notifySoundTypeSpinner.onItemSelectedListener = SimpleItemSelectedListener { position ->
            Prefs.setNotificationSoundType(this, position)
            NotificationUtils.ensureNotifications(this)
        }

        notifyVibrationPatternSpinner.onItemSelectedListener = SimpleItemSelectedListener { position ->
            Prefs.setNotificationVibrationPattern(this, position)
            NotificationUtils.ensureNotifications(this)
        }

        chatSoundSwitch.setOnCheckedChangeListener { _, isChecked ->
            Prefs.setChatSoundEnabled(this, isChecked)
        }

        chatVibrationSwitch.setOnCheckedChangeListener { _, isChecked ->
            Prefs.setChatVibrationEnabled(this, isChecked)
        }

        chatSoundTypeSpinner.onItemSelectedListener = SimpleItemSelectedListener { position ->
            Prefs.setChatSoundType(this, position)
        }

        chatVibrationPatternSpinner.onItemSelectedListener = SimpleItemSelectedListener { position ->
            Prefs.setChatVibrationPattern(this, position)
        }
        clearButton.setOnClickListener {
            Prefs.setCsrfToken(this, null)
            Prefs.setUserId(this, null)
            ApiClient.clearCookies()
            statusView.text = "Сессия сброшена"
        }

        sendFcmButton.setOnClickListener {
            val token = Prefs.getFcmToken(this)
            if (token.isNullOrBlank()) {
                statusView.text = "FCM token отсутствует"
                return@setOnClickListener
            }
            lifecycleScope.launch {
                try {
                    val ok = ApiClient.registerFcmTokenIfAvailable(this@SettingsActivity, token)
                    statusView.text = if (ok) {
                        "FCM token отправлен"
                    } else {
                        "FCM endpoint не задан"
                    }
                } catch (ex: Exception) {
                    statusView.text = ex.message ?: "Ошибка отправки"
                }
            }
        }
    }

    private class SimpleItemSelectedListener(
        private val onSelected: (Int) -> Unit
    ) : android.widget.AdapterView.OnItemSelectedListener {
        override fun onItemSelected(
            parent: android.widget.AdapterView<*>,
            view: android.view.View?,
            position: Int,
            id: Long
        ) {
            onSelected(position)
        }

        override fun onNothingSelected(parent: android.widget.AdapterView<*>) {
            // no-op
        }
    }
}
