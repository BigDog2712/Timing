package com.timing.app.native

import android.content.Context

/**
 * 原生侧的小份偏好：SAF 目录 URI、悬浮条开关与位置。
 *
 * 为什么不进 `timing.db`：这些是**设备本地**状态 —— 目录授权绑在这台机器的这个应用上，
 * 换机、重装、撤销授权都会失效。混进业务库会让 md 同步的基线判定看到一堆与内容无关的
 * 变更，也会让「导入导出整库」把这些本机 URI 带到另一台设备上。
 */
object Prefs {

    private const val FILE = "timing-native"
    private const val K_TREE = "saf_tree_uri"
    private const val K_OVERLAY_ON = "overlay_enabled"
    private const val K_OVERLAY_X = "overlay_x"
    private const val K_OVERLAY_Y = "overlay_y"
    private const val K_OVERLAY_STYLE = "overlay_style"
    /* [V0.11.27] 悬浮条的显示快照（Rust 推来的 JSON）与「待补做的动作」标记。 */
    private const val K_OVERLAY_SNAP = "overlay_snapshot"
    private const val K_PENDING_ACTION = "pending_action"

    /**
     * 0.11.27 只存过「一按的时间戳」（那时只有「切换」一种动作）。
     *
     * 现在动作有两种（切换 / 结束），标记改成 `动作@时间戳`；这个旧键只为了让升级前留下的
     * 标记仍能被补做一次，读到时按 `toggle` 处理。新写法一律走 [markPendingAction]。
     */
    private const val K_PENDING_TAP = "pending_tap_at"

    /** 位置未设置过（与真实坐标 -1 区分不开时用 `POS_UNSET`）。 */
    const val POS_UNSET = Int.MIN_VALUE

    /**
     * 悬浮形态：小圆点常驻（点一下临时展开）。
     *
     * 默认用它，对齐老版本 `Prefs.STYLE_DOT`——待机时不该在别人屏幕上占一条。
     */
    const val STYLE_DOT = 0

    /** 悬浮形态：长条常驻（顶部胶囊，仿灵动岛）。老版本叫 `STYLE_ISLAND`。 */
    const val STYLE_BAR = 1

    fun treeUri(ctx: Context): String = prefs(ctx).getString(K_TREE, "") ?: ""

    fun setTreeUri(ctx: Context, value: String) {
        prefs(ctx).edit().putString(K_TREE, value).apply()
    }

    fun overlayEnabled(ctx: Context): Boolean = prefs(ctx).getBoolean(K_OVERLAY_ON, false)

    fun setOverlayEnabled(ctx: Context, value: Boolean) {
        prefs(ctx).edit().putBoolean(K_OVERLAY_ON, value).apply()
    }

    fun overlayX(ctx: Context): Int = prefs(ctx).getInt(K_OVERLAY_X, POS_UNSET)

    fun overlayY(ctx: Context): Int = prefs(ctx).getInt(K_OVERLAY_Y, POS_UNSET)

    fun setOverlayPos(ctx: Context, x: Int, y: Int) {
        prefs(ctx).edit().putInt(K_OVERLAY_X, x).putInt(K_OVERLAY_Y, y).apply()
    }

    /** 清掉位置，下次贴窗回到「灵动岛位」（水平居中、状态栏下 4dp）。 */
    fun clearOverlayPos(ctx: Context) {
        prefs(ctx).edit().remove(K_OVERLAY_X).remove(K_OVERLAY_Y).apply()
    }

    fun overlayStyle(ctx: Context): Int = prefs(ctx).getInt(K_OVERLAY_STYLE, STYLE_DOT)

    fun setOverlayStyle(ctx: Context, value: Int) {
        prefs(ctx).edit().putInt(K_OVERLAY_STYLE, value).apply()
    }

    /**
     * 悬浮条的显示快照（[V0.11.27]）。
     *
     * 为什么落盘而不是只放内存：安卓前台服务可能比窗口活得久（进程没被杀时服务一直在），
     * 服务重启 / 重贴窗口时手上得有一份「上一帧」。放内存里，一次 `wm.removeView` 之后
     * 悬浮条就退回待机，直到下一次状态迁移。
     */
    fun overlaySnapshot(ctx: Context): String = prefs(ctx).getString(K_OVERLAY_SNAP, "") ?: ""

    fun setOverlaySnapshot(ctx: Context, json: String) {
        prefs(ctx).edit().putString(K_OVERLAY_SNAP, json).apply()
    }

    /**
     * 一个等着被前端补做的动作（[V0.11.28]）。
     *
     * `kind` 只有两个值：`"toggle"`（悬浮条短按 / 通知「暂停·继续」）与 `"finish"`（通知「结束」）。
     * `at` 是按下那一刻的墙钟毫秒，前端按 90 秒 TTL 判新旧。
     */
    data class PendingAction(val kind: String, val at: Long)

    /**
     * 记下「用户点了某个动作，但可能没人接」。
     *
     * 用途：动作要么被 WebView 里的监听者接走（前端会立刻清标记），要么没人接——
     * 那就留着，等 App 回到前台时由前端补做一次。见 `TimingNativePlugin.overlayTakeTap`。
     *
     * 顺手清掉 0.11.27 的旧键：同一按被两个键各算一次，表现就是「点一下切换两下」。
     */
    fun markPendingAction(ctx: Context, kind: String) {
        prefs(ctx).edit()
            .putString(K_PENDING_ACTION, "$kind@${System.currentTimeMillis()}")
            .remove(K_PENDING_TAP)
            .apply()
    }

    /** 取出还没被接走的动作；没有（或格式坏了）回 null。 */
    fun pendingAction(ctx: Context): PendingAction? {
        val raw = prefs(ctx).getString(K_PENDING_ACTION, "") ?: ""
        if (raw.contains('@')) {
            val at = raw.substringAfter('@').toLongOrNull() ?: return null
            val kind = raw.substringBefore('@')
            return if (kind.isEmpty()) null else PendingAction(kind, at)
        }
        // 旧键兜底：0.11.27 只可能是「切换」
        val legacy = prefs(ctx).getLong(K_PENDING_TAP, 0L)
        return if (legacy > 0) PendingAction("toggle", legacy) else null
    }

    fun clearPendingAction(ctx: Context) {
        prefs(ctx).edit().remove(K_PENDING_ACTION).remove(K_PENDING_TAP).apply()
    }

    private fun prefs(ctx: Context) =
        ctx.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
}
