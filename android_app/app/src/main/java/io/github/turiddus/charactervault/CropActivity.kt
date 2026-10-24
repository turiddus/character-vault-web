package io.github.turiddus.charactervault

import android.content.ContentValues
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Ritaglio e invio alla galleria: per ogni foto propone il medium close-up (testa, spalle e busto) trovando il volto
 * sul telefono con ML Kit, offline; puoi spostare/ridimensionare il riquadro, cambiare formato o caricare la foto intera.
 * Le foto vanno nella cartella Drive di origine: il PC le importa e le cataloga come tutte le altre.
 */
class CropActivity : ComponentActivity() {
    companion object {
        const val EXTRA_INBOX = "inbox"
        const val EXTRA_URIS = "uris"
        const val EXTRA_UPLOADED = "uploaded"
        private const val MAX_SIDE = 4096
    }

    private val ui = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private val images = ArrayList<Uri>()
    private var index = 0
    private var uploaded = 0
    private var busy = false
    private var inbox = ""
    private var faceBox: Rect? = null

    private lateinit var crop: CropView
    private lateinit var status: TextView
    private lateinit var progress: ProgressBar
    private lateinit var keepCopy: CheckBox
    private val ratioButtons = ArrayList<Pair<Button, Float>>()
    private lateinit var actions: List<Button>

