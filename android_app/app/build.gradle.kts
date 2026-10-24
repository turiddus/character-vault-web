import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Firma: keystore creato dal BAT (o dalla CI) e descritto in ../keystore.properties.
// Senza keystore si usa la firma di debug di Android (l'APK si installa lo stesso).
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.isFile) f.inputStream().use { load(it) }
}

android {
    namespace = "io.github.turiddus.charactervault"
    compileSdk = 35
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "io.github.turiddus.charactervault"
        minSdk = 28
        targetSdk = 35
        versionCode = 3
        versionName = "1.1.0"
        // Solo processori dei telefoni (ARM): l'APK è molto più leggero senza le librerie x86 degli emulatori.
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
    }

    signingConfigs {
        if (keystoreProps.getProperty("storeFile") != null) {
            create("vault") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("vault") ?: signingConfigs.getByName("debug")
        }
        debug {
            signingConfigs.findByName("vault")?.let { signingConfig = it }
        }
    }

    // L'interfaccia è la stessa web app di GitHub Pages (cartella web_app del progetto), inclusa nell'APK.
    sourceSets["main"].assets.srcDir(rootProject.file("../web_app"))

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.google.android.gms:play-services-auth:21.2.0")
    implementation("com.google.mlkit:face-detection:16.1.7")
}
