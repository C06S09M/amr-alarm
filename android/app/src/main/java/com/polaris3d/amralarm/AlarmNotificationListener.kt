package com.polaris3d.amralarm

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.text.TextUtils
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors

class AlarmNotificationListener : NotificationListenerService() {
    private val executor = Executors.newSingleThreadExecutor()

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val packageName = sbn.packageName
        val source = when {
            packageName.contains("kakao", true) -> "kakao"
            packageName.contains("mms", true) || packageName.contains("messaging", true) || packageName.contains("sms", true) -> "sms"
            sbn.notification.category == Notification.CATEGORY_CALL || packageName.contains("dialer", true) || packageName.contains("incallui", true) -> "call"
            else -> return
        }
        val extras = sbn.notification.extras
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
        if (TextUtils.isEmpty(title) && TextUtils.isEmpty(text)) return
        executor.execute { sendCapture(source, title, text, if (source == "call") "call" else "msg") }
    }

    private fun sendCapture(source: String, sender: String, text: String, type: String) {
        val body = listOf(
            "token" to BuildConfig.INGEST_TOKEN,
            "source" to source,
            "sender" to sender,
            "text" to text,
            "type" to type
        ).joinToString("&") { (key, value) ->
            "${URLEncoder.encode(key, "UTF-8")}=${URLEncoder.encode(value, "UTF-8")}"
        }
        val connection = (URL("${BuildConfig.SERVER_URL}/api/ingest").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
            connectTimeout = 10000
            readTimeout = 10000
        }
        try {
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            connection.inputStream.close()
        } catch (_: Exception) {
        } finally {
            connection.disconnect()
        }
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }
}
