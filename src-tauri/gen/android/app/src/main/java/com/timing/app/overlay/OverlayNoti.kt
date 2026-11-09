package com.timing.app.overlay

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
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
            // 标题口径照老版本：「事项 · 时长」，一眼就能读出在做什么、做了多久
            .setContentTitle(title(snap))
            .setContentText(subText(snap))
            // HyperOS 会把「计时」类前台服务通知收纳成岛状样式，靠 category 认门类。
            // 这不是注册超级岛（那要企业资质 + 上架审核），命中算白捡，命中不了不影响功能。
            .setCategory(
                if (snap.active) Notification.CATEGORY_STOPWATCH else Notification.CATEGORY_REMINDER,
            )
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            /* [V0.11.27] 兜底原因可能长（探路清单），展开通知要能看全：
               这是用户在手机上**唯一**能看到「为什么悬浮条不动」的地方。 */
            .setStyle(Notification.BigTextStyle().bigText(title(snap) + "\n" + subText(snap)))
            .setContentIntent(open)
            .addAction(
                Notification.Action.Builder(
                    Icon.createWithResource(ctx, android.R.drawable.ic_menu_recent_history),
                    "打开",
                    open,
                ).build(),
            )
            .build()
    }

    /** 内容没变就不推；返回最新指纹。 */
    fun push(
        nm: NotificationManager,
        ctx: Context,
        snap: TimerReader.Snap,
        last: String,
    ): String {
        val fingerprint = title(snap) + "|" + subText(snap)
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

    /** 标题：「事项 · 时长」；待机时单独一个「待机」。 */
    private fun title(snap: TimerReader.Snap): String = when {
        !snap.active -> "待机"
        else -> "${snap.item.ifEmpty { "计时中" }} · ${clock(snap.displaySec)}"
    }

    /**
     * 副标题：状态本身（与老版本同一套措辞）。
     *
     * [V0.11.27] `note` 优先：它是「数据没读到 / 点击打不开」的原因，比状态描述重要得多
     * ——状态描述错了最多不准确，原因不说是彻底没法行动。
     */
    private fun subText(snap: TimerReader.Snap): String = when {
        snap.note != null -> snap.note
        !snap.active -> "点小圆点或长条回到 Timing 开始计时"
        snap.urgent -> "倒计时最后一分钟"
        snap.countdown -> if (snap.running) "倒计时进行中" else "已暂停"
        else -> if (snap.running) "正计时进行中" else "已暂停"
    }

    private fun clock(total: Long): String {
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        return if (h > 0) String.format("%d:%02d:%02d", h, m, s)
        else String.format("%02d:%02d", m, s)
    }
}
