package com.seduhscore.guessthebeanwidget

import android.content.Context
import android.net.Uri
import java.util.UUID

data class WidgetSession(val url: String, val id: String)

class WidgetSessionRepository(context: Context) {
    private val preferences = context.getSharedPreferences("guess_the_bean_widget", Context.MODE_PRIVATE)

    fun load(): WidgetSession? {
        val url = preferences.getString("session_url", null) ?: return null
        return parse(url)
    }

    fun save(url: String) {
        val session = parse(url) ?: throw IllegalArgumentException("Paste a Guess the Bean link with a valid session.")
        preferences.edit().putString("session_url", session.url).apply()
    }

    fun clear() {
        preferences.edit().clear().apply()
    }

    fun markRefreshed() {
        preferences.edit().putLong("last_refreshed_at", System.currentTimeMillis()).apply()
    }

    fun lastRefreshedAt(): Long = preferences.getLong("last_refreshed_at", 0)

    private fun parse(value: String): WidgetSession? = runCatching {
        val uri = Uri.parse(value.trim())
        val id = uri.getQueryParameter("session") ?: return null
        UUID.fromString(id)
        WidgetSession(value.trim(), id)
    }.getOrNull()
}
