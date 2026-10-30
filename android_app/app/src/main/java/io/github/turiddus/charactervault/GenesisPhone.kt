package io.github.turiddus.charactervault

import android.content.ContentValues
import android.content.Context
import android.os.Environment
import android.provider.MediaStore
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.URL
import java.security.KeyStore
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.zip.CRC32
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.net.ssl.HttpsURLConnection

/**
 * 8.2.1 — Genesis directly on the phone.
 *
 * The OpenAI key is encrypted with an AES-256-GCM key that lives in the Android Keystore (it never leaves the
 * secure hardware and is not part of backups: allowBackup=false). The key is read only here, in native code, and
 * never reaches the web page, Drive, the catalog or a log. The phone calls the OpenAI Images API, saves the PNG
 * (prompt in the "parameters" text chunk, read by the desktop importer) and uploads it to the Drive inbox like any
 * phone photo (cv_origin=android, cv_genesis=phone): the PC that edits the archive imports it and Codex catalogs it.
 *
 * Local budget guard, same rules as Genesis Studio: a reservation of the estimate + 25% is written BEFORE the
 * request; after a network error once the request was sent the job becomes "uncertain" (it may have been
 * charged), keeps its reservation and blocks new requests until the user reconciles it. Never retried automatically.
 */
object GenesisPhone {
    const val DIR = "genesis_phone"
    val MODELS = listOf("gpt-image-2.5-flare", "gpt-image-2.5-sunburst")
    val QUALITIES = listOf("low", "medium", "high", "xhigh", "max")
    val SIZES = listOf("1152x2048", "1024x1536")
    private val BASE = mapOf("low" to 0.0047, "medium" to 0.0110, "high" to 0.0424, "xhigh" to 0.0753, "max" to 0.1695)
    const val MARGIN = 1.25
    private const val ENDPOINT = "https://api.openai.com/v1/images/generations"
    private const val EDITS = "https://api.openai.com/v1/images/edits"
    private const val ALIAS = "cv_genesis_openai_key_v1"
    private const val PREFS = "cv_genesis_phone"
    private const val MAX_ENTRIES = 400
    private const val KEEP_FILES = 40
    private val lock = Any()

    class ApiError(val code: Int, message: String) : IOException(message)
    class Uncertain(message: String) : IOException(message)

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun dir(ctx: Context) = File(ctx.filesDir, DIR).apply { mkdirs() }

