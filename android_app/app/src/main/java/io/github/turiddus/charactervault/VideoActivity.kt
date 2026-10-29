package io.github.turiddus.charactervault

import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.MediaController
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.VideoView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * Player video dentro l'app: trasmette il file direttamente da Google Drive (con il token dell'account),
 * senza scaricarlo tutto; si può mettere in pausa e andare avanti/indietro. Usa i decoder del telefono.
 */
class VideoActivity : EnglishActivity() {
    companion object {
        const val EXTRA_FILE_ID = "fileId"
        const val EXTRA_TITLE = "title"
    }

    private lateinit var video: VideoView
    private lateinit var spinner: ProgressBar
    private lateinit var message: TextView
    private var position = 0

    private val consent = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) {
        GoogleAuth.onConsentResult(this, it.data)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        position = savedInstanceState?.getInt("pos") ?: 0
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        video = VideoView(this)
        root.addView(video, FrameLayout.LayoutParams(-1, -1, Gravity.CENTER))
        spinner = ProgressBar(this)
        root.addView(spinner, FrameLayout.LayoutParams(-2, -2, Gravity.CENTER))
        message = TextView(this).apply {
            setTextColor(Color.WHITE); textSize = 15f; gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48); visibility = View.GONE
        }
        root.addView(message, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER))
        setContentView(root)
        title = intent.getStringExtra(EXTRA_TITLE) ?: "Video"
        val fileId = intent.getStringExtra(EXTRA_FILE_ID)
        if (fileId.isNullOrEmpty()) { finish(); return }
        start(fileId)
    }

    private fun start(fileId: String) {
        GoogleAuth.authorize(this, consent, true) { token, error ->
            if (token == null) { fail("Google sign-in failed: $error"); return@authorize }
            val controls = MediaController(this).apply { setAnchorView(video) }
            video.setMediaController(controls)
            video.setOnPreparedListener { player ->
                spinner.visibility = View.GONE
                player.setOnInfoListener { _, what, _ ->
                    when (what) {
                        android.media.MediaPlayer.MEDIA_INFO_BUFFERING_START -> spinner.visibility = View.VISIBLE
                        android.media.MediaPlayer.MEDIA_INFO_BUFFERING_END -> spinner.visibility = View.GONE
                    }
                    false
                }
                if (position > 0) video.seekTo(position)
                video.start()
                controls.show(2500)
            }
            video.setOnErrorListener { _, _, _ ->
                fail("This phone cannot play the video (unsupported codec or unavailable file).\n\n" +
                    "Use Download original, or Convert to MP4 in the desktop Video section.")
                true
            }
            video.setOnCompletionListener { controls.show(0) }
            val uri = Uri.parse("https://www.googleapis.com/drive/v3/files/$fileId?alt=media&supportsAllDrives=true")
            video.setVideoURI(uri, mapOf("Authorization" to "Bearer $token"))
        }
    }

    private fun fail(text: String) {
        spinner.visibility = View.GONE
        message.text = text
        message.visibility = View.VISIBLE
    }

    override fun onPause() {
        super.onPause()
        if (video.isPlaying) { position = video.currentPosition; video.pause() }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putInt("pos", if (video.currentPosition > 0) video.currentPosition else position)
    }

    override fun onDestroy() {
        video.stopPlayback()
        super.onDestroy()
    }
}
