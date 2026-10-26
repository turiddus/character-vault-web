# Character Vault Native — Android (0.1.0 alpha)

**Codice Android nativo**, sviluppato separatamente dalla PWA già pubblicata. L'app non è una WebView.

## Funzioni incluse
- Importazione multipla di immagini da Android Storage Access Framework (nessun permesso globale alla galleria).
- Ritocco manuale del rettangolo di crop: trascina e usa il gesto di pizzicare per ridimensionare.
- Formati 9:16, 4:5 e 1:1.
- Inquadratura assistita offline con ML Kit **bundled**: prima trova il soggetto tramite object detection, altrimenti un volto; se non trova niente usa il ritaglio centrato (senza dichiarare falsi rilevamenti).
- Elaborazione in batch; salva JPEG in **Immagini/CharacterVault**, con scheda JSON privata minima e storico.
- Condivisione dell'ultimo JPEG tramite Android Sharesheet (es. Google Drive).

## Limiti attuali
Non è il porting del motore Python/Windows 4.3.3. L'indice `indice_web.json.gz` della PWA continua ad essere generato dal programma PC; l'app Android NON lo rigenera né scrive sul database desktop. Codex CLI non è eseguito sul dispositivo, né viene simulato offline: per descrizioni AI e riconoscimento delle identità sono ancora necessari modelli aggiuntivi o API. La rilevazione ML Kit non è affidabile per qualsiasi illustrazione, creatura o personaggio 3D: controllare sempre i crop automatici.

## Compilazione
Aprire `android-native` in Android Studio (JDK 17; Android SDK 35). Compilare app debug oppure usare il workflow Actions `Build Character Vault Native APK` e scaricare l'artefatto `character-vault-native-debug-apk`.

Dipendenze: com.google.mlkit:object-detection:17.0.2 e face-detection:16.1.7. Per i modelli bundled, l'inferenza non richiede rete.

Per compatibilità con l'archivio attuale non modificare file Drive con l'indice pubblicato dal PC senza un protocollo di merge/conflitto.
