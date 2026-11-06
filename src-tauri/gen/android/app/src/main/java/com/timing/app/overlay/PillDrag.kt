package com.timing.app.overlay

import android.content.Context
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import com.timing.app.native.Prefs
import kotlin.math.abs

/**
 * 悬浮条上的三种手势 → 三个动作（与老版本 `PillDrag` 一致）：
 *  - 拖动：改窗口坐标，松手时把位置记进偏好（下次开机还在原地）
 *  - 短按：交给 [onTap]（展开 / 回主界面）
 *  - 长按（>520ms）：交给 [onLongPress]（打开 App）
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
    private val onLongPress: () -> Unit,
) : View.OnTouchListener {

    private val slop = ViewConfiguration.get(ctx).scaledTouchSlop
    private var downRawX = 0f
    private var downRawY = 0f
    private var startX = 0
    private var startY = 0
    private var dragging = false

    override fun onTouch(v: View, event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downRawX = event.rawX
                downRawY = event.rawY
                startX = p.x
                startY = p.y
                dragging = false
            }

            MotionEvent.ACTION_MOVE -> {
                val dx = event.rawX - downRawX
                val dy = event.rawY - downRawY
                if (!dragging && (abs(dx) > slop || abs(dy) > slop)) dragging = true
                if (!dragging) return true

                p.x = startX + dx.toInt()
                p.y = startY + dy.toInt()
                PillGeometry.clamp(ctx, view, p)
                apply()
            }

            MotionEvent.ACTION_UP -> {
                if (dragging) {
                    // 松手才落盘：拖动过程中每帧都写 SharedPreferences 会卡
                    Prefs.setOverlayPos(ctx, p.x, p.y)
                } else if (event.eventTime - event.downTime > LONG_PRESS_MS) {
                    onLongPress()
                } else {
                    onTap()
                }
            }

            MotionEvent.ACTION_CANCEL -> dragging = false
        }
        return true
    }

    private fun apply() {
        runCatching { wm.updateViewLayout(view, p) }
    }

    private companion object {
        const val LONG_PRESS_MS = 520L
    }
}
