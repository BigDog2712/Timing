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

    /** 位置未设置过（与真实坐标 -1 区分不开时用 `POS_UNSET`）。 */
    const val POS_UNSET = Int.MIN_VALUE

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

    private fun prefs(ctx: Context) =
        ctx.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
}
