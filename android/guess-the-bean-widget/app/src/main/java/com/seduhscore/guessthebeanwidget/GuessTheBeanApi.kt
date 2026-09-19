package com.seduhscore.guessthebeanwidget

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class DisplayedGuess(val label: String)

data class GuessFeed(
    val guessEnabled: Boolean = false,
    val revealed: Boolean = false,
    val guessCount: Int = 0,
    val guesses: List<DisplayedGuess> = emptyList(),
    val error: String? = null,
)

object GuessTheBeanApi {
    fun fetch(session: WidgetSession): GuessFeed = runCatching {
        if (BuildConfig.SUPABASE_URL.isBlank() || BuildConfig.SUPABASE_ANON_KEY.isBlank()) {
            return GuessFeed(error = "This development build has no Supabase connection.")
        }

        val baseUrl = BuildConfig.SUPABASE_URL.trimEnd('/')
        val status = getArray(
            "$baseUrl/rest/v1/sessions?id=eq.${session.id}&select=id,guess_enabled,revealed",
        )
        if (status.length() == 0) return GuessFeed(error = "This session is no longer available.")

        val sessionStatus = status.getJSONObject(0)
        val revealed = sessionStatus.getBoolean("revealed")
        val guessEnabled = sessionStatus.getBoolean("guess_enabled")
        val guesses = if (revealed) {
            postArray("$baseUrl/rest/v1/rpc/session_display_guesses", JSONObject().put("p_session_id", session.id))
                .let(::displayedRevealedGuesses)
        } else {
            getArray(
                "$baseUrl/rest/v1/guesses?session_id=eq.${session.id}&select=name,created_at&order=created_at.desc,id.desc&limit=3",
            ).let(::displayedOpenGuesses)
        }
        val guessCount = countGuesses(baseUrl, session.id)
        GuessFeed(guessEnabled = guessEnabled, revealed = revealed, guessCount = guessCount, guesses = guesses)
    }.getOrElse { GuessFeed(error = "Could not load guesses. Tap the app to try again.") }

    private fun displayedOpenGuesses(rows: JSONArray): List<DisplayedGuess> =
        (0 until rows.length()).map { DisplayedGuess(rows.getJSONObject(it).getString("name")) }

    private fun displayedRevealedGuesses(rows: JSONArray): List<DisplayedGuess> =
        (maxOf(0, rows.length() - 3) until rows.length()).reversed().map {
            val row = rows.getJSONObject(it)
            DisplayedGuess("${row.getString("name")} · ${row.getInt("guess")}")
        }

    private fun getArray(url: String): JSONArray = request(url, "GET", null)

    private fun postArray(url: String, body: JSONObject): JSONArray = request(url, "POST", body.toString())

    private fun countGuesses(baseUrl: String, sessionId: String): Int {
        val connection = (URL("$baseUrl/rest/v1/guesses?session_id=eq.$sessionId&select=id").openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 10_000
            readTimeout = 10_000
            setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY)
            setRequestProperty("Authorization", "Bearer ${BuildConfig.SUPABASE_ANON_KEY}")
            setRequestProperty("Prefer", "count=exact")
            setRequestProperty("Range", "0-0")
        }
        connection.inputStream.close()
        return connection.getHeaderField("Content-Range")
            ?.substringAfter('/', missingDelimiterValue = "")
            ?.toIntOrNull() ?: 0
    }

    private fun request(url: String, method: String, body: String?): JSONArray {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10_000
            readTimeout = 10_000
            setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY)
            setRequestProperty("Authorization", "Bearer ${BuildConfig.SUPABASE_ANON_KEY}")
            setRequestProperty("Accept", "application/json")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                outputStream.bufferedWriter().use { it.write(body) }
            }
        }
        val response = (if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream)
            ?.bufferedReader()?.use { it.readText() }.orEmpty()
        if (connection.responseCode !in 200..299) error("Supabase returned ${connection.responseCode}: $response")
        return JSONArray(response)
    }
}
