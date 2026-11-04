package com.timing.droid

import android.app.Application
import com.timing.droid.core.Crash

/**
 * 唯一职责：在进程最早的时机装崩溃兜底。
 *
 * 不在这里 `Repo.init`——库的初始化交给用到它的地方（Activity / Service），
 * 这样万一库坏了，影响面只落在「用库的那个功能」上，而不是整个进程起不来。
 */
class TickApp : Application() {

    override fun onCreate() {
        super.onCreate()
        Crash.install(this)
    }
}
