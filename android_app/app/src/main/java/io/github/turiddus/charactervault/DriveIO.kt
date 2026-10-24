package io.github.turiddus.charactervault

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
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
        "png" -> "image/png"; "webp" -> "image/webp"; "gif" -> "image/gif"; "bmp" -> "image/bmp"
        "tif", "tiff" -> "image/tiff"; "avif" -> "image/avif"; "heic", "heif" -> "image/heic"
        else -> "image/jpeg"
    }

    private fun fail(conn: HttpURLConnection): Nothing {
        val body = try { conn.errorStream?.bufferedReader()?.readText() ?: "" } catch (_: Exception) { "" }
        val message = try { JSONObject(body).getJSONObject("error").getString("message") } catch (_: Exception) { body.take(200) }
        throw HttpError(conn.responseCode, "Drive ${conn.responseCode}: $message")
    }

    /** Caricamento ripristinabile nella cartella indicata; restituisce l'ID del file creato. */
    fun upload(token: String, parent: String, name: String, mime: String, length: Long, open: () -> InputStream,
               progress: (Float) -> Unit = {}): String {
        val meta = JSONObject().put("name", name).put("parents", JSONArray().put(parent)).toString().toByteArray()
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
        val session = init.getHeaderField("Location") ?: throw IOException("Drive non ha aperto il caricamento")
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
        val conn = (URL("$API/files/$fileId?alt=media&supportsAllDrives=true").openConnection() as HttpURLConnection).apply {
            connectTimeout = 30000; readTimeout = 300000
            setRequestProperty("Authorization", "Bearer $token")
        }
        if (conn.responseCode !in 200..299) fail(conn)
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, name)
            put(MediaStore.Images.Media.MIME_TYPE, mimeFor(name))
            put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/CharacterVault")
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: throw IOException("Galleria non disponibile")
        try {
            conn.inputStream.use { input -> resolver.openOutputStream(uri)!!.use { input.copyTo(it, 256 * 1024) } }
            values.clear(); values.put(MediaStore.Images.Media.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } catch (e: Exception) {
            resolver.delete(uri, null, null); throw e
        } finally { conn.disconnect() }
        return uri
    }
}
