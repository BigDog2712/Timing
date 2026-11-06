package com.timing.app.overlay

import android.content.Context
import android.util.TypedValue

/**
 * 悬浮条的设计令牌。
 *
 * 值抄自桌面端 `src/styles/tokens/02-theme-dark.css`，但**悬浮条不跟随主题**：它浮在
 * 别人的界面之上，可能是纯白淘宝，也可能是黑色相机取景框。药丸永远用深色底 + 白字，
 * 和灵动岛同口径——这是老版本 `Tk.kt` 里已经定下来的结论，这里只搬有消费方的那几个。
 *
 * 全部 `const val`：`PillView.onDraw` 每帧都要读，只读属性会多一次分支。
 */
internal object Tk {

    /** --bg-plate，92% 不透明。比桌面 94% 略透一点，手机壁纸更花。 */
    const val PILL_BG = 0xEB0E0F12.toInt()
    const val PILL_INK = 0xFFFFFFFF.toInt()
    const val PILL_INK_DIM = 0x9EFFFFFF.toInt()
    const val PILL_LINE_2 = 0x1AFFFFFF
    const val PILL_TRACK = 0x33FFFFFF

    /** 计时中：--accent 深色档。 */
    const val PILL_ACCENT = 0xFF4DA3E8.toInt()

    /** 倒计时剩余 ≤60s。 */
    const val PILL_DANGER = 0xFFE5484D.toInt()

    /** 计时结束。 */
    const val PILL_OK = 0xFF4CC38A.toInt()

    /** 已暂停：不抢眼，但仍能看出「有个东西在等你」。 */
    const val PILL_IDLE = 0x8C9AA0A6.toInt()

    /* ------------------------------------------------------------------ 小圆点
     *
     * 小圆点的难点和药丸不一样：药丸自带一块深色底，白字永远看得清；小圆点是一颗
     * **半透明玻璃球**，它压在什么底上由用户决定。所以这里每个颜色都不能只考虑一种底：
     * 墨圈与白圈叠着画、轨道墨线垫在白线下面，深底上看白线、浅底上看墨线。
     */

    /** 最外圈的墨色描边，压在纯白界面（淘宝、微信）上时保证边界可见。 */
    const val PILL_DOT_EDGE = 0x2E000000

    /** 玻璃球面：中心全透 → 边缘 14% 白，看起来是一层薄玻璃而不是一块实底。 */
    const val PILL_DOT_GLASS = 0x24FFFFFF

    /** 内缘高光，让球面有厚度。 */
    const val PILL_DOT_RIM = 0x4DFFFFFF

    /** 表盘主轨（白线），深色壁纸上可见。 */
    const val PILL_DOT_TRACK = 0x33FFFFFF

    /** 表盘衬底（墨线），浅色 App 上可见。与上面那条叠着画。 */
    const val PILL_DOT_TRACK_INK = 0x33000000

    /** 轴心常驻：待机时整颗点只剩它，是个「还活着」的暗示，不是空环。 */
    const val PILL_DOT_PIVOT = 0x8C9AA0A6.toInt()

    fun dp(ctx: Context, v: Float): Float = v * ctx.resources.displayMetrics.density

    fun sp(ctx: Context, v: Float): Float = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_SP, v, ctx.resources.displayMetrics,
    )
}
