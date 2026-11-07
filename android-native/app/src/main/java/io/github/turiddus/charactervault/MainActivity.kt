package io.github.turiddus.charactervault

import android.app.Activity
import android.os.Bundle
import android.content.Intent
import android.graphics.*
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.content.ContentValues
import android.view.*
import android.widget.*
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.objects.ObjectDetection
import com.google.mlkit.vision.objects.defaults.ObjectDetectorOptions
import java.util.concurrent.Executors
import kotlin.math.*

class MainActivity : Activity() {
    private val pickCode = 101
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var imageView: CropView
    private lateinit var status: TextView
    private val selected = mutableListOf<Uri>()
    private var index = 0
    private var aspect = 9f / 16f
    private var lastSaved: Uri? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(14, 18, 14, 12)
            setBackgroundColor(Color.rgb(17, 14, 22))
        }
        fun button(label: String, click: () -> Unit): Button =
            Button(this).apply { text = label; setOnClickListener { click() } }
        status = TextView(this).apply { text = "Character Vault Native • Importa immagini"; setTextColor(Color.WHITE); textSize = 15f }
        imageView = CropView(this)
        root.addView(status)
        root.addView(imageView, LinearLayout.LayoutParams(-1, 0, 1f))
        val formats = LinearLayout(this)
        listOf("9:16" to (9f/16f), "4:5" to (4f/5f), "1:1" to 1f).forEach { (label, ratio) ->
            formats.addView(button(label) { aspect = ratio; imageView.resetCrop(aspect) },
                LinearLayout.LayoutParams(0, -2, 1f))
        }
        root.addView(formats)
        root.addView(button("Importa immagini") {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                type = "image/*"; addCategory(Intent.CATEGORY_OPENABLE)
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }
            startActivityForResult(intent, pickCode)
        })
        root.addView(button("Crop automatico offline") { autoCrop() })
        root.addView(button("Salva ritaglio e prossima immagine") { saveCurrent() })
        root.addView(button("Condividi ultimo file (Drive / altre app)") {
            lastSaved?.let { uri ->
                startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                    type = "image/jpeg"; putExtra(Intent.EXTRA_STREAM, uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }, "Condividi immagine"))
            } ?: message("Salva prima un ritaglio")
        })
        setContentView(root)
    }
    private fun message(s: String) { status.text = s }
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != pickCode || resultCode != RESULT_OK || data == null) return
        selected.clear()
        data.clipData?.let { clip -> for (i in 0 until clip.itemCount) selected.add(clip.getItemAt(i).uri) }
        if (selected.isEmpty()) data.data?.let { selected.add(it) }
        index = 0; loadCurrent()
    }
    private fun loadCurrent() {
        if (index >= selected.size) { message("Batch completato"); return }
        val uri = selected[index]
        message("Caricamento ${index+1}/${selected.size}")
        executor.execute {
            try {
                val bitmap = contentResolver.openInputStream(uri).use { stream ->
                    requireNotNull(stream)
                    BitmapFactory.decodeStream(stream) ?: error("Immagine non decodificabile")
                }
                runOnUiThread { imageView.setBitmap(bitmap, aspect); message("Immagine ${index+1}/${selected.size} • trascina per correggere il crop") }
            } catch (e: Exception) { runOnUiThread { message("Errore: ${e.message}") } }
        }
    }
    private fun autoCrop() {
        val bitmap = imageView.bitmap ?: return
        message("Analisi locale del soggetto…")
        val input = InputImage.fromBitmap(bitmap, 0)
        val options = ObjectDetectorOptions.Builder().setDetectorMode(ObjectDetectorOptions.SINGLE_IMAGE_MODE).enableMultipleObjects().build()
        val detector = ObjectDetection.getClient(options)
        detector.process(input).addOnSuccessListener { objects ->
            detector.close()
            val box = objects.maxByOrNull { it.boundingBox.width() * it.boundingBox.height() }?.boundingBox
            if (box != null) {
                imageView.centerOn(box.exactCenterX(), box.exactCenterY(), aspect)
                message("Crop automatico: oggetto rilevato")
            } else detectFace(input)
        }.addOnFailureListener { detector.close(); detectFace(input) }
    }
    private fun detectFace(input: InputImage) {
        val detector = FaceDetection.getClient(FaceDetectorOptions.Builder().setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST).build())
        detector.process(input).addOnSuccessListener { faces ->
            detector.close()
            val face = faces.maxByOrNull { it.boundingBox.width() * it.boundingBox.height() }
            if (face != null) {
                imageView.centerOn(face.boundingBox.exactCenterX(), face.boundingBox.exactCenterY(), aspect)
                message("Crop assistito: volto rilevato")
            } else { imageView.resetCrop(aspect); message("Nessun soggetto rilevato: crop centrato") }
        }.addOnFailureListener { detector.close(); imageView.resetCrop(aspect); message("Crop centrato (analisi non disponibile)") }
    }
    private fun saveCurrent() {
        val source = imageView.bitmap ?: return
        val rect = imageView.cropRect ?: return
        val x = rect.left.roundToInt().coerceIn(0, source.width-1)
        val y = rect.top.roundToInt().coerceIn(0, source.height-1)
        val w = rect.width().roundToInt().coerceIn(1, source.width-x)
        val h = rect.height().roundToInt().coerceIn(1, source.height-y)
        val number = index
        message("Salvataggio…")
        executor.execute {
            try {
                val cropped = Bitmap.createBitmap(source, x, y, w, h)
                val values = ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, "CV_${System.currentTimeMillis()}_${number}.jpg")
                    put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                    put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/CharacterVault")
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
                val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: error("Creazione file fallita")
                try {
                    contentResolver.openOutputStream(uri).use { out ->
                        requireNotNull(out); check(cropped.compress(Bitmap.CompressFormat.JPEG, 95, out))
                    }
                    values.clear(); values.put(MediaStore.Images.Media.IS_PENDING, 0)
                    contentResolver.update(uri, values, null, null)
                } catch (e: Exception) { contentResolver.delete(uri, null, null); throw e }
                cropped.recycle()
                runOnUiThread { lastSaved = uri; index++; loadCurrent() }
            } catch (e: Exception) { runOnUiThread { message("Errore salvataggio: ${e.message}") } }
        }
    }
    override fun onDestroy() { executor.shutdown(); super.onDestroy() }
}

