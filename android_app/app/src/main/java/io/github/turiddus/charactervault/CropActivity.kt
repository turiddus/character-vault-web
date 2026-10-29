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
import androidx.activity.result.contract.ActivityResultContracts
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Upload to the gallery with a cover crop (7.1).
 *
 * The FULL ORIGINAL file is always uploaded to the Drive inbox, byte for byte (formats the desktop cannot read,
 * such as HEIC, are converted to a full-resolution JPEG). The frame chosen here, proposed as a medium close-up
 * with on-device ML Kit face detection, travels with the file as the Drive property `cv_crop`
 * ("left,top,right,bottom", normalised to the EXIF-oriented image). The desktop imports the original and uses
 * the frame only as the gallery cover, exactly like a crop chosen on the desktop.
 */
class CropActivity : EnglishActivity() {
    companion object {
        const val EXTRA_INBOX = "inbox"
        const val EXTRA_URIS = "uris"
        const val EXTRA_UPLOADED = "uploaded"
        private const val MAX_SIDE = 4096          // preview bitmap for framing only, never uploaded
        private const val MAX_CONVERT_SIDE = 6144  // HEIC/DNG/AVIF converted to JPEG for the desktop
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
            text = "Upload to the gallery"
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

        val hint = TextView(this).apply {
            text = "The full original is uploaded. The frame is only the gallery cover."
            setTextColor(getColor(R.color.text2)); textSize = 12f
        }
        root.addView(hint)
        keepCopy = CheckBox(this).apply {
            text = "Also save a cropped copy to your phone gallery"
            setTextColor(getColor(R.color.text2)); textSize = 13f
        }
        root.addView(keepCopy)

        val row1 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        val auto = styled(Button(this)).apply { text = "Medium close-up"; setOnClickListener { autoFrame(true) } }
        val skip = styled(Button(this)).apply { text = "Skip"; setOnClickListener { next() } }
        row1.addView(auto, LinearLayout.LayoutParams(0, -2, 1.4f).apply { marginEnd = dp(6) })
        row1.addView(skip, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(row1, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })

        val row2 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val whole = styled(Button(this)).apply { text = "Upload, automatic cover"; setOnClickListener { send(false) } }
        val cropped = styled(Button(this), primary = true).apply { text = "Upload with this cover"; setOnClickListener { send(true) } }
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

    // ------------------------------------------------------------------ images
    private fun displayName(uri: Uri): String {
        try {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0)?.let { if (it.isNotBlank()) return it }
            }
        } catch (_: Exception) { }
        return "photo_${System.currentTimeMillis()}.jpg"
    }

    private fun load() {
        if (index >= images.size) { finishWithResult(); return }
        status.text = "Photo ${index + 1} of ${images.size} · detecting faces…"
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
                ui.post { setBusy(false); status.text = "Unreadable photo (${e.message}): moving to the next one"; next() }
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
        val label = "Photo ${index + 1} of ${images.size}"
        if (f == null) {
            crop.centered()
            status.text = "$label · no face found: adjust the frame manually"
            return
        }
        val r = crop.ratio
        val fh = f.height().toFloat()
        val factor = when { r < 0.7f -> 4.6f; r < 0.9f -> 3.5f; r < 1.2f -> 3.0f; else -> 2.6f }
        val height = (fh * factor).coerceAtMost(bmp.height.toFloat())
        val top = f.top - fh * 0.62f
        crop.setBox(f.exactCenterX(), top + height / 2f, height)
        status.text = if (fromButton) "$label · medium close-up" else "$label · face found: medium close-up suggested"
    }

    private fun next() {
        index++
        load()
    }

    // ------------------------------------------------------------------ invio
    /** Payload actually uploaded: the untouched original, or a full-resolution JPEG for formats the desktop lacks. */
    private class Payload(val name: String, val mime: String, val length: Long, val open: () -> java.io.InputStream)

    private fun payload(uri: Uri): Payload {
        val name = displayName(uri)
        val mime = contentResolver.getType(uri) ?: DriveIO.mimeFor(name)
        if (DriveIO.desktopReadsAsIs(name, mime)) {
            val length = try { contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L } catch (_: Exception) { -1L }
            if (length > 0) return Payload(name, mime, length) { contentResolver.openInputStream(uri) ?: throw java.io.IOException("photo not readable") }
            val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: throw java.io.IOException("photo not readable")
            return Payload(name, mime, bytes.size.toLong()) { bytes.inputStream() }
        }
        // HEIC/HEIF, DNG, AVIF...: full-resolution JPEG (orientation applied), so the desktop can import it.
        val full = ImageDecoder.decodeBitmap(ImageDecoder.createSource(contentResolver, uri)) { decoder, info, _ ->
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            val long = max(info.size.width, info.size.height)
            if (long > MAX_CONVERT_SIDE) {
                val f = MAX_CONVERT_SIDE.toFloat() / long
                decoder.setTargetSize((info.size.width * f).roundToInt(), (info.size.height * f).roundToInt())
            }
        }
        val bytes = ByteArrayOutputStream().use { s -> full.compress(Bitmap.CompressFormat.JPEG, 95, s); s.toByteArray() }
        full.recycle()
        return Payload(name.substringBeforeLast('.') + ".jpg", "image/jpeg", bytes.size.toLong()) { bytes.inputStream() }
    }

    private var renewedSession = false

    private fun send(withCover: Boolean) {
        if (busy) return
        if (inbox.isEmpty()) { status.text = "The desktop Drive source folder is not configured"; return }
        val uri = images.getOrNull(index) ?: return
        val bmp = crop.bitmap
        val r = crop.rect
        if (withCover && (bmp == null || r == null)) return
        // Frame normalised to the oriented image: identical on the full-resolution original.
        val cover: String? = if (withCover && bmp != null && r != null) {
            val w = bmp.width.toFloat(); val h = bmp.height.toFloat()
            listOf(r.left / w, r.top / h, r.right / w, r.bottom / h)
                .joinToString(",") { String.format(java.util.Locale.US, "%.5f", it.coerceIn(0f, 1f)) }
        } else null
        val croppedCopy: ByteArray? = if (withCover && keepCopy.isChecked && bmp != null && r != null) {
            val x = r.left.roundToInt().coerceIn(0, bmp.width - 1)
            val y = r.top.roundToInt().coerceIn(0, bmp.height - 1)
            val cw = r.width().roundToInt().coerceIn(1, bmp.width - x)
            val ch = r.height().roundToInt().coerceIn(1, bmp.height - y)
            val out = Bitmap.createBitmap(bmp, x, y, cw, ch)
            ByteArrayOutputStream().use { s -> out.compress(Bitmap.CompressFormat.JPEG, 92, s); s.toByteArray() }
        } else null
        setBusy(true)
        status.text = "Photo ${index + 1} of ${images.size} · uploading the original to Drive…"
        GoogleAuth.authorize(this, consent, true) { token, error ->
            if (token == null) { setBusy(false); status.text = "Google sign-in failed: $error"; return@authorize }
            io.execute {
                try {
                    val file = payload(uri)
                    val properties = LinkedHashMap<String, String>()
                    properties["cv_origin"] = "android"
                    if (cover != null) { properties["cv_crop"] = cover; properties["cv_crop_v"] = "1" }
                    DriveIO.retrying {
                        DriveIO.upload(token, inbox, file.name, file.mime, file.length, file.open,
                            { p -> ui.post { progress.progress = (p * 100).roundToInt() } }, properties)
                    }
                    if (croppedCopy != null) {
                        try { saveToGallery(file.name.substringBeforeLast('.') + "_cover.jpg", croppedCopy) } catch (_: Exception) { }
                    }
                    ui.post { uploaded++; renewedSession = false; setBusy(false); next() }
                } catch (e: Exception) {
                    if (e is DriveIO.HttpError && e.code == 401 && !renewedSession) {
                        // Expired session: renew silently once and send the same photo again.
                        GoogleAuth.invalidate(this, token)
                        ui.post { renewedSession = true; setBusy(false); send(withCover) }
                        return@execute
                    }
                    if (e is DriveIO.HttpError && e.code == 401) GoogleAuth.invalidate(this, token)
                    ui.post { renewedSession = false; setBusy(false); status.text = "Upload failed: ${e.message}. Nothing was lost: try again." }
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
