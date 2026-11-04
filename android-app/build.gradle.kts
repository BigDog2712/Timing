// 根构建脚本：只声明插件版本，不在这里写业务。
// 版本组合与仓库里已验证可用的 Tauri 安卓工程（src-tauri/gen/android）保持一致：
// Gradle 9.6.1 + AGP 9.3.1 + Kotlin 2.2.10，这样两套工程共用同一份本机缓存，不必再下依赖。
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:9.3.1")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.10")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}
