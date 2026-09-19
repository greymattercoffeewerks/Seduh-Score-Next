import java.util.Properties

val webEnvironment = Properties().apply {
    val environmentFile = rootProject.file("../../.env")
    if (environmentFile.exists()) environmentFile.inputStream().use(::load)
}

val androidLocalProperties = Properties().apply {
    val propertiesFile = rootProject.file("local.properties")
    if (propertiesFile.exists()) propertiesFile.inputStream().use(::load)
}

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.seduhscore.guessthebeanwidget"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "com.seduhscore.guessthebeanwidget"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "1.0"

        buildConfigField("String", "SUPABASE_URL", "\"${androidLocalProperties.getProperty("supabase.url", webEnvironment.getProperty("VITE_SUPABASE_URL", ""))}\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"${androidLocalProperties.getProperty("supabase.anonKey", webEnvironment.getProperty("VITE_SUPABASE_ANON_KEY", ""))}\"")

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        // Diagnostic build for bisecting the Honor MagicOS render failure (see
        // ../HONOR-COMPATIBILITY-STUDY.md). Own applicationId so it installs alongside the
        // real app; debug-signed; the probe widgets live only in src/probe/.
        create("probe") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".probe"
            matchingFallbacks += "debug"
        }
        release {
            optimization {
                enable = false
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.glance.appwidget)
    implementation(libs.androidx.work.runtime.ktx)
    testImplementation(libs.junit)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.junit)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
    debugImplementation(libs.androidx.compose.ui.tooling)
}