    // ------------------------------------------------------------------ API key (Android Keystore)
    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build())
        return gen.generateKey()
    }

    fun validKey(key: String) = key.length in 20..400 && key.startsWith("sk-") && key.none { it.isWhitespace() }

    fun saveKey(ctx: Context, raw: String) {
        val key = raw.trim()
        if (!validKey(key)) throw IllegalArgumentException("This does not look like an OpenAI API key (it starts with sk-).")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val sealed = cipher.doFinal(key.toByteArray(Charsets.UTF_8))
        val value = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(sealed, Base64.NO_WRAP)
        prefs(ctx).edit().putString("key", value).apply()
    }

    private fun loadKey(ctx: Context): String? = try {
        val value = prefs(ctx).getString("key", null) ?: return null
        val (iv, sealed) = value.split(":").let { Base64.decode(it[0], Base64.NO_WRAP) to Base64.decode(it[1], Base64.NO_WRAP) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
        String(cipher.doFinal(sealed), Charsets.UTF_8).takeIf { validKey(it) }
    } catch (_: Exception) { null }

    fun hasKey(ctx: Context) = loadKey(ctx) != null

    fun clearKey(ctx: Context) {
        prefs(ctx).edit().remove("key").apply()
        try { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(ALIAS) } catch (_: Exception) {}
    }

    // ------------------------------------------------------------------ local ledger
    private fun day(ts: Long = System.currentTimeMillis()) = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(ts))

    private fun entries(ctx: Context): JSONArray = try { JSONArray(prefs(ctx).getString("ledger", "[]")) } catch (_: Exception) { JSONArray() }

    private fun store(ctx: Context, list: JSONArray) {
        var archived = prefs(ctx).getFloat("archived_spent", 0f).toDouble()
        var keep = list
        if (list.length() > MAX_ENTRIES) {
            keep = JSONArray()
            val drop = list.length() - MAX_ENTRIES
            for (i in 0 until list.length()) {
                val e = list.getJSONObject(i)
                if (i < drop && e.optString("status") == "done") archived += e.optDouble("cost", 0.0)
                else if (i < drop && e.optString("status") in setOf("failed", "free")) Unit
                else keep.put(e)
            }
        }
        prefs(ctx).edit().putString("ledger", keep.toString()).putFloat("archived_spent", archived.toFloat()).apply()
    }

    private fun charged(e: JSONObject): Double = when (e.optString("status")) {
        "done" -> e.optDouble("cost", 0.0)
        "reserved", "uncertain" -> e.optDouble("reserve", 0.0)
        else -> 0.0
    }

    /** A job left "reserved" by an app that was closed mid-request may have been charged: it becomes uncertain. */
    fun recover(ctx: Context) = synchronized(lock) {
        val list = entries(ctx)
        var changed = false
        for (i in 0 until list.length()) {
            val e = list.getJSONObject(i)
            if (e.optString("status") == "reserved") {
                e.put("status", "uncertain").put("error", "The app was closed during the request.")
                changed = true
            }
        }
        if (changed) store(ctx, list)
    }

    fun estimate(ctx: Context, model: String, quality: String, size: String): Double {
        val history = ArrayList<Double>()
        val list = entries(ctx)
        for (i in 0 until list.length()) {
            val e = list.getJSONObject(i)
            if (e.optString("status") == "done" && e.optBoolean("measured") && e.optString("model") == model &&
                e.optString("quality") == quality && e.optString("size") == size) history.add(e.optDouble("cost", 0.0))
        }
        val recent = history.takeLast(20).filter { it > 0 }
        if (recent.isNotEmpty()) return maxOf(0.0001, recent.average() * 1.20)
        val (w, h) = size.split("x").map { it.toInt() }
        return BASE.getValue(quality) * (w * h / (1152.0 * 2048.0))
    }

    fun setLimits(ctx: Context, budget: Double, daily: Double) {
        if (!(budget >= 0 && daily >= 0 && budget < 10000 && daily < 10000)) throw IllegalArgumentException("Invalid amount.")
        prefs(ctx).edit().putFloat("budget", budget.toFloat()).putFloat("daily", daily.toFloat()).apply()
    }

    fun state(ctx: Context, busy: Boolean): JSONObject = synchronized(lock) {
        val p = prefs(ctx)
        val list = entries(ctx)
        val today = day()
        var spent = p.getFloat("archived_spent", 0f).toDouble()
        var spentToday = 0.0
        var generated = 0
        var uncertain: JSONObject? = null
        val items = JSONArray()
        for (i in 0 until list.length()) {
            val e = list.getJSONObject(i)
            val c = charged(e)
            spent += c
            if (e.optString("day") == today) spentToday += c
            if (e.optString("status") == "done") generated++
            if (e.optString("status") == "uncertain" && uncertain == null) uncertain = e
        }
        for (i in list.length() - 1 downTo maxOf(0, list.length() - 30)) {
            val e = list.getJSONObject(i)
            val file = e.optString("file")
            if (file.isNotEmpty() && File(dir(ctx), file).isFile) items.put(e)
            else if (e.optString("status") in setOf("failed", "uncertain")) items.put(e)
        }
        val budget = p.getFloat("budget", 0f).toDouble()
        val daily = p.getFloat("daily", 0f).toDouble()
        val prices = JSONObject()
        for (m in MODELS) {
            val bySize = JSONObject()
            for (s in SIZES) {
                val byQ = JSONObject()
                for (q in QUALITIES) byQ.put(q, estimate(ctx, m, q, s))
                bySize.put(s, byQ)
            }
            prices.put(m, bySize)
        }
        JSONObject()
            .put("has_key", hasKey(ctx))
            .put("busy", busy)
            .put("budget", budget).put("daily", daily)
            .put("spent", spent).put("today", spentToday)
            .put("remaining", maxOf(0.0, budget - spent))
            .put("today_remaining", maxOf(0.0, daily - spentToday))
            .put("generated", generated)
            .put("uncertain", uncertain ?: JSONObject.NULL)
            .put("margin", MARGIN)
            .put("prices", prices)
            .put("items", items)
    }

    /** Checks and writes the reservation; returns the job id. Throws with a readable message when not allowed. */
    fun reserve(ctx: Context, model: String, quality: String, size: String, prompt: String, dna: String = "",
                entity: String = ""): JSONObject = synchronized(lock) {
        if (model !in MODELS || quality !in QUALITIES || size !in SIZES) throw IllegalArgumentException("Invalid model, quality or size.")
        if (prompt.length < 40 || prompt.length > 30000) throw IllegalArgumentException("Invalid prompt.")
        if (!hasKey(ctx)) throw IllegalStateException("Save your OpenAI API key on this phone first.")
        val st = state(ctx, false)
        if (st.opt("uncertain") is JSONObject) throw IllegalStateException("A previous request is uncertain: check it below first.")
        val cost = estimate(ctx, model, quality, size)
        val reserve = cost * MARGIN
        // 9.0.5: no local budget or daily limit: the OpenAI prepaid balance is the limit (spend is still recorded)
        val now = System.currentTimeMillis()
        val id = java.lang.Long.toHexString(now) + java.lang.Long.toHexString(java.util.Random().nextLong() and 0xffff)
        val job = JSONObject().put("id", id).put("ts", now / 1000).put("day", day(now))
            .put("model", model).put("quality", quality).put("size", size)
            .put("status", "reserved").put("estimate", cost).put("reserve", reserve).put("upload", "none")
        if (Regex("^[0-9a-f]{8,32}$").matches(dna)) job.put("dna", dna)
        if (Regex("^[A-Za-z0-9_.:-]{1,64}$").matches(entity)) job.put("entity", entity)
        val list = entries(ctx)
        list.put(job)
        store(ctx, list)
        job
    }

    private fun update(ctx: Context, id: String, change: (JSONObject) -> Unit) = synchronized(lock) {
        val list = entries(ctx)
        for (i in 0 until list.length()) {
            val e = list.getJSONObject(i)
            if (e.optString("id") == id) { change(e); break }
        }
        store(ctx, list)
    }

    private fun find(ctx: Context, name: String): JSONObject? = synchronized(lock) {
        val list = entries(ctx)
        for (i in 0 until list.length()) { val e = list.getJSONObject(i); if (e.optString("file") == name) return e }
        null
    }

    fun reconcile(ctx: Context, id: String, wasCharged: Boolean) = update(ctx, id) { e ->
        if (e.optString("status") == "uncertain") {
            if (wasCharged) e.put("status", "done").put("cost", e.optDouble("reserve", 0.0)).put("measured", false)
            else e.put("status", "free").put("cost", 0.0)
        }
    }

    fun failed(ctx: Context, id: String, message: String) = update(ctx, id) { e -> e.put("status", "failed").put("cost", 0.0).put("error", message.take(300)) }
    fun uncertain(ctx: Context, id: String, message: String) = update(ctx, id) { e -> e.put("status", "uncertain").put("error", message.take(300)) }
    fun setUpload(ctx: Context, name: String, status: String, error: String = "") {
        val e = find(ctx, name) ?: return
        update(ctx, e.getString("id")) { it.put("upload", status).put("upload_error", error.take(300)) }
    }
    fun uploadStatus(ctx: Context, name: String): String = find(ctx, name)?.optString("upload") ?: ""
    fun entityFor(ctx: Context, name: String): String = find(ctx, name)?.optString("entity") ?: ""

    // ------------------------------------------------------------------ OpenAI Images API
    private fun costFromUsage(usage: JSONObject?): Double? {
        if (usage == null) return null
        val out = usage.optJSONObject("output_tokens_details")
        val inp = usage.optJSONObject("input_tokens_details")
        val imageOut = out?.optLong("image_tokens", -1)?.takeIf { it >= 0 } ?: usage.optLong("output_tokens", -1)
        val textIn = inp?.optLong("text_tokens", -1)?.takeIf { it >= 0 } ?: usage.optLong("input_tokens", -1)
        val imageIn = inp?.optLong("image_tokens", 0) ?: 0
        if (imageOut < 0 || textIn < 0) return null
        return (imageOut * 30.0 + textIn * 5.0 + imageIn * 8.0) / 1e6
    }

    private fun readAll(stream: java.io.InputStream?): String = stream?.use { String(it.readBytes(), Charsets.UTF_8) } ?: ""

    /** Runs the paid request for a reserved job and stores the PNG. Returns the file name. */
    /** 9.0 Character Studio: multipart body for /images/edits with the character's reference images. */
    private fun editsBody(job: JSONObject, prompt: String, refs: List<File>, boundary: String): ByteArray {
        val out = ByteArrayOutputStream()
        fun field(name: String, value: String) {
            out.write("--$boundary\r\nContent-Disposition: form-data; name=\"$name\"\r\n\r\n$value\r\n".toByteArray(Charsets.UTF_8))
        }
        field("model", job.getString("model")); field("prompt", prompt); field("quality", job.getString("quality"))
        field("size", job.getString("size")); field("n", "1"); field("output_format", "png")
        refs.forEachIndexed { i, f ->
            out.write(("--$boundary\r\nContent-Disposition: form-data; name=\"image[]\"; filename=\"ref$i.jpg\"\r\n" +
                "Content-Type: image/jpeg\r\n\r\n").toByteArray(Charsets.UTF_8))
            out.write(f.readBytes())
            out.write("\r\n".toByteArray(Charsets.UTF_8))
        }
        out.write("--$boundary--\r\n".toByteArray(Charsets.UTF_8))
        return out.toByteArray()
    }

    fun generate(ctx: Context, job: JSONObject, prompt: String, refs: List<File> = emptyList()): String {
        val key = loadKey(ctx) ?: throw IllegalStateException("The OpenAI key cannot be read: save it again.")
        val id = job.getString("id")
        val boundary = "cvstudio" + java.lang.Long.toHexString(System.nanoTime())
        val body = if (refs.isEmpty()) JSONObject().put("model", job.getString("model")).put("prompt", prompt).put("n", 1)
            .put("size", job.getString("size")).put("quality", job.getString("quality")).put("output_format", "png")
            .toString().toByteArray(Charsets.UTF_8) else editsBody(job, prompt, refs, boundary)
        val conn = URL(if (refs.isEmpty()) ENDPOINT else EDITS).openConnection() as HttpsURLConnection
        conn.requestMethod = "POST"; conn.doOutput = true; conn.connectTimeout = 30000; conn.readTimeout = 600000
        conn.setRequestProperty("Authorization", "Bearer $key")
        conn.setRequestProperty("Content-Type", if (refs.isEmpty()) "application/json" else "multipart/form-data; boundary=$boundary")
        conn.setFixedLengthStreamingMode(body.size)
        try {
            conn.connect()
        } catch (e: IOException) {
            throw IOException("OpenAI cannot be reached (nothing was sent): ${e.message}")
        }
        val text: String
        try {
            conn.outputStream.use { it.write(body) }
            val code = conn.responseCode
            if (code !in 200..299) {
                val raw = readAll(conn.errorStream)
                val message = try { JSONObject(raw).optJSONObject("error")?.optString("message") } catch (_: Exception) { null }
                throw ApiError(code, "OpenAI error $code: ${(message ?: raw).ifBlank { "no details" }.take(280)}")
            }
            text = readAll(conn.inputStream)
        } catch (e: ApiError) {
            throw e
        } catch (e: IOException) {
            throw Uncertain("Connection lost after the request was sent: it may have been charged. ${e.message ?: ""}".trim())
        } finally {
            conn.disconnect()
        }
        val json = try { JSONObject(text) } catch (_: Exception) { throw Uncertain("OpenAI answered with an unreadable response.") }
        val b64 = json.optJSONArray("data")?.optJSONObject(0)?.optString("b64_json").orEmpty()
        if (b64.isEmpty()) throw Uncertain("OpenAI answered without an image.")
        val raw = Base64.decode(b64, Base64.DEFAULT)
        val usage = json.optJSONObject("usage")
        val measured = costFromUsage(usage)
        val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        val name = "genesis_phone_${stamp}_${id.takeLast(4)}.png"
        val settings = "Steps: 1, Size: ${job.getString("size")}, Model: ${job.getString("model")}, " +
            "Quality: ${job.getString("quality")}, Version: Genesis phone ${BuildConfigCompatVersion.name(ctx)}" +
            (if (job.optString("dna").isNotEmpty()) ", DNA: ${job.optString("dna")}" else "") +
            (if (job.optString("entity").isNotEmpty()) ", Character: ${job.optString("entity")}" else "")
        val software = if (refs.isEmpty()) "Character Vault Genesis (phone)" else "Character Vault Studio (phone)"
        val png = withText(raw, listOf("parameters" to "$prompt\n$settings", "Software" to software))
        File(dir(ctx), name).writeBytes(png)
        update(ctx, id) { e ->
            e.put("status", "done").put("cost", measured ?: e.optDouble("estimate", 0.0)).put("measured", measured != null)
                .put("file", name).put("bytes", png.size.toLong())
                .put("sha256", java.security.MessageDigest.getInstance("SHA-256").digest(png).joinToString("") { "%02x".format(it) })
            if (usage != null) e.put("tokens", JSONObject()
                .put("input", usage.optLong("input_tokens")).put("output", usage.optLong("output_tokens"))
                .put("total", usage.optLong("total_tokens")))
            e.put("prompt_head", prompt.substringAfter("CHARACTER SPECIFICATION:", prompt).trim().take(600))
        }
        prune(ctx)
        return name
    }

    /** Inserts tEXt chunks right after IHDR (Latin-1, as the PNG standard requires). Non-PNG data is returned as is. */
    fun withText(png: ByteArray, entries: List<Pair<String, String>>): ByteArray {
        val signature = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
        if (png.size < 33 || !png.copyOfRange(0, 8).contentEquals(signature)) return png
        val ihdrLength = ((png[8].toInt() and 0xff) shl 24) or ((png[9].toInt() and 0xff) shl 16) or
            ((png[10].toInt() and 0xff) shl 8) or (png[11].toInt() and 0xff)
        val end = 8 + 12 + ihdrLength
        if (end > png.size) return png
        val out = ByteArrayOutputStream(png.size + 4096)
        out.write(png, 0, end)
        for ((keyword, value) in entries) {
            val clean = value.map { if (it.code in 32..255 || it == '\n') it else '?' }.joinToString("")
            val data = keyword.toByteArray(Charsets.ISO_8859_1) + byteArrayOf(0) + clean.toByteArray(Charsets.ISO_8859_1)
            val type = "tEXt".toByteArray(Charsets.US_ASCII)
            val crc = CRC32().apply { update(type); update(data) }.value
            out.write(byteArrayOf((data.size ushr 24).toByte(), (data.size ushr 16).toByte(), (data.size ushr 8).toByte(), data.size.toByte()))
            out.write(type); out.write(data)
            out.write(byteArrayOf((crc ushr 24).toByte(), (crc ushr 16).toByte(), (crc ushr 8).toByte(), crc.toByte()))
        }
        out.write(png, end, png.size - end)
        return out.toByteArray()
    }

    /** Keeps the newest local copies; older images already in the gallery are removed from the phone. */
    private fun prune(ctx: Context) {
        val files = dir(ctx).listFiles { f -> f.name.endsWith(".png") }?.sortedByDescending { it.lastModified() } ?: return
        for (f in files.drop(KEEP_FILES)) if (uploadStatus(ctx, f.name) == "sent") f.delete()
    }

    fun file(ctx: Context, name: String): File? {
        if (!Regex("^genesis_phone_[0-9_]+_[0-9a-f]{1,4}\\.png$").matches(name)) return null
        return File(dir(ctx), name).takeIf { it.isFile }
    }

    fun delete(ctx: Context, name: String) { file(ctx, name)?.delete() }

    fun saveToGallery(ctx: Context, name: String) {
        if (android.os.Build.VERSION.SDK_INT < 29) throw IOException("Saving to the gallery needs Android 10 or newer.")
        val source = file(ctx, name) ?: throw IOException("Image not found on the phone.")
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, "image/png")
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/CharacterVault")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val resolver = ctx.contentResolver
        val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: throw IOException("Gallery not available.")
        try {
            resolver.openOutputStream(uri)?.use { out -> source.inputStream().use { it.copyTo(out) } } ?: throw IOException("Gallery not writable.")
            values.clear(); values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } catch (e: Exception) {
            resolver.delete(uri, null, null); throw e
        }
    }
}

/** versionName without an Activity (BuildConfig is disabled). */
object BuildConfigCompatVersion {
    fun name(ctx: Context): String = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "" } catch (_: Exception) { "" }
}
