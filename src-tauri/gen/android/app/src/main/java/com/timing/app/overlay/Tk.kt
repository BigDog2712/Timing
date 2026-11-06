package com.timing.app.overlay

import android.content.Context
import android.util.TypedValue

/**
 * 悬浮条的设计令牌。
 *
 * 值抄自桌面端 `src/styles/tokens/02-theme-dark.css`，但**悬浮条不跟随主题**：它浮在
 * 别人的界面之上，可能是纯白淘宝，也可能是黑色相机取景框。
 *
 * [V0.11.10] 药丸不再是「深色底 + 白字」的灵动岛，改成**透明底 + 不透明文字**：底板去掉后
 * 浅色界面上白字会消失，所以文字统一带墨色阴影、状态环统一「墨线 + 白线」双轨。
 *
 * 全部 `const val`：`PillView.onDraw` 每帧都要读，只读属性会多一次分支。
 */
internal object Tk {

    const val PILL_INK = 0xFFFFFFFF.toInt()
    const val PILL_INK_DIM = 0x9EFFFFFF.toInt()

    /** 状态环白轨（深色界面上可见）。 */
    const val PILL_TRACK = 0x33FFFFFF

    /** 状态环墨轨：垫在白轨下面，浅色界面上靠它认出轮廓。 */
    const val PILL_TRACK_INK = 0x40000000

    /** 文字的托底墨晕。透明底上唯一的可读性保障，深底上几乎不可见。 */
    const val PILL_SHADOW = 0x99000000.toInt()

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