    private val consent = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) {
        GoogleAuth.onConsentResult(this, it.data)
    }
    private val picker = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNullOrEmpty()) { finishWithResult(); return@registerForActivityResult }
        images.clear(); images.addAll(uris); index = 0; load()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        inbox = intent.getStringExtra(EXTRA_INBOX) ?: ""
        buildUi()
        val given: ArrayList<Uri>? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(EXTRA_URIS, Uri::class.java)
        else @Suppress("DEPRECATION") intent.getParcelableArrayListExtra(EXTRA_URIS)
        if (!given.isNullOrEmpty()) { images.addAll(given); load() } else picker.launch(arrayOf("image/*"))
    }

    // ------------------------------------------------------------------ interfaccia
    private fun dp(v: Int) = (v * resources.displayMetrics.density).roundToInt()

    private fun styled(b: Button, primary: Boolean = false): Button {
        b.isAllCaps = false
        b.setTextColor(getColor(if (primary) android.R.color.white else R.color.text))
        b.textSize = 14f
        b.background = GradientDrawable().apply {
            cornerRadius = dp(12).toFloat()
            setColor(getColor(if (primary) R.color.accent else R.color.bg3))
            setStroke(dp(1), getColor(if (primary) R.color.accent else R.color.border))
        }
        b.minHeight = dp(44)
        return b
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(getColor(R.color.bg0))
            setPadding(dp(12), dp(12), dp(12), dp(12))
        }
        status = TextView(this).apply {
            setTextColor(getColor(R.color.text)); textSize = 16f; typeface = Typeface.DEFAULT_BOLD
            text = "Ritaglia e aggiungi alla galleria"
        }
        root.addView(status)
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100; visibility = View.INVISIBLE }
        root.addView(progress, LinearLayout.LayoutParams(-1, dp(6)).apply { topMargin = dp(6); bottomMargin = dp(6) })
        crop = CropView(this)
        root.addView(crop, LinearLayout.LayoutParams(-1, 0, 1f))

        val ratios = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(10), 0, dp(4)) }
        listOf("4:5" to 4f / 5f, "9:16" to 9f / 16f, "1:1" to 1f, "3:2" to 3f / 2f).forEach { (label, r) ->
            val b = styled(Button(this)).apply { text = label; setOnClickListener { selectRatio(r) } }
            ratioButtons.add(b to r)
            ratios.addView(b, LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = dp(6) })
        }
        root.addView(ratios)

        keepCopy = CheckBox(this).apply {
            text = "Salva anche una copia ritagliata nella Galleria del telefono"
            setTextColor(getColor(R.color.text2)); textSize = 13f
        }
        root.addView(keepCopy)

        val row1 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        val auto = styled(Button(this)).apply { text = "Medium close-up"; setOnClickListener { autoFrame(true) } }
        val skip = styled(Button(this)).apply { text = "Salta"; setOnClickListener { next() } }
        row1.addView(auto, LinearLayout.LayoutParams(0, -2, 1.4f).apply { marginEnd = dp(6) })
        row1.addView(skip, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(row1, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })

        val row2 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val whole = styled(Button(this)).apply { text = "Carica intera"; setOnClickListener { send(false) } }
        val cropped = styled(Button(this), primary = true).apply { text = "Ritaglia e carica"; setOnClickListener { send(true) } }
        row2.addView(whole, LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = dp(6) })
        row2.addView(cropped, LinearLayout.LayoutParams(0, -2, 1.4f))
        root.addView(row2, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })
        actions = listOf(auto, skip, whole, cropped)
        setContentView(root)
        highlightRatio(crop.ratio)
    }

    private fun highlightRatio(r: Float) {
        for ((b, value) in ratioButtons) {
            (b.background as GradientDrawable).setColor(getColor(if (value == r) R.color.accent else R.color.bg3))
            b.setTextColor(getColor(if (value == r) android.R.color.white else R.color.text))
        }
    }

    private fun selectRatio(r: Float) {
        highlightRatio(r)
        crop.setRatio(r)
        if (faceBox != null) autoFrame(false)
    }

    private fun setBusy(value: Boolean) {
        busy = value
        actions.forEach { it.isEnabled = !value; it.alpha = if (value) 0.5f else 1f }
        progress.visibility = if (value) View.VISIBLE else View.INVISIBLE
    }

    // ------------------------------------------------------------------ immagini
    private fun displayName(uri: Uri): String {
        try {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0)?.let { if (it.isNotBlank()) return it }
            }
        } catch (_: Exception) { }
        return "foto_${System.currentTimeMillis()}.jpg"
    }

    private fun load() {
        if (index >= images.size) { finishWithResult(); return }
        status.text = "Foto ${index + 1} di ${images.size} · ricerca del volto…"
        faceBox = null
        setBusy(true)
        val uri = images[index]
        io.execute {
            try {
                // ImageDecoder applica da solo la rotazione EXIF; le foto enormi vengono ridotte per la memoria.
                val bmp = ImageDecoder.decodeBitmap(ImageDecoder.createSource(contentResolver, uri)) { decoder, info, _ ->
                    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                    val long = max(info.size.width, info.size.height)
                    if (long > MAX_SIDE) {
                        val f = MAX_SIDE.toFloat() / long
                        decoder.setTargetSize((info.size.width * f).roundToInt(), (info.size.height * f).roundToInt())
                    }
                }
                ui.post {
                    crop.setImage(bmp)
                    setBusy(false)
                    detectFace(bmp)
                }
            } catch (e: Exception) {
                ui.post { setBusy(false); status.text = "Foto non leggibile (${e.message}): passo alla successiva"; next() }
            }
        }
    }

    private fun detectFace(bmp: Bitmap) {
        val detector = FaceDetection.getClient(FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
            .setMinFaceSize(0.05f).build())
        detector.process(InputImage.fromBitmap(bmp, 0))
            .addOnSuccessListener { faces ->
                faceBox = faces.maxByOrNull { it.boundingBox.width() * it.boundingBox.height() }?.boundingBox
                autoFrame(false)
            }
            .addOnFailureListener { autoFrame(false) }
            .addOnCompleteListener { detector.close() }
    }

    /**
     * Medium close-up come nella galleria del PC: testa, spalle e busto, con il volto nel terzo superiore.
     * Senza volto: riquadro centrato in alto.
     */
    private fun autoFrame(fromButton: Boolean) {
        val bmp = crop.bitmap ?: return
        val f = faceBox
        val label = "Foto ${index + 1} di ${images.size}"
        if (f == null) {
            crop.centered()
            status.text = "$label · nessun volto trovato: sposta il riquadro a mano"
            return
        }
        val r = crop.ratio
        val fh = f.height().toFloat()
        val factor = when { r < 0.7f -> 4.6f; r < 0.9f -> 3.5f; r < 1.2f -> 3.0f; else -> 2.6f }
        val height = (fh * factor).coerceAtMost(bmp.height.toFloat())
        val top = f.top - fh * 0.62f
        crop.setBox(f.exactCenterX(), top + height / 2f, height)
        status.text = if (fromButton) "$label · medium close-up" else "$label · volto trovato: medium close-up proposto"
    }

    private fun next() {
        index++
        load()
    }

    // ------------------------------------------------------------------ invio
    private fun send(cropped: Boolean) {
        if (busy) return
        if (inbox.isEmpty()) { status.text = "Cartella Drive di origine non configurata sul PC"; return }
        val uri = images.getOrNull(index) ?: return
        val bmp = crop.bitmap
        val r = crop.rect
        if (cropped && (bmp == null || r == null)) return
        setBusy(true)
        status.text = "Foto ${index + 1} di ${images.size} · invio a Drive…"
        GoogleAuth.authorize(this, consent, true) { token, error ->
            if (token == null) { setBusy(false); status.text = "Accesso a Google non riuscito: $error"; return@authorize }
            val original = displayName(uri)
            val saveCopy = keepCopy.isChecked
            io.execute {
                try {
                    if (cropped) {
                        val x = r!!.left.roundToInt().coerceIn(0, bmp!!.width - 1)
                        val y = r.top.roundToInt().coerceIn(0, bmp.height - 1)
                        val w = r.width().roundToInt().coerceIn(1, bmp.width - x)
                        val h = r.height().roundToInt().coerceIn(1, bmp.height - y)
                        val out = Bitmap.createBitmap(bmp, x, y, w, h)
                        val bytes = ByteArrayOutputStream().use { s -> out.compress(Bitmap.CompressFormat.JPEG, 95, s); s.toByteArray() }
                        val name = original.substringBeforeLast('.') + "_ritaglio.jpg"
                        DriveIO.upload(token, inbox, name, "image/jpeg", bytes.size.toLong(), { bytes.inputStream() }) { p -> ui.post { progress.progress = (p * 100).roundToInt() } }
                        if (saveCopy) saveToGallery(name, bytes)
                    } else {
                        val length = contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
                        val bytes: ByteArray? = if (length <= 0) contentResolver.openInputStream(uri)!!.use { it.readBytes() } else null
                        val size = bytes?.size?.toLong() ?: length
                        DriveIO.upload(token, inbox, original, contentResolver.getType(uri) ?: DriveIO.mimeFor(original), size,
                            { bytes?.inputStream() ?: contentResolver.openInputStream(uri)!! }) { p -> ui.post { progress.progress = (p * 100).roundToInt() } }
                    }
                    ui.post { uploaded++; setBusy(false); next() }
                } catch (e: Exception) {
                    if (e is DriveIO.HttpError && e.code == 401) GoogleAuth.invalidate(this, token)
                    ui.post { setBusy(false); status.text = "Invio non riuscito: ${e.message}. Riprova." }
                }
            }
        }
    }

    private fun saveToGallery(name: String, bytes: ByteArray) {
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, name)
            put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
            put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/CharacterVault")
        }
        contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)?.let { uri ->
            contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
        }
    }

    private fun finishWithResult() {
        setResult(RESULT_OK, Intent().putExtra(EXTRA_UPLOADED, uploaded))
        finish()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() = finishWithResult()
}
