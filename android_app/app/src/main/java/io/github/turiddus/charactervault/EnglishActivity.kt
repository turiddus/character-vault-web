package io.github.turiddus.charactervault

import android.content.Context
import android.content.res.Configuration
import androidx.activity.ComponentActivity
import java.util.Locale

/** Keep application-owned Android controls in English on every device. */
open class EnglishActivity : ComponentActivity() {
    override fun attachBaseContext(newBase: Context) {
        val config = Configuration(newBase.resources.configuration)
        config.setLocale(Locale.ENGLISH)
        config.setLayoutDirection(Locale.ENGLISH)
        super.attachBaseContext(newBase.createConfigurationContext(config))
    }
}