class CropView(context: android.content.Context) : View(context) {
    var bitmap: Bitmap? = null
        private set
    var cropRect: RectF? = null
        private set
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var scale = 1f
    private var ox = 0f
    private var oy = 0f
    private var downX = 0f
    private var downY = 0f
    private var pinchDistance = 0f
    fun setBitmap(b: Bitmap, aspect: Float) { bitmap = b; resetCrop(aspect) }
    fun resetCrop(aspect: Float) {
        val b = bitmap ?: return
        val w = b.width * .9f
        val h = b.height * .9f
        val cw = min(w, h * aspect)
        val ch = cw / aspect
        cropRect = RectF((b.width-cw)/2, (b.height-ch)/2, (b.width+cw)/2, (b.height+ch)/2)
        invalidate()
    }
    fun centerOn(x: Float, y: Float, aspect: Float) {
        val b = bitmap ?: return
        val existing = cropRect ?: return
        val w = existing.width(); val h = w/aspect
        val left = (x-w/2).coerceIn(0f, max(0f,b.width-w))
        val top = (y-h/2).coerceIn(0f, max(0f,b.height-h))
        cropRect = RectF(left,top,left+w,top+h); invalidate()
    }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawColor(Color.rgb(22,19,28))
        val b = bitmap ?: return
        scale = min(width.toFloat()/b.width, height.toFloat()/b.height)
        ox = (width-b.width*scale)/2; oy = (height-b.height*scale)/2
        canvas.drawBitmap(b,null,RectF(ox,oy,ox+b.width*scale,oy+b.height*scale),paint)
        cropRect?.let { r ->
            val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color=Color.WHITE; style=Paint.Style.STROKE; strokeWidth=3f }
            canvas.drawRect(ox+r.left*scale,oy+r.top*scale,ox+r.right*scale,oy+r.bottom*scale,p)
        }
    }
    override fun onTouchEvent(event: MotionEvent): Boolean {
        val b = bitmap ?: return false
        val r = cropRect ?: return false
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> { downX=event.x; downY=event.y; return true }
            MotionEvent.ACTION_POINTER_DOWN -> {
                if(event.pointerCount>=2) pinchDistance=hypot(event.getX(1)-event.getX(0),event.getY(1)-event.getY(0))
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if(event.pointerCount>=2 && pinchDistance>0f) {
                    val dist=hypot(event.getX(1)-event.getX(0),event.getY(1)-event.getY(0))
                    val ratio=(dist/pinchDistance).coerceIn(.75f,1.25f)
                    val cx=r.centerX(); val cy=r.centerY()
                    val nw=(r.width()*ratio).coerceIn(24f,b.width.toFloat())
                    val nh=nw*r.height()/r.width()
                    if(nh<=b.height) {
                        val l=(cx-nw/2).coerceIn(0f,b.width-nw)
                        val t=(cy-nh/2).coerceIn(0f,b.height-nh)
                        cropRect=RectF(l,t,l+nw,t+nh)
                    }
                    pinchDistance=dist
                } else {
                    val dx=(event.x-downX)/scale; val dy=(event.y-downY)/scale
                    val l=(r.left+dx).coerceIn(0f,b.width-r.width())
                    val t=(r.top+dy).coerceIn(0f,b.height-r.height())
                    cropRect=RectF(l,t,l+r.width(),t+r.height())
                    downX=event.x; downY=event.y
                }
                invalidate(); return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> { pinchDistance=0f; return true }
        }
        return true
    }
}
