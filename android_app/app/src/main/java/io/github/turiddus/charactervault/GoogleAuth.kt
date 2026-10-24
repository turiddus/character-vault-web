package io.github.turiddus.charactervault

import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import com.google.android.gms.auth.GoogleAuthUtil
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import java.util.concurrent.Executors

/**
 * Accesso a Google Drive con l'account del telefono (Google Identity Services, AuthorizationClient).
 * Nessun ID client da incollare: Google riconosce l'app dal nome del pacchetto e dall'impronta SHA-1 della firma,
 * registrati una volta in Google Cloud come client OAuth «Android». Il token dura circa un'ora e viene
 * rinnovato in silenzio quando serve.
 */
object GoogleAuth {
    private const val DRIVE = "https://www.googleapis.com/auth/drive"
    private const val LIFETIME_MS = 50L * 60L * 1000L
    private val io = Executors.newSingleThreadExecutor()

    @Volatile var token: String? = null
        private set
    @Volatile private var expiresAt = 0L
    private var pending: ((String?, String?) -> Unit)? = null

    fun valid(): Boolean = token != null && System.currentTimeMillis() < expiresAt
    fun secondsLeft(): Long = ((expiresAt - System.currentTimeMillis()) / 1000L).coerceAtLeast(0)

    private fun request() = AuthorizationRequest.builder().setRequestedScopes(listOf(Scope(DRIVE))).build()

    /** cb(token, errore). Con interactive=true mostra la scelta dell'account o il consenso se servono. */
    fun authorize(activity: Activity, launcher: ActivityResultLauncher<IntentSenderRequest>?, interactive: Boolean,
                  cb: (String?, String?) -> Unit) {
        if (valid()) { cb(token, null); return }
        Identity.getAuthorizationClient(activity).authorize(request())
            .addOnSuccessListener { result ->
                if (result.hasResolution()) {
                    val intent = result.pendingIntent
                    if (interactive && launcher != null && intent != null) {
                        pending = cb
                        launcher.launch(IntentSenderRequest.Builder(intent.intentSender).build())
                    } else cb(null, "consent_required")
                } else store(result.accessToken, cb)
            }
            .addOnFailureListener { cb(null, it.message ?: "accesso non riuscito") }
    }

    /** Risultato della schermata di consenso (da chiamare nel callback del launcher). */
    fun onConsentResult(activity: Activity, data: Intent?) {
        val cb = pending ?: return
        pending = null
        try {
            val result = Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(data)
            store(result.accessToken, cb)
        } catch (e: Exception) {
            cb(null, e.message ?: "accesso annullato")
        }
    }

    private fun store(value: String?, cb: (String?, String?) -> Unit) {
        if (value.isNullOrEmpty()) { cb(null, "token non ricevuto"); return }
        token = value
        expiresAt = System.currentTimeMillis() + LIFETIME_MS
        cb(value, null)
    }

    /** Token rifiutato da Drive (revocato o scaduto prima del previsto): Google ne emetterà uno nuovo. */
    fun invalidate(context: Context, value: String?) {
        if (value.isNullOrEmpty()) return
        if (value == token) { token = null; expiresAt = 0 }
        val app = context.applicationContext
        io.execute { try { GoogleAuthUtil.clearToken(app, value) } catch (_: Exception) { } }
    }

    fun signOut(context: Context) = invalidate(context, token)
}
