import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.timing.droid"
    compileSdk = 36          // 本机已装 platforms;android-36

    defaultConfig {
        applicationId = "com.timing.droid"
        minSdk = 26          // 前台服务 + TYPE_APPLICATION_OVERLAY 的下限
        targetSdk = 35
        versionCode = 11
        versionName = "0.1.1"
    }

    buildTypes {
        release {
            // 骨架阶段不混淆：要看得懂堆栈。
            isMinifyEnabled = false
            // 自测期先用 debug 签名，release 包才能直接装机（正式签名等上架前再换）。
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = false
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_17
    }
}

dependencies {
    // 骨架阶段刻意「零运行时依赖」：不引 AndroidX / Compose / Material。
    // 好处：不联网解析依赖、不受版本冲突影响，Android Studio 打开即可编。
    // 代价：没有现成的 BottomSheet / RecyclerView，列表用手写 LinearLayout（骨架够用）。
    testImplementation("junit:junit:4.13.2")
}
