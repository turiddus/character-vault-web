package io.github.turiddus.charactervault

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.os.Build
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/** Trasferimenti diretti con Google Drive (REST v3), senza librerie esterne. */
object DriveIO {
    private const val API = "https://www.googleapis.com/drive/v3"
    private const val UPLOAD = "https://www.googleapis.com/upload/drive/v3"

    class HttpError(val code: Int, message: String) : IOException(message)

    fun mimeFor(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
        "jpg", "jpeg", "jfif" -> "image/jpeg"
        "png" -> "image/png"; "webp" -> "image/webp"; "gif" -> "image/gif"; "bmp" -> "image/bmp"
        "tif", "tiff" -> "image/tiff"; "avif" -> "image/avif"; "heic", "heif" -> "image/heic"
        "mp4", "m4v" -> "video/mp4"; "mkv" -> "video/x-matroska"; "webm" -> "video/webm"
        "mov" -> "video/quicktime"; "avi" -> "video/x-msvideo"; "3gp" -> "video/3gpp"
        else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())
            ?: "application/octet-stream"
    }

    private fun fail(conn: HttpURLConnection): Nothing {
        val body = try { conn.errorStream?.bufferedReader()?.readText() ?: "" } catch (_: Exception) { "" }
        val message = try { JSONObject(body).getJSONObject("error").getString("message") } catch (_: Exception) { body.take(200) }
        throw HttpError(conn.responseCode, "Drive ${conn.responseCode}: $message")
    }

    /**
     * Formats the desktop imports as they are. Anything else (HEIC/HEIF, DNG, AVIF...) is converted on the
     * phone to a full-resolution JPEG, otherwise the desktop would leave it on Drive as unsupported.
     */
    private val DESKTOP_IMAGE_TYPES = setOf("image/jpeg", "image/pjpeg", "image/png", "image/webp", "image/bmp",
        "image/x-ms-bmp", "image/gif", "image/tiff")
    private val DESKTOP_IMAGE_EXTENSIONS = setOf("jpg", "jpeg", "jfif", "png", "webp", "bmp", "gif", "tif", "tiff")

    fun desktopReadsAsIs(name: String, mime: String?): Boolean {
        val ext = name.substringAfterLast('.', "").lowercase()
        val type = (mime ?: "").lowercase()
        return if (type.startsWith("image/")) type in DESKTOP_IMAGE_TYPES else ext in DESKTOP_IMAGE_EXTENSIONS
    }

    /**
     * Network retries for transient failures (no connection, timeouts, HTTP 429/5xx). Other HTTP errors,
     * including 401 (expired session), are returned at once so the caller can renew the token.
     */
    fun <T> retrying(attempts: Int = 3, block: () -> T): T {
        var last: Exception? = null
        for (attempt in 0 until attempts) {
            try {
                return block()
            } catch (e: HttpError) {
                if (e.code != 429 && e.code < 500) throw e
                last = e
            } catch (e: IOException) {
                last = e
            }
            if (attempt < attempts - 1) Thread.sleep(1500L shl attempt)
        }
        throw last ?: IOException("upload failed")
    }

    /**
     * Caricamento ripristinabile nella cartella indicata; restituisce l'ID del file creato.
     * [properties] become Drive custom file properties (e.g. cv_crop, the cover crop read by the desktop).
     */
    fun upload(token: String, parent: String, name: String, mime: String, length: Long, open: () -> InputStream,
               progress: (Float) -> Unit = {}, properties: Map<String, String> = emptyMap()): String {
        val metaJson = JSONObject().put("name", name).put("parents", JSONArray().put(parent))
        if (properties.isNotEmpty()) {
            val props = JSONObject()
            for ((key, value) in properties) props.put(key, value)
            metaJson.put("properties", props)
        }
        val meta = metaJson.toString().toByteArray()
        val init = (URL("$UPLOAD/files?uploadType=resumable&supportsAllDrives=true&fields=id").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; doOutput = true; connectTimeout = 30000; readTimeout = 60000
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Content-Type", "application/json; charset=UTF-8")
            setRequestProperty("X-Upload-Content-Type", mime)
            setRequestProperty("X-Upload-Content-Length", length.toString())
            setFixedLengthStreamingMode(meta.size)
        }
        init.outputStream.use { it.write(meta) }
        if (init.responseCode !in 200..299) fail(init)
        val session = init.getHeaderField("Location") ?: throw IOException("Drive did not open an upload session")
        init.disconnect()
        val put = (URL(session).openConnection() as HttpURLConnection).apply {
            requestMethod = "PUT"; doOutput = true; connectTimeout = 30000; readTimeout = 300000
            setRequestProperty("Content-Type", mime)
            setFixedLengthStreamingMode(length)
        }
        open().use { input ->
            put.outputStream.use { out ->
                val buf = ByteArray(256 * 1024)
                var sent = 0L
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    sent += n
                    if (length > 0) progress((sent.toFloat() / length).coerceIn(0f, 1f))
                }
            }
        }
        if (put.responseCode !in 200..299) fail(put)
        val id = JSONObject(put.inputStream.bufferedReader().readText()).optString("id")
        put.disconnect()
        return id
    }

    /** Scarica un file di Drive nella Galleria del telefono (Immagini/CharacterVault). */
    fun downloadToGallery(context: Context, token: String, fileId: String, name: String): Uri {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            throw IOException("Saving to the phone gallery requires Android 10 or later. Use Open in Drive instead.")
        }
        val conn = (URL("$API/files/$fileId?alt=media&supportsAllDrives=true").openConnection() as HttpURLConnection).apply {
            connectTimeout = 30000; readTimeout = 300000
            setRequestProperty("Authorization", "Bearer $token")
        }
        if (conn.responseCode !in 200..299) fail(conn)
        val resolver = context.contentResolver
        val serverMime = conn.contentType?.substringBefore(';')?.trim() ?: ""
        val mime = if (serverMime.startsWith("video/") || serverMime.startsWith("image/")) serverMime else mimeFor(name)
        val video = mime.startsWith("video/")
        val collection = if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, (if (video) Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_PICTURES) + "/CharacterVault")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(collection, values) ?: throw IOException("Gallery unavailable")
        try {
            conn.inputStream.use { input -> resolver.openOutputStream(uri)!!.use { input.copyTo(it, 256 * 1024) } }
            values.clear(); values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } catch (e: Exception) {
            resolver.delete(uri, null, null); throw e
        } finally { conn.disconnect() }
        return uri
    }
}
