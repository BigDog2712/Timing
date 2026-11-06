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

    /** 已暂停：不抢眼，但仍能看出「有个东西在等你」。 */
    const val PILL_IDLE = 0x8C9AA0A6.toInt()

    fun dp(ctx: Context, v: Float): Float = v * ctx.resources.displayMetrics.density

    fun sp(ctx: Context, v: Float): Float = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_SP, v, ctx.resources.displayMetrics,
    )
}
