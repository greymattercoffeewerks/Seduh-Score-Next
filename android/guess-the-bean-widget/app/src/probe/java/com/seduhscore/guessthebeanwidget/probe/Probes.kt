package com.seduhscore.guessthebeanwidget.probe

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.glance.Button
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.seduhscore.guessthebeanwidget.DisplayLinkActivity
import com.seduhscore.guessthebeanwidget.R
import com.seduhscore.guessthebeanwidget.RefreshWidgetAction

// Each probe adds one Glance feature over a baseline. The production widget fails on Honor
// MagicOS with "Cannot add widget." after the loading spinner, i.e. the launcher cannot apply
// our RemoteViews; whichever probe first fails names the culprit.

private val white = ColorProvider(Color.White)

class Probe1Widget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) = provideContent {
        Text("P1 text")
    }
}

class Probe2Widget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) = provideContent {
        Column(modifier = GlanceModifier.fillMaxSize().background(Color(0xFF10202C)).padding(8.dp)) {
            Text("P2 bg", style = TextStyle(color = white))
        }
    }
}

class Probe3Widget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) = provideContent {
        Column(modifier = GlanceModifier.fillMaxSize().background(Color(0xDE10202C)).padding(8.dp)) {
            Text("P3 alpha", style = TextStyle(color = white))
        }
    }
}

class Probe4Widget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) = provideContent {
        Column(
            modifier = GlanceModifier.fillMaxSize().background(Color(0xFF10202C)).padding(8.dp)
                .clickable(actionStartActivity(Intent(context, DisplayLinkActivity::class.java))),
        ) {
            Text("P4 click", style = TextStyle(color = white))
        }
    }
}

class Probe5Widget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) = provideContent {
        Column(modifier = GlanceModifier.fillMaxSize().background(Color(0xFF10202C)).padding(4.dp)) {
            Button(text = "P5", onClick = actionRunCallback<RefreshWidgetAction>())
        }
    }
}

class Probe6Widget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) = provideContent {
        Column(modifier = GlanceModifier.fillMaxSize().background(Color(0xFF10202C)).padding(8.dp)) {
            Row(modifier = GlanceModifier.fillMaxWidth()) {
                Text("P6", style = TextStyle(color = white))
                Spacer(GlanceModifier.defaultWeight())
                Text("row", style = TextStyle(color = white))
            }
        }
    }
}

class Probe1Receiver : GlanceAppWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = Probe1Widget() }
class Probe2Receiver : GlanceAppWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = Probe2Widget() }
class Probe3Receiver : GlanceAppWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = Probe3Widget() }
class Probe4Receiver : GlanceAppWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = Probe4Widget() }
class Probe5Receiver : GlanceAppWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = Probe5Widget() }
class Probe6Receiver : GlanceAppWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = Probe6Widget() }

/** No Glance at all: a plain RemoteViews provider, the platform-level control. */
class Probe7PlainReceiver : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        appWidgetIds.forEach { id ->
            val views = RemoteViews(context.packageName, R.layout.probe_plain)
            views.setTextViewText(R.id.probe_plain_text, "P7 plain (no Glance)")
            appWidgetManager.updateAppWidget(id, views)
        }
    }
}
