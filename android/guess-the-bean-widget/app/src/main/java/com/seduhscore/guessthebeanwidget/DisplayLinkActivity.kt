package com.seduhscore.guessthebeanwidget

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

class DisplayLinkActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WidgetSessionRepository(this).load()?.let { session ->
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(session.url)))
        }
        finish()
    }
}
