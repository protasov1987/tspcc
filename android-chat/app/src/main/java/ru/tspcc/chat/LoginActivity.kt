package ru.tspcc.chat

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.launch
import ru.tspcc.chat.api.ApiClient
import ru.tspcc.chat.storage.Prefs

class LoginActivity : AppCompatActivity() {

    private val logTag = "FCM"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)

        NotificationUtils.ensureNotifications(this)

        val baseUrlInput = findViewById<EditText>(R.id.baseUrlInput)
        val passwordInput = findViewById<EditText>(R.id.passwordInput)
        val loginButton = findViewById<Button>(R.id.loginButton)
        val statusView = findViewById<TextView>(R.id.loginStatus)

        baseUrlInput.setText(Prefs.getBaseUrl(this))

        loginButton.setOnClickListener {
            val baseUrl = baseUrlInput.text?.toString()?.trim().orEmpty()
            if (baseUrl.isNotEmpty()) {
                Prefs.setBaseUrl(this, baseUrl)
            }

            val password = passwordInput.text?.toString().orEmpty()
            if (password.isBlank()) {
                statusView.text = "Введите пароль"
                return@setOnClickListener
            }

            statusView.text = "Вход..."
            lifecycleScope.launch {
                try {
                    val response = ApiClient.login(this@LoginActivity, password)
                    if (response.success && response.user != null) {
                        Prefs.setCsrfToken(this@LoginActivity, response.csrfToken)
                        Prefs.setUserId(this@LoginActivity, response.user.id)
                        registerFcmTokenIfNeeded()
                        goToConversations()
                    } else {
                        statusView.text = response.error ?: "Ошибка входа"
                    }
                } catch (ex: Exception) {
                    statusView.text = ex.message ?: "Ошибка входа"
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        lifecycleScope.launch {
            try {
                val session = ApiClient.getSession(this@LoginActivity)
                if (session.user != null) {
                    Prefs.setCsrfToken(this@LoginActivity, session.csrfToken)
                    Prefs.setUserId(this@LoginActivity, session.user.id)
                    registerFcmTokenIfNeeded()
                    goToConversations()
                }
            } catch (_: Exception) {
                // ignore
            }
        }
    }

    private fun registerFcmTokenIfNeeded() {
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful) {
                Log.d(logTag, "FCM token fetch failed", task.exception)
                return@addOnCompleteListener
            }
            val token = task.result ?: return@addOnCompleteListener
            Log.d(logTag, "FCM token acquired in LoginActivity")
            Prefs.setFcmToken(this, token)
            lifecycleScope.launch {
                try {
                    val ok = ApiClient.registerFcmTokenIfAvailable(this@LoginActivity, token)
                    Log.d(logTag, "FCM token register result (LoginActivity): $ok")
                } catch (_: Exception) {
                    Log.d(logTag, "FCM token register failed (LoginActivity)")
                    // ignore
                }
            }
        }
    }

    private fun goToConversations() {
        startActivity(Intent(this, ConversationsActivity::class.java))
        finish()
    }
}
