package com.timing.app.overlay

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import com.timing.app.MainActivity

/**
 * 悬浮条的前台通知。
 *
 * 前台服务必须挂一条常驻通知，否则系统会在几秒内把服务杀掉。这条通知同时也是**兜底**：
 * 用户拒了「显示在其他应用上层」权限、或者厂商 ROM 不给贴窗时，通知栏里仍然看得见计时。
 *
 * 内容指纹（[push]）用来避免通知栏每秒闪一下——内容没变就不重新 notify。
 */
internal object OverlayNoti {

    const val CHANNEL = "timing-overlay"
    const val ID = 0x7E11

    fun ensureChannel(nm: NotificationManager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(CHANNEL, "悬浮条", NotificationManager.IMPORTANCE_LOW)
        channel.setShowBadge(false)
        channel.setSound(null, null)
        nm.createNotificationChannel(channel)
    }

    fun build(ctx: Context, snap: TimerReader.Snap): Notification {
        val open = PendingIntent.getActivity(
            ctx,
            0,
            openIntent(ctx),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(ctx, CHANNEL)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(ctx)
        }
        return builder
            .setSmallIcon(android.R.drawable.ic_menu_recent_history)
            .setContentTitle(title(snap))
            .setContentText(clock(snap.displaySec))
            .setOngoing(true)
            .setShowWhen(false)
            .setContentIntent(open)
            .build()
    }

    /** 内容没变就不推；返回最新指纹。 */
    fun push(
        nm: NotificationManager,
        ctx: Context,
        snap: TimerReader.Snap,
        last: String,
    ): String {
        val fingerprint = title(snap) + "|" + clock(snap.displaySec)
        if (fingerprint == last) return last
        runCatching { nm.notify(ID, build(ctx, snap)) }
        return fingerprint
    }

    /** 点通知（或点悬浮条）都回主界面：计时操作只在主界面里做，不在原生层双写。 */
    fun openIntent(ctx: Context): Intent = Intent(ctx, MainActivity::class.java).addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_SINGLE_TOP or
            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT,
    )

    private fun title(snap: TimerReader.Snap): String =
        if (!snap.active) "待机" else snap.item.ifEmpty { "计时中" }

    private fun clock(total: Long): String {
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        return if (h > 0) String.format("%d:%02d:%02d", h, m, s)
        else String.format("%02d:%02d", m, s)
    }
}
