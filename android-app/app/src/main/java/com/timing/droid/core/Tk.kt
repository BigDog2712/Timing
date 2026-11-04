package com.timing.droid.core

import android.content.Context

/**
 * 设计令牌的安卓镜像。
 *
 * 值全部抄自桌面端 `src/styles/tokens/02-theme-dark.css` 与 `03-theme-light.css`，
 * 只抄「有消费方」的那些，不搬整套 CSS 变量体系。改配色只改这里，别在组件里写裸色值。
 *
 * 为什么是 `val ... get()` 而不是 `const val`：桌面能切深浅色，安卓这里也要能切，
 * 而 `const val` 是编译期常量、没法在运行时换。改成只读属性后，调用点写法完全不变。
 * 代价是每次读都过一次分支——几十个色值、每帧几十次，可忽略。
 */
object Tk {

    const val DARK = 0
    const val LIGHT = 1

    /** 当前主题。进程内全局，切换后由 Activity `recreate()` 生效。 */
    @Volatile
    var mode: Int = DARK

    val dark: Boolean get() = mode == DARK

    // ------------------------------------------------------------ 背景层次

    /** --bg-plate 画布底 */
    val PLATE: Int get() = if (dark) 0xFF0E0F12.toInt() else 0xFFF2F3F5.toInt()

    /** --bg-panel 面板 / 底栏 */
    val PANEL: Int get() = if (dark) 0xFF0E1015.toInt() else 0xFFFFFFFF.toInt()

    /** --bg-card 卡片 */
    val CARD: Int get() = if (dark) 0xFF14161C.toInt() else 0xFFF7F8FA.toInt()

    /** --bg-field 输入框 / 设置行 */
    val FIELD: Int get() = if (dark) 0xFF1B1E25.toInt() else 0xFFF1F3F7.toInt()

    /** --bg-field-hi 输入框聚焦 / 行悬停 */
    val FIELD_HI: Int get() = if (dark) 0xFF232833.toInt() else 0xFFE6E9EF.toInt()

    // ------------------------------------------------------------ 描边
    // 深色用白色透明度（任何底色上都均匀），浅色换成墨色透明度（对应 --line / --line-2 / --line-3）

    val LINE: Int get() = if (dark) 0x0FFFFFFF else 0x1210141C
    val LINE_2: Int get() = if (dark) 0x1AFFFFFF else 0x1F10141C
    val LINE_3: Int get() = if (dark) 0x29FFFFFF else 0x2E10141C

    // ------------------------------------------------------------ 文字

    /** 正文。深色纯白、浅色 --ink #16181D，都是最高对比度那一级。 */
    val INK: Int get() = if (dark) 0xFFFFFFFF.toInt() else 0xFF16181D.toInt()

    /** 降权文字：占位符、已完成待办。浅色取 --ink-3（对 plate 4.6:1，仍可读）。 */
    val INK_DIM: Int get() = if (dark) 0x9EFFFFFF.toInt() else 0xFF5C6577.toInt()

    // ------------------------------------------------------------ 语义色
    // 浅色不是简单调亮度，而是「保色相降明度」到对浅底 ≥4.5:1 的那一档（桌面 AC-53 同口径）

    /** 计时中 */
    val ACCENT: Int get() = if (dark) 0xFF4DA3E8.toInt() else 0xFF1669AD.toInt()

    /** 提醒 */
    val WARN: Int get() = if (dark) 0xFFE8A33D.toInt() else 0xFFA05E00.toInt()

    /** 倒计时剩余 ≤60s / 危险操作 */
    val DANGER: Int get() = if (dark) 0xFFE5484D.toInt() else 0xFFD02C33.toInt()

    /** 完成 */
    val OK: Int get() = if (dark) 0xFF4CC38A.toInt() else 0xFF0C7E47.toInt()

    // ------------------------------------------------------------ 悬浮条专用
    // 悬浮条浮在「别人的界面」之上（可能是白色淘宝，也可能是黑色相机），
    // 所以它永远用深色底 + 白字，不跟随 App 主题——和灵动岛同口径。
    // 这几个值必须是 `const`：PillView 在 onDraw 里高频读。

    const val PILL_BG = 0xEB0E0F12.toInt()
    const val PILL_INK = 0xFFFFFFFF.toInt()
    const val PILL_INK_DIM = 0x9EFFFFFF.toInt()
    const val PILL_LINE_2 = 0x1AFFFFFF
    const val PILL_TRACK = 0x33FFFFFF
    const val PILL_ACCENT = 0xFF4DA3E8.toInt()
    const val PILL_DANGER = 0xFFE5484D.toInt()
    const val PILL_OK = 0xFF4CC38A.toInt()

    // 小圆点专用：不用深色底（药丸可以黑，圆点那么小一块黑在浅色 App 上像颗脏点）。
    // 改成「玻璃球」——中心全透、边缘微亮，再配一条墨色外圈，浅壁纸、深壁纸都不隐形。
    // 三件套的透明度都是试出来的：白环再亮一点就发灰，墨圈再重一点就显脏。

    /** 外圈墨线（12%）：白环在纯白壁纸上的唯一依靠，没有它小圆点会消失。 */
    const val PILL_DOT_EDGE = 0x2E000000

    /** 玻璃球面基色，用在径向渐变的最外环。 */
    const val PILL_DOT_GLASS = 0x24FFFFFF

    /** 内缘高光（30% 白）：让圆点看起来是「鼓」的而不是一块贴纸。 */
    const val PILL_DOT_RIM = 0x4DFFFFFF

    /** 表盘轨道（20% 白）：深色壁纸上的主轨。 */
    const val PILL_DOT_TRACK = 0x33FFFFFF

    /**
     * 轨道的墨色衬底（14% 黑）：白轨在浅色 App 上等于隐形，衬一层墨就把轮廓找回来。
     * 别想着用「中性灰」一次解决——它会在深色壁纸上显成一圈脏边。
     */
    const val PILL_DOT_TRACK_INK = 0x33000000

    /** 轴心（中性灰 55%）：深底、浅底都能看见，是待机时唯一还亮着的点。 */
    const val PILL_DOT_PIVOT = 0x8C9AA0A6.toInt()

    // ------------------------------------------------------------ 单位

    fun dp(ctx: Context, v: Int): Int =
        (v * ctx.resources.displayMetrics.density + 0.5f).toInt()

    fun dp(ctx: Context, v: Float): Float =
        v * ctx.resources.displayMetrics.density

    fun sp(ctx: Context, v: Float): Float =
        android.util.TypedValue.applyDimension(
            android.util.TypedValue.COMPLEX_UNIT_SP, v, ctx.resources.displayMetrics,
        )
}
