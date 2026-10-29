package io.github.turiddus.charactervault

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.os.SystemClock
import android.content.pm.ActivityInfo
import android.view.HapticFeedbackConstants
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/**
 * Character Vault per Android: la stessa interfaccia della web app (galleria sincronizzata con l'archivio su
 * Google Drive) con le parti native che il browser non offre: accesso Google con l'account del telefono, download
 * nella Galleria, «Condividi» da altre app, fotocamera e ritaglio in medium close-up con rilevamento dei volti.
 */
class MainActivity : EnglishActivity() {
    companion object {
        private const val ORIGIN = "https://appassets.androidplatform.net"
        private const val START = "$ORIGIN/assets/index.html"
        private val AUDIO_EXTENSIONS = setOf(".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".wav", ".flac")
    }

    private lateinit var web: WebView
    private val main = Handler(Looper.getMainLooper())
    // Android WebView may not emit a visibilitychange event when an Activity
    // resumes. Poll only while the app is in the foreground, without a service
    // or background access to Drive.
    private val syncEvery40Seconds = object : Runnable {
        override fun run() {
            if (jsReady) js("window.__cvAutoSyncFromAndroid && window.__cvAutoSyncFromAndroid(false)")
            main.postDelayed(this, 40_000L)
        }
    }
    private val io = Executors.newFixedThreadPool(2)
    private var inbox = ""
    private var jsReady = false
    private val sharedQueue = ArrayList<Uri>()
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraUri: Uri? = null
    @Volatile private var pageReady = false

    private val consent = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) {
        GoogleAuth.onConsentResult(this, it.data)
    }
    private val chooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val cb = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        val uris = ArrayList<Uri>()
        if (res.resultCode == RESULT_OK) {
            val data = res.data
            data?.clipData?.let { clip -> for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri) }
            if (uris.isEmpty()) data?.data?.let { uris.add(it) }
            if (uris.isEmpty()) cameraUri?.let { uris.add(it) }   // foto scattata con la fotocamera
        }
        cb.onReceiveValue(uris.toTypedArray())
    }
    private val cropper = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val n = res.data?.getIntExtra(CropActivity.EXTRA_UPLOADED, 0) ?: 0
        if (n > 0) js("window.__cvNativeUploaded && window.__cvNativeUploaded($n)")
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        // 7.2: animated Character Vault splash, kept until the page has drawn (at most 2.5 s).
        val splash = installSplashScreen()
        val started = SystemClock.uptimeMillis()
        splash.setKeepOnScreenCondition { !pageReady && SystemClock.uptimeMillis() - started < 2500 }
        splash.setOnExitAnimationListener { provider ->
            try {
                provider.view.animate().alpha(0f).setDuration(260).withEndAction { provider.remove() }.start()
            } catch (_: Exception) { provider.remove() }
        }
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0)
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        web = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(0xFF0C0A0F.toInt())
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = true
            // Background music of the stories starts after the user picked it (7.2).
            settings.mediaPlaybackRequiresUserGesture = false
            addJavascriptInterface(Bridge(), "CVNative")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                    val response = loader.shouldInterceptRequest(request.url)
                    if (response != null) {
                        // The native bridge is available only to the bundled page.
                        // Remote scripts and frames must never receive bridge access.
                        response.responseHeaders = (response.responseHeaders ?: emptyMap()) + mapOf(
                            "Content-Security-Policy" to "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
                                "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
                                "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; " +
                                "media-src 'self' blob: https://www.googleapis.com; " +
                                "connect-src 'self' https://www.googleapis.com; frame-src 'none'; " +
                                "object-src 'none'; base-uri 'none'"
                        )
                    }
                    return response
                }
                override fun onPageFinished(view: WebView, url: String) {
                    pageReady = true
                }
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val url = request.url
                    if (url.scheme == "https" && url.host == "appassets.androidplatform.net" &&
                        (url.port == -1 || url.port == 443)) return false
                    if (!request.isForMainFrame || url.scheme !in listOf("https", "http")) return true
                    // Link esterni (es. «Open su Drive»): nell'app Drive o nel browser.
                    try { startActivity(Intent(Intent.ACTION_VIEW, url)) } catch (_: Exception) { }
                    return true
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = callback
                    openChooser(params.isCaptureEnabled, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE,
                        params.acceptTypes?.toList() ?: emptyList())
                    return true
                }
            }
        }
        setContentView(web)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })
        collectShared(intent)
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(START)
    }

    override fun onResume() {
        super.onResume()
        main.removeCallbacks(syncEvery40Seconds)
        // On return from Home, another app or the cropper, check Drive now.
        // The initial launch already loads the index in start().
        if (jsReady) js("window.__cvAutoSyncFromAndroid && window.__cvAutoSyncFromAndroid(true)")
        main.postDelayed(syncEvery40Seconds, 40_000L)
    }

    override fun onPause() {
        main.removeCallbacks(syncEvery40Seconds)
        // 7.2: stories and their background music stop when the app leaves the screen.
        if (jsReady) js("window.__cvAppPaused && window.__cvAppPaused()")
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        collectShared(intent)
        processShared()
    }

    override fun onDestroy() {
        io.shutdownNow()
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        web.destroy()
        super.onDestroy()
    }

    // ------------------------------------------------------------------ selezione file e fotocamera
    private fun openChooser(captureOnly: Boolean, multiple: Boolean, acceptTypes: List<String> = emptyList()) {
        val accept = acceptTypes.flatMap { it.split(',') }.map { it.trim().lowercase() }.filter { it.isNotEmpty() }
        val audioOnly = accept.isNotEmpty() && accept.all { it.startsWith("audio/") || it in AUDIO_EXTENSIONS }
        if (audioOnly) {   // background music for the stories: no camera, audio picker
            val pick = Intent(Intent.ACTION_GET_CONTENT).apply { type = "audio/*"; addCategory(Intent.CATEGORY_OPENABLE) }
            cameraUri = null
            try { chooser.launch(Intent.createChooser(pick, "Choose music")) } catch (e: Exception) {
                fileCallback?.onReceiveValue(null); fileCallback = null; toast("No music picker is available")
            }
            return
        }
        val camera = Intent(MediaStore.ACTION_IMAGE_CAPTURE).also {
            val dir = File(cacheDir, "camera").apply { mkdirs() }
            val file = File(dir, "foto_${System.currentTimeMillis()}.jpg")
            cameraUri = FileProvider.getUriForFile(this, "$packageName.files", file)
            it.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri)
            it.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val intent = if (captureOnly) camera else {
            val videos = accept.any { it.startsWith("video/") }
            val pick = Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
                if (videos) { type = "*/*"; putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "video/*")) } else type = "image/*"
            }
            Intent.createChooser(pick, "Add images").apply { putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(camera)) }
        }
        try { chooser.launch(intent) } catch (e: Exception) {
            fileCallback?.onReceiveValue(null); fileCallback = null
            toast("No photo picker is available")
        }
    }

    // ------------------------------------------------------------------ «Condividi» da altre app
    private fun collectShared(intent: Intent?) {
        intent ?: return
        when (intent.action) {
            Intent.ACTION_SEND -> uriExtra(intent)?.let { sharedQueue.add(it) }
            Intent.ACTION_SEND_MULTIPLE -> uriListExtra(intent)?.let { sharedQueue.addAll(it) }
        }
        intent.action = Intent.ACTION_MAIN   // non rielaborare dopo una rotazione
    }

    @Suppress("DEPRECATION")
    private fun uriExtra(intent: Intent): Uri? =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else intent.getParcelableExtra(Intent.EXTRA_STREAM)

    @Suppress("DEPRECATION")
    private fun uriListExtra(intent: Intent): ArrayList<Uri>? =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)

    private fun processShared() {
        if (sharedQueue.isEmpty() || !jsReady) return
        if (inbox.isEmpty()) {
            toast("Set the Drive source folder on the desktop (Import › Google Drive), then try sharing again.")
            sharedQueue.clear(); return
        }
        val all = ArrayList(sharedQueue)
        sharedQueue.clear()
        // I video (Character Vault 5) vanno caricati così come sono; le foto passano dal ritaglio.
        val videos = all.filter { (contentResolver.getType(it) ?: "").startsWith("video/") }
        val photos = ArrayList(all.filterNot { it in videos })
        if (videos.isNotEmpty()) uploadVideos(videos)
        if (photos.isNotEmpty()) openCropper(photos)
    }

    private fun uploadVideos(videos: List<Uri>) {
        toast("Uploading ${videos.size} videos to Character Vault…")
        GoogleAuth.authorize(this, consent, true) { token, error ->
            if (token == null) { toast("Google sign-in failed: $error"); return@authorize }
            io.execute {
                var sent = 0
                for (uri in videos) {
                    try {
                        val name = displayName(uri) ?: "video_${System.currentTimeMillis()}.mp4"
                        val length = contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
                        if (length <= 0) throw java.io.IOException("unknown video size")
                        DriveIO.retrying {
                            DriveIO.upload(token, inbox, name, contentResolver.getType(uri) ?: "video/mp4", length,
                                { contentResolver.openInputStream(uri) ?: throw java.io.IOException("video not readable") },
                                properties = mapOf("cv_origin" to "android"))
                        }
                        sent++
                    } catch (e: Exception) {
                        if (e is DriveIO.HttpError && e.code == 401) GoogleAuth.invalidate(this, token)
                        toast("Video upload failed: ${e.message}")
                    }
                }
                if (sent > 0) js("window.__cvNativeUploaded && window.__cvNativeUploaded($sent)")
            }
        }
    }

    private fun displayName(uri: Uri): String? = try {
        contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    } catch (_: Exception) { null }

    private fun openCropper(uris: ArrayList<Uri>?) {
        if (inbox.isEmpty()) { toast("The archive is still loading. Wait a few seconds."); return }
        val i = Intent(this, CropActivity::class.java).putExtra(CropActivity.EXTRA_INBOX, inbox)
        if (!uris.isNullOrEmpty()) {
            i.putParcelableArrayListExtra(CropActivity.EXTRA_URIS, uris)
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        cropper.launch(i)
    }

    // ------------------------------------------------------------------ ponte con la pagina
    private fun js(code: String) = main.post { web.evaluateJavascript(code, null) }
    private fun toast(text: String) = main.post { Toast.makeText(this, text, Toast.LENGTH_LONG).show() }
    private fun q(text: String?) = if (text == null) "null" else JSONObject.quote(text)

    inner class Bridge {
        @JavascriptInterface fun version(): String = BuildConfigCompat.versionName(this@MainActivity)

        /** Token Google per Drive; risposta asincrona in window.__cvNativeToken(token, secondi, errore). */
        @JavascriptInterface fun requestToken(interactive: Boolean) {
            main.post {
                GoogleAuth.authorize(this@MainActivity, consent, interactive) { token, error ->
                    js("window.__cvNativeToken && window.__cvNativeToken(${q(token)}, ${GoogleAuth.secondsLeft()}, ${q(error)})")
                }
            }
        }

        @JavascriptInterface fun invalidateToken(token: String?) = GoogleAuth.invalidate(this@MainActivity, token)

        @JavascriptInterface fun signOut() = GoogleAuth.signOut(this@MainActivity)

        /** La pagina comunica la cartella di origine (dove vanno le foto nuove) appena carica l'indice. */
        @JavascriptInterface fun setContext(inboxId: String?) {
            main.post {
                inbox = inboxId ?: ""
                jsReady = true
                processShared()
            }
        }

        @JavascriptInterface fun openCropper() = main.post { openCropper(null) }

        /** Riproduce un video dell'archivio trasmettendolo da Drive (player del telefono). */
        @JavascriptInterface fun playVideo(fileId: String, title: String?) {
            main.post {
                startActivity(Intent(this@MainActivity, VideoActivity::class.java)
                    .putExtra(VideoActivity.EXTRA_FILE_ID, fileId)
                    .putExtra(VideoActivity.EXTRA_TITLE, title ?: "Video"))
            }
        }

        /** 7.2: Material You colors of the phone (Android 12+), for the optional "Material You" appearance. */
        @JavascriptInterface fun theme(): String {
            if (Build.VERSION.SDK_INT < 31) return "{\"dynamic\":false}"
            return try {
                val shades = mapOf(
                    "a100" to android.R.color.system_accent1_100, "a200" to android.R.color.system_accent1_200,
                    "a300" to android.R.color.system_accent1_300, "a400" to android.R.color.system_accent1_400,
                    "a500" to android.R.color.system_accent1_500, "a600" to android.R.color.system_accent1_600,
                    "a700" to android.R.color.system_accent1_700, "a800" to android.R.color.system_accent1_800,
                    "a900" to android.R.color.system_accent1_900)
                val out = JSONObject().put("dynamic", true)
                for ((key, id) in shades) out.put(key, String.format("#%06X", 0xFFFFFF and getColor(id)))
                out.toString()
            } catch (_: Exception) { "{\"dynamic\":false}" }
        }

        /** 7.2: short vibration for gestures (no permission needed). */
        @JavascriptInterface fun haptic(kind: String?) {
            main.post {
                val effect = when (kind) {
                    "long" -> HapticFeedbackConstants.LONG_PRESS
                    "confirm" -> if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
                    else -> HapticFeedbackConstants.CLOCK_TICK
                }
                web.performHapticFeedback(effect)
            }
        }

        /** 7.2: stories and slideshow — full screen, optional landscape, screen kept on. */
        @JavascriptInterface fun immersive(on: Boolean, landscape: Boolean) {
            main.post {
                val controller = WindowInsetsControllerCompat(window, window.decorView)
                if (on) {
                    controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    controller.hide(WindowInsetsCompat.Type.systemBars())
                    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    requestedOrientation = if (landscape) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                        else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                } else {
                    controller.show(WindowInsetsCompat.Type.systemBars())
                    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                }
            }
        }

        /** 7.2: share an archive file with other apps (downloaded to the app cache, shared via FileProvider). */
        @JavascriptInterface fun shareDriveFile(fileId: String, name: String) {
            main.post {
                GoogleAuth.authorize(this@MainActivity, consent, true) { token, error ->
                    if (token == null) { toast("Google sign-in failed: $error"); return@authorize }
                    io.execute {
                        try {
                            val dir = File(cacheDir, "share").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
                            val safe = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifBlank { "image.jpg" }
                            val target = File(dir, safe)
                            val mime = DriveIO.downloadToFile(token, fileId, target).ifBlank { DriveIO.mimeFor(safe) }
                            val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.files", target)
                            val send = Intent(Intent.ACTION_SEND).apply {
                                type = mime; putExtra(Intent.EXTRA_STREAM, uri); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                            }
                            main.post { startActivity(Intent.createChooser(send, "Share")) }
                            js("window.__cvNativeShared && window.__cvNativeShared(${q(fileId)}, true)")
                        } catch (e: Exception) {
                            if (e is DriveIO.HttpError && e.code == 401) GoogleAuth.invalidate(this@MainActivity, token)
                            toast("Sharing failed: ${e.message}")
                            js("window.__cvNativeShared && window.__cvNativeShared(${q(fileId)}, false)")
                        }
                    }
                }
            }
        }

        /** «Scarica originale»: direttamente nella Galleria del telefono. */
        @JavascriptInterface fun saveDriveFile(fileId: String, name: String) {
            main.post {
                GoogleAuth.authorize(this@MainActivity, consent, true) { token, error ->
                    if (token == null) { toast("Google sign-in failed: $error"); return@authorize }
                    io.execute {
                        try {
                            DriveIO.downloadToGallery(this@MainActivity, token, fileId, name)
                            toast("Saved to Gallery › CharacterVault")
                            js("window.__cvNativeSaved && window.__cvNativeSaved(${q(fileId)}, true)")
                        } catch (e: Exception) {
                            if (e is DriveIO.HttpError && e.code == 401) GoogleAuth.invalidate(this@MainActivity, token)
                            toast("Download failed: ${e.message}")
                            js("window.__cvNativeSaved && window.__cvNativeSaved(${q(fileId)}, false)")
                        }
                    }
                }
            }
        }
    }
}

/** Versione dell'app senza dipendere da BuildConfig (disattivato di serie da AGP 8). */
object BuildConfigCompat {
    fun versionName(activity: ComponentActivity): String = try {
        activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: ""
    } catch (_: Exception) { "" }
}
