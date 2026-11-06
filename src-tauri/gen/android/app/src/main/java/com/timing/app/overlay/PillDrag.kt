package com.timing.app.overlay

import android.content.Context
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import com.timing.app.native.Prefs
import kotlin.math.abs

/**
 * 拖动 / 单击。只做两件事：把窗口挪到手指下，松开时如果没挪过就算一次点击。
 *
 * 用 `rawX/rawY` 而不是 `x/y`：窗口自己也在动，用相对坐标会算成「越拖越慢」。
 * 阈值取系统 `scaledTouchSlop`，而不是写死 10dp——手指抖动的容差本来就该由系统定义。
 */
internal class PillDrag(
    private val ctx: Context,
    private val wm: WindowManager,
    private val view: View,
    private val p: WindowManager.LayoutParams,
    private val onTap: () -> Unit,
) : View.OnTouchListener {

    private val slop = ViewConfiguration.get(ctx).scaledTouchSlop
    private var downX = 0f
    private var downY = 0f
    private var startX = 0
    private var startY = 0
    private var moved = false

    override fun onTouch(v: View, event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = event.rawX
                downY = event.rawY
                startX = p.x
                startY = p.y
                moved = false
            }

            MotionEvent.ACTION_MOVE -> {
                val dx = event.rawX - downX
                val dy = event.rawY - downY
                if (!moved && (abs(dx) > slop || abs(dy) > slop)) moved = true
                if (moved) {
                    p.x = startX + dx.toInt()
                    p.y = startY + dy.toInt()
                    runCatching { wm.updateViewLayout(view, p) }
                }
            }

            MotionEvent.ACTION_UP -> {
                if (moved) {
                    PillGeometry.clamp(ctx, view, p)
                    runCatching { wm.updateViewLayout(view, p) }
                    Prefs.setOverlayPos(ctx, p.x, p.y)
                } else {
                    onTap()
                }
            }

            MotionEvent.ACTION_CANCEL -> {
                if (moved) Prefs.setOverlayPos(ctx, p.x, p.y)
            }
        }
        return true
    }
}
