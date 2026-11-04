package com.timing.droid.overlay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build

/**
 * 屏幕旋转 / 分屏监听。
 *
 * 为什么用广播而不是 `Service.onConfigurationChanged`：服务不保证收到那个回调
 * （取决于声明方式和当时的进程状态），而 `ACTION_CONFIGURATION_CHANGED` 一定会来。
 *
 * 注册与注销都包了 `runCatching`：注册失败只意味着旋转后小条位置偏一点，
 * 注销失败通常是因为系统已经替我们收了，两者都不该影响服务本体。
 */
class RotationWatcher(private val onChanged: () -> Unit) {

    private var receiver: BroadcastReceiver? = null

    /** 幂等：重复调用不会注册两次。 */
    fun start(ctx: Context) {
        if (receiver != null) return
        val r = object : BroadcastReceiver() {
            override fun onReceive(c: Context?, i: Intent?) = onChanged()
        }
        val filter = IntentFilter(Intent.ACTION_CONFIGURATION_CHANGED)
        val ok = runCatching {
            if (Build.VERSION.SDK_INT >= 33) {
                ctx.registerReceiver(r, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                ctx.registerReceiver(r, filter)
            }
        }.isSuccess
        if (ok) receiver = r
    }

    fun stop(ctx: Context) {
        val r = receiver ?: return
        receiver = null
        runCatching { ctx.unregisterReceiver(r) }
    }
}
