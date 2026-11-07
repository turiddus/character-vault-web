plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "io.github.turiddus.charactervault"
    compileSdk = 35
    defaultConfig {
        applicationId = "io.github.turiddus.charactervault"
        minSdk = 28
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0-alpha"
    }
    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
dependencies {
    implementation("com.google.mlkit:object-detection:17.0.2")
    implementation("com.google.mlkit:face-detection:16.1.7")
}
