package com.timing.droid.overlay

import android.content.Context
import android.graphics.PixelFormat
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import com.timing.droid.core.Prefs
import com.timing.droid.core.Tk

/**
 * 悬浮窗口的「几何」：建参数、收边、复位。
 *
 * 抽出来的原因：坐标计算横跨「屏幕尺寸 / 窗口尺寸 / gravity 口径」三件事，
 * 散在服务里最容易写错一行（尤其 `CENTER_HORIZONTAL` 下 x 是相对中线的偏移，不是绝对左边距）。
 */
internal object PillGeometry {

    /** 顶部窗口参数：不抢焦点、可铺到状态栏下、默认落在「灵动岛」位置。 */
    fun params(ctx: Context, savedX: Int, savedY: Int): WindowManager.LayoutParams =
        WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            x = if (savedX == Prefs.POS_UNSET) 0 else savedX
            y = if (savedY == Prefs.POS_UNSET) statusBar(ctx) + Tk.dp(ctx, 4) else savedY
        }

    /**
     * 把坐标收进当前屏幕。三种情况会用到：首次贴上、拖动中、屏幕旋转。
     * 返回 true 表示位置被改动了（调用方据此决定要不要再 updateViewLayout）。
     */
    fun clamp(ctx: Context, view: View, p: WindowManager.LayoutParams): Boolean {
        val dm = ctx.resources.displayMetrics
        // gravity 带 CENTER_HORIZONTAL，所以 x 范围是 ±半个（屏幕宽 - 窗口宽）
        val halfX = ((dm.widthPixels - view.width) / 2).coerceAtLeast(0)
        val maxY = (dm.heightPixels - view.height).coerceAtLeast(0)
        val nx = p.x.coerceIn(-halfX, halfX)
        val ny = p.y.coerceIn(0, maxY)
        if (nx == p.x && ny == p.y) return false
        p.x = nx
        p.y = ny
        return true
    }

    /** 回到默认位：水平居中、状态栏下 4dp。 */
    fun reset(ctx: Context, p: WindowManager.LayoutParams) {
        p.x = 0
        p.y = statusBar(ctx) + Tk.dp(ctx, 4)
    }

    fun statusBar(ctx: Context): Int {
        val id = ctx.resources.getIdentifier("status_bar_height", "dimen", "android")
        return if (id > 0) ctx.resources.getDimensionPixelSize(id) else Tk.dp(ctx, 24)
    }
}
