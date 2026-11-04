package com.timing.droid.core

import android.content.Context

/**
 * 本地偏好。只放「开关 / 位置 / 单选」这类轻量项；
 * 计时记录、待办这类会长大的数据走 [Repo]（SQLite）。
 */
object Prefs {

    /** 悬浮形态：小圆点常驻（点一下临时展开） */
    const val STYLE_DOT = 0

    /** 悬浮形态：顶部胶囊常驻（放在灵动岛的位置，仿灵动岛的形态） */
    const val STYLE_ISLAND = 1

    /** 位置未设置过的哨兵值（`WindowManager.LayoutParams` 的合法值不会到 Int.MIN_VALUE）。 */
    const val POS_UNSET = Int.MIN_VALUE

    private fun sp(c: Context) = c.applicationContext.getSharedPreferences("timing", Context.MODE_PRIVATE)

    // ------------------------------------------------------------ 悬浮层

    fun overlayEnabled(c: Context): Boolean = sp(c).getBoolean("overlay_enabled", true)

    fun setOverlayEnabled(c: Context, v: Boolean) =
        sp(c).edit().putBoolean("overlay_enabled", v).apply()

    fun style(c: Context): Int = sp(c).getInt("overlay_style", STYLE_DOT)

    fun setStyle(c: Context, v: Int) = sp(c).edit().putInt("overlay_style", v).apply()

    /** 悬浮条横向偏移（相对屏幕中线，和 `CENTER_HORIZONTAL` 的 x 口径一致）。 */
    fun overlayX(c: Context): Int = sp(c).getInt("overlay_x", POS_UNSET)

    /** 悬浮条纵向偏移（相对屏幕顶）。 */
    fun overlayY(c: Context): Int = sp(c).getInt("overlay_y", POS_UNSET)

    fun setOverlayPos(c: Context, x: Int, y: Int) =
        sp(c).edit().putInt("overlay_x", x).putInt("overlay_y", y).apply()

    /** 复位到默认位置（顶部正中，状态栏下方）。 */
    fun clearOverlayPos(c: Context) =
        sp(c).edit().remove("overlay_x").remove("overlay_y").apply()

    // ------------------------------------------------------------ 外观

    /** 主题：Tk.DARK / Tk.LIGHT。默认深色（与桌面出厂一致）。 */
    fun theme(c: Context): Int = sp(c).getInt("theme", Tk.DARK)

    fun setTheme(c: Context, v: Int) = sp(c).edit().putInt("theme", v).apply()

    // ------------------------------------------------------------ 记录

    /** 低于该时长的计时不落记录（桌面默认 30 秒，可调 5–300） */
    fun minRecordMs(c: Context): Long = sp(c).getLong("min_record_ms", 30_000L)

    fun setMinRecordMs(c: Context, v: Long) = sp(c).edit().putLong("min_record_ms", v).apply()

    // ------------------------------------------------------------ 同步

    /**
     * 本机身份（首次调用时生成，之后固定）。
     * 同步时每行数据都带上它，用来判断「这条是谁写的」。
     */
    fun deviceId(c: Context): String {
        val s = sp(c)
        s.getString("device_id", null)?.let { return it }
        val id = java.util.UUID.randomUUID().toString().substring(0, 8)
        s.edit().putString("device_id", id).apply()
        return id
    }
}
