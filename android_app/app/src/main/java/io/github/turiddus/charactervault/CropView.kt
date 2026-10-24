package io.github.turiddus.charactervault

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * Riquadro di ritaglio con proporzione fissa: trascina per spostarlo, pizzica per ingrandirlo o ridurlo.
 * Le coordinate di [rect] sono in pixel dell'immagine (non dello schermo).
 */
class CropView(context: Context) : View(context) {
    var bitmap: Bitmap? = null
        private set
    var rect: RectF? = null
        private set
    var ratio = 4f / 5f
        private set

    private var scale = 1f
    private var offX = 0f
    private var offY = 0f
    private var lastX = 0f
    private var lastY = 0f
    private var pinch = 0f
    private val imagePaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
    private val shade = Paint().apply { color = Color.argb(150, 0, 0, 0) }
    private val frame = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; style = Paint.Style.STROKE; strokeWidth = 3f }
    private val guide = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(90, 255, 255, 255); strokeWidth = 1.5f }
    private val corner = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(196, 54, 79); strokeWidth = 8f; strokeCap = Paint.Cap.ROUND }

    fun setImage(b: Bitmap) { bitmap = b; centered() }

    fun setRatio(r: Float) {
        ratio = r
        val old = rect
        if (old == null) { centered(); return }
        // Mantiene il centro e l'altezza (per quanto possibile) cambiando proporzione.
        val b = bitmap ?: return
        var h = old.height()
        var w = h * r
        if (w > b.width) { w = b.width.toFloat(); h = w / r }
        if (h > b.height) { h = b.height.toFloat(); w = h * r }
        place(old.centerX(), old.centerY(), w, h)
    }

    /** Riquadro centrato (leggermente in alto, dove di solito c'è il soggetto). */
    fun centered() {
        val b = bitmap ?: return
        var w = b.width * 0.9f
        var h = w / ratio
        if (h > b.height * 0.9f) { h = b.height * 0.9f; w = h * ratio }
        place(b.width / 2f, b.height * 0.42f, w, h)
    }

    /** Imposta un riquadro (in pixel dell'immagine) adattandolo ai bordi e alla proporzione. */
    fun setBox(cx: Float, cy: Float, height: Float) {
        val b = bitmap ?: return
        var h = height
        var w = h * ratio
        if (w > b.width) { w = b.width.toFloat(); h = w / ratio }
        if (h > b.height) { h = b.height.toFloat(); w = h * ratio }
        place(cx, cy, w, h)
    }

    private fun place(cx: Float, cy: Float, w: Float, h: Float) {
        val b = bitmap ?: return
        val l = (cx - w / 2).coerceIn(0f, max(0f, b.width - w))
        val t = (cy - h / 2).coerceIn(0f, max(0f, b.height - h))
        rect = RectF(l, t, l + w, t + h)
        invalidate()
    }

    override fun onDraw(c: Canvas) {
        super.onDraw(c)
        c.drawColor(Color.rgb(12, 10, 15))
        val b = bitmap ?: return
        scale = min(width.toFloat() / b.width, height.toFloat() / b.height)
        offX = (width - b.width * scale) / 2
        offY = (height - b.height * scale) / 2
        val img = RectF(offX, offY, offX + b.width * scale, offY + b.height * scale)
        c.drawBitmap(b, null, img, imagePaint)
        val r = rect ?: return
        val s = RectF(offX + r.left * scale, offY + r.top * scale, offX + r.right * scale, offY + r.bottom * scale)
        val outside = Path().apply {
            fillType = Path.FillType.EVEN_ODD
            addRect(img, Path.Direction.CW)
            addRect(s, Path.Direction.CW)
        }
        c.drawPath(outside, shade)
        for (i in 1..2) {
            val x = s.left + s.width() * i / 3f
            val y = s.top + s.height() * i / 3f
            c.drawLine(x, s.top, x, s.bottom, guide)
            c.drawLine(s.left, y, s.right, y, guide)
        }
        c.drawRect(s, frame)
        val k = min(s.width(), s.height()) * 0.12f
        for ((x, y, dx, dy) in listOf(
            arrayOf(s.left, s.top, 1f, 1f), arrayOf(s.right, s.top, -1f, 1f),
            arrayOf(s.left, s.bottom, 1f, -1f), arrayOf(s.right, s.bottom, -1f, -1f))) {
            c.drawLine(x, y, x + k * dx, y, corner)
            c.drawLine(x, y, x, y + k * dy, corner)
        }
    }

    override fun onTouchEvent(e: MotionEvent): Boolean {
        val b = bitmap ?: return false
        val r = rect ?: return false
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> { lastX = e.x; lastY = e.y; parent?.requestDisallowInterceptTouchEvent(true) }
            MotionEvent.ACTION_POINTER_DOWN -> if (e.pointerCount > 1) pinch = hypot(e.getX(1) - e.getX(0), e.getY(1) - e.getY(0))
            MotionEvent.ACTION_MOVE -> {
                if (e.pointerCount > 1 && pinch > 0f) {
                    val d = hypot(e.getX(1) - e.getX(0), e.getY(1) - e.getY(0))
                    val f = (pinch / d).coerceIn(0.8f, 1.25f)      // dita che si allontanano = riquadro più stretto (zoom)
                    var h = (r.height() * f).coerceIn(48f, b.height.toFloat())
                    var w = h * ratio
                    if (w > b.width) { w = b.width.toFloat(); h = w / ratio }
                    place(r.centerX(), r.centerY(), w, h)
                    pinch = d
                } else if (e.pointerCount == 1) {
                    val dx = (e.x - lastX) / scale
                    val dy = (e.y - lastY) / scale
                    place(r.centerX() + dx, r.centerY() + dy, r.width(), r.height())
                    lastX = e.x; lastY = e.y
                }
            }
            MotionEvent.ACTION_POINTER_UP -> {
                pinch = 0f
                val keep = if (e.actionIndex == 0) 1 else 0
                lastX = e.getX(keep); lastY = e.getY(keep)
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> pinch = 0f
        }
        return true
    }
}
