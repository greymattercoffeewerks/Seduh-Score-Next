package com.seduhscore.guessthebeanwidget

import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalContext
import androidx.glance.action.ActionParameters
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class LatestGuessesWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = LatestGuessesWidget()
}

class LatestGuessesWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: android.content.Context, id: GlanceId) {
        val repository = WidgetSessionRepository(context)
        val session = repository.load()
        val feed = session?.let { withContext(Dispatchers.IO) { GuessTheBeanApi.fetch(it) } }
        if (session != null && feed?.error == null) repository.markRefreshed()
        provideContent { LatestGuessesContent(session?.id, feed, repository.lastRefreshedAt()) }
    }
}

@Composable
private fun LatestGuessesContent(sessionId: String?, feed: GuessFeed?, refreshedAt: Long) {
    val context = LocalContext.current
    val white = ColorProvider(Color.White)
    val muted = ColorProvider(Color(0xFFB8C5D4))
    val coffee = ColorProvider(Color(0xFFF1BF82))
    val statusText = when {
        sessionId == null -> "SETUP"
        feed == null -> "READY"
        feed.revealed -> "REVEALED"
        feed.guessEnabled -> "OPEN"
        else -> "CLOSED"
    }
    val statusColor = ColorProvider(
        when (statusText) {
            "OPEN" -> Color(0xFF86EFAC)
            "REVEALED" -> Color(0xFFFCD34D)
            "CLOSED" -> Color(0xFFFCA5A5)
            else -> Color(0xFFB8C5D4)
        },
    )

    Column(
        modifier = GlanceModifier
            .fillMaxSize()
            .background(Color(0xDE10202C))
            .padding(12.dp)
            .clickable(actionStartActivity(Intent(context, DisplayLinkActivity::class.java))),
    ) {
        Text("GUESS THE BEAN · LIVE", style = TextStyle(color = coffee, fontSize = 12.sp), maxLines = 1)
        Spacer(GlanceModifier.height(6.dp))
        Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Vertical.CenterVertically) {
            Text(
                if (feed == null) "Latest activity" else "${feed.guessCount} guesses",
                style = TextStyle(color = white),
                maxLines = 1,
            )
            Spacer(GlanceModifier.defaultWeight())
            Text(statusText, style = TextStyle(color = statusColor), maxLines = 1)
        }
        Spacer(GlanceModifier.height(6.dp))
        // The body takes whatever height is left and clips beyond it, so the footer (Refresh) is
        // never pushed off the card. Not sized from LocalSize: Honor MagicOS reports a smaller,
        // wrong tile size (132x408dp reported for a ~177x312dp tile), so a height budget
        // computed from it under-fills the card. Launcher tile heights vary (~110dp stock,
        // ~177dp Honor 4x2); a short tile shows fewer names, a tall one up to three.
        Column(modifier = GlanceModifier.defaultWeight().fillMaxWidth()) {
            when {
                sessionId == null -> Text("Connect a session in the app to see new guesses here.", style = TextStyle(color = muted), maxLines = 2)
                feed?.error != null -> Text(feed.error, style = TextStyle(color = muted), maxLines = 2)
                feed == null -> Text("Session ${sessionId.take(8)} is ready to sync.", style = TextStyle(color = muted), maxLines = 1)
                feed.guesses.isEmpty() -> Text("No guesses yet.", style = TextStyle(color = muted), maxLines = 1)
                else -> feed.guesses.take(3).forEach { guess ->
                    Text(guess.label, style = TextStyle(color = white), maxLines = 1)
                }
            }
        }
        Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Vertical.CenterVertically) {
            if (refreshedAt > 0) {
                Text(lastUpdatedLabel(refreshedAt), style = TextStyle(color = muted, fontSize = 12.sp), maxLines = 1)
            }
            Spacer(GlanceModifier.defaultWeight())
            // Not Glance's Button: it fails to render in Honor MagicOS's launcher ("Cannot add
            // widget."); bisected 2026-09-19, see HONOR-COMPATIBILITY-STUDY.md. Box + Text +
            // clickable uses only primitives verified on Honor.
            Box(
                modifier = GlanceModifier
                    .background(Color(0x33F1BF82))
                    .padding(horizontal = 12.dp, vertical = 6.dp)
                    .clickable(actionRunCallback<RefreshWidgetAction>()),
            ) {
                Text("Refresh", style = TextStyle(color = coffee), maxLines = 1)
            }
        }
    }
}

private fun lastUpdatedLabel(timestamp: Long): String {
    val minutes = ((System.currentTimeMillis() - timestamp) / 60_000).coerceAtLeast(0)
    return if (minutes == 0L) "Updated just now" else "Updated ${minutes}m ago"
}

class RefreshWidgetAction : ActionCallback {
    override suspend fun onAction(
        context: android.content.Context,
        glanceId: GlanceId,
        parameters: ActionParameters,
    ) {
        LatestGuessesWidget().update(context, glanceId)
    }
}
