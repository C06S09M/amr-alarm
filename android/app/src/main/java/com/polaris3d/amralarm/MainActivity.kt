package com.polaris3d.amralarm

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.setPadding

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20)
            setBackgroundColor(0xFF0F172A.toInt())
        }
        val title = TextView(this).apply {
            text = "AMR 알람 앱"
            textSize = 20f
            setTextColor(0xFFE2E8F0.toInt())
        }
        val permissionButton = Button(this).apply {
            text = "알림 수집 권한 설정"
            setOnClickListener { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        }
        val web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            webViewClient = WebViewClient()
            loadUrl(BuildConfig.SERVER_URL)
        }
        root.addView(title)
        root.addView(permissionButton)
        root.addView(web, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
    }
}
