package com.seduhscore.guessthebeanwidget

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.glance.appwidget.updateAll
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import com.seduhscore.guessthebeanwidget.ui.theme.GuestTheBeanWidgeTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            GuestTheBeanWidgeTheme {
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    SetupScreen(Modifier.padding(innerPadding), this@MainActivity)
                }
            }
        }
    }
}

@Composable
fun SetupScreen(modifier: Modifier = Modifier, activity: MainActivity? = null) {
    val repository = remember { activity?.let(::WidgetSessionRepository) }
    var sessionUrl by remember { mutableStateOf(repository?.load()?.url.orEmpty()) }
    var feedback by remember { mutableStateOf("") }
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Guess the Bean", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(8.dp))
        Text("Paste a participant or display link to connect this phone's widget.")
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(
            value = sessionUrl,
            onValueChange = { sessionUrl = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Guess the Bean session link") },
            singleLine = true,
        )
        Spacer(Modifier.height(12.dp))
        Button(onClick = {
            try {
                repository?.save(sessionUrl)
                activity?.let(WidgetRefreshScheduler::schedule)
                activity?.let { host ->
                    host.lifecycleScope.launch { LatestGuessesWidget().updateAll(host) }
                }
                feedback = "Session connected. Refresh the widget to load the latest guesses."
            } catch (error: IllegalArgumentException) {
                feedback = error.message ?: "That link does not contain a valid session."
            }
        }) { Text("Connect widget") }
        if (repository?.load() != null) {
            Spacer(Modifier.height(8.dp))
            Button(onClick = {
                repository.clear()
                activity?.let { host ->
                    WidgetRefreshScheduler.cancel(host)
                    host.lifecycleScope.launch { LatestGuessesWidget().updateAll(host) }
                }
                sessionUrl = ""
                feedback = "Widget disconnected."
            }) { Text("Disconnect widget") }
        }
        if (feedback.isNotEmpty()) {
            Spacer(Modifier.height(12.dp))
            Text(feedback)
        }
    }
}

@Preview(showBackground = true)
@Composable
fun SetupScreenPreview() {
    GuestTheBeanWidgeTheme {
        SetupScreen()
    }
}
