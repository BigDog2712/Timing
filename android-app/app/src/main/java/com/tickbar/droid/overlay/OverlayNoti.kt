package com.tickbar.droid.overlay

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import com.tickbar.droid.R
import com.tickbar.droid.core.TimeFmt
import com.tickbar.droid.core.TimerCore
import com.tickbar.droid.ui.MainActivity

/**
 * 常驻通知：桌面靠托盘菜单给「暂停 / 结束」，手机没有托盘，这活儿交给通知。
 * 通道用 IMPORTANCE_LOW —— 常驻但不吵，也不弹横幅。
 */
object OverlayNoti {

    const val CHANNEL_ID = "tickbar_overlay"
    const val NOTI_ID = 1001

    const val ACTION_START = "com.tickbar.droid.action.START"
    const val ACTION_TOGGLE = "com.tickbar.droid.action.TOGGLE"
    const val ACTION_FINISH = "com.tickbar.droid.action.FINISH"
    const val ACTION_STOP = "com.tickbar.droid.action.STOP"
    const val ACTION_RESET_POS = "com.tickbar.droid.action.RESET_POS"

    fun intent(ctx: Context, action: String): Intent =
        Intent(ctx, OverlayService::class.java).setAction(action)

    fun ensureChannel(nm: NotificationManager) {
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "计时与悬浮窗", NotificationManager.IMPORTANCE_LOW).apply {
                description = "常驻显示当前计时，可直接暂停 / 结束"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
        )
    }

    /**
     * 推一条常驻通知，内容没变就跳过。
     *
     * 悬浮层 500ms 一跳，每次都 notify 会白耗电，也会让部分 ROM 的通知栏闪烁。
     * 返回本次的内容指纹，调用方存起来下次传进来做比较。
     *
     * `notify` 在通知权限被拒时抛 `SecurityException`，这里吞掉 ——
     * 没有通知不影响悬浮条和计时本身。
     */
    fun push(nm: NotificationManager, c: Context, s: TimerCore.Snapshot, last: String): String {
        val key = "${s.item}|${s.phase}|${s.elapsed / 1000L}"
        if (key == last) return last
        runCatching { nm.notify(NOTI_ID, build(c)) }
        return key
    }

    fun build(c: Context): Notification {
        val s = TimerCore.current()
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

        val open = PendingIntent.getActivity(
            c, 0,
            Intent(c, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            flags,
        )
        val toggle = PendingIntent.getService(c, 1, intent(c, ACTION_TOGGLE), flags)
        val finish = PendingIntent.getService(c, 2, intent(c, ACTION_FINISH), flags)
        // 动作按钮的图标：原来两个按钮共用计时器图标，长按展开后分不清谁是谁
        val playPause = Icon.createWithResource(
            c,
            if (s.phase == TimerCore.Phase.RUNNING) R.drawable.ic_noti_pause
            else R.drawable.ic_noti_play,
        )
        val stop = Icon.createWithResource(c, R.drawable.ic_noti_stop)

        val clock = TimeFmt.clock(s.display, s.mode == TimerCore.Mode.COUNTDOWN)
        val title = if (s.active) "${s.item} · $clock" else "TickBar 待机"
        val sub = when (s.phase) {
            TimerCore.Phase.RUNNING ->
                if (s.mode == TimerCore.Mode.COUNTDOWN) "倒计时进行中" else "正计时进行中"
            TimerCore.Phase.PAUSED -> "已暂停"
            TimerCore.Phase.DONE -> "计时结束"
            TimerCore.Phase.IDLE -> "点小圆点开始计时"
        }

        return Notification.Builder(c, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_timer)
            .setContentTitle(title)
            .setContentText(sub)
            // HyperOS 会把「计时」类前台服务通知收纳成岛状样式，靠 category 认门类。
            // 这不是注册超级岛（那要企业资质 + 上架审核），命中算白捡，命中不了不影响功能。
            .setCategory(
                if (s.active) Notification.CATEGORY_STOPWATCH else Notification.CATEGORY_REMINDER
            )
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setContentIntent(open)
            .addAction(
                Notification.Action.Builder(
                    playPause,
                    if (s.phase == TimerCore.Phase.RUNNING) "暂停" else "继续",
                    toggle,
                ).build()
            )
            .addAction(Notification.Action.Builder(stop, "结束", finish).build())
            .build()
    }
}
