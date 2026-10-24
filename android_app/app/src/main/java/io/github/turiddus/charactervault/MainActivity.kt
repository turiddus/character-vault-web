package io.github.turiddus.charactervault

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.view.ViewGroup
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
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/**
 * Character Vault per Android: la stessa interfaccia della web app (galleria sincronizzata con l'archivio su
 * Google Drive) con le parti native che il browser non offre: accesso Google con l'account del telefono, download
 * nella Galleria, «Condividi» da altre app, fotocamera e ritaglio in medium close-up con rilevamento dei volti.
 */
class MainActivity : ComponentActivity() {
    companion object {
        private const val ORIGIN = "https://appassets.androidplatform.net"
        private const val START = "$ORIGIN/assets/index.html"
    }

    private lateinit var web: WebView
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newFixedThreadPool(2)
    private var inbox = ""
    private var jsReady = false
    private val sharedQueue = ArrayList<Uri>()
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraUri: Uri? = null

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
            settings.mediaPlaybackRequiresUserGesture = true
            addJavascriptInterface(Bridge(), "CVNative")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    loader.shouldInterceptRequest(request.url)
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val url = request.url
                    if (url.toString().startsWith(ORIGIN)) return false
                    // Link esterni (es. «Apri su Drive»): nell'app Drive o nel browser.
                    try { startActivity(Intent(Intent.ACTION_VIEW, url)) } catch (_: Exception) { }
                    return true
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = callback
                    openChooser(params.isCaptureEnabled, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
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
        web.destroy()
        super.onDestroy()
    }

    // ------------------------------------------------------------------ selezione file e fotocamera
    private fun openChooser(captureOnly: Boolean, multiple: Boolean) {
        val camera = Intent(MediaStore.ACTION_IMAGE_CAPTURE).also {
            val dir = File(cacheDir, "camera").apply { mkdirs() }
            val file = File(dir, "foto_${System.currentTimeMillis()}.jpg")
            cameraUri = FileProvider.getUriForFile(this, "$packageName.files", file)
            it.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri)
            it.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val intent = if (captureOnly) camera else {
            val pick = Intent(Intent.ACTION_GET_CONTENT).apply {
                type = "image/*"; addCategory(Intent.CATEGORY_OPENABLE)
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
            }
            Intent.createChooser(pick, "Aggiungi immagini").apply { putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(camera)) }
        }
        try { chooser.launch(intent) } catch (e: Exception) {
            fileCallback?.onReceiveValue(null); fileCallback = null
            toast("Nessuna app per scegliere le immagini")
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
            toast("Sul PC imposta la cartella Drive di origine (Importa › Google Drive), poi riprova a condividere.")
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
        toast("Invio di ${videos.size} video a Character Vault…")
        GoogleAuth.authorize(this, consent, true) { token, error ->
            if (token == null) { toast("Accesso a Google non riuscito: $error"); return@authorize }
            io.execute {
                var sent = 0
                for (uri in videos) {
                    try {
                        val name = displayName(uri) ?: "video_${System.currentTimeMillis()}.mp4"
                        val length = contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
                        if (length <= 0) throw java.io.IOException("dimensione del video sconosciuta")
                        DriveIO.upload(token, inbox, name, contentResolver.getType(uri) ?: "video/mp4", length,
                            { contentResolver.openInputStream(uri)!! })
                        sent++
                    } catch (e: Exception) {
                        if (e is DriveIO.HttpError && e.code == 401) GoogleAuth.invalidate(this, token)
                        toast("Video non inviato: ${e.message}")
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
        if (inbox.isEmpty()) { toast("Archivio non ancora caricato: attendi qualche secondo."); return }
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

        /** «Scarica originale»: direttamente nella Galleria del telefono. */
        @JavascriptInterface fun saveDriveFile(fileId: String, name: String) {
            main.post {
                GoogleAuth.authorize(this@MainActivity, consent, true) { token, error ->
                    if (token == null) { toast("Accesso a Google non riuscito: $error"); return@authorize }
                    io.execute {
                        try {
                            DriveIO.downloadToGallery(this@MainActivity, token, fileId, name)
                            toast("Salvata in Galleria › CharacterVault")
                            js("window.__cvNativeSaved && window.__cvNativeSaved(${q(fileId)}, true)")
                        } catch (e: Exception) {
                            if (e is DriveIO.HttpError && e.code == 401) GoogleAuth.invalidate(this@MainActivity, token)
                            toast("Download non riuscito: ${e.message}")
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
