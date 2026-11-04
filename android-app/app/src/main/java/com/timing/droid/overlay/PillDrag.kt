package com.timing.droid.overlay

import android.content.Context
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import com.timing.droid.core.Prefs
import kotlin.math.abs

/**
 * 悬浮条上的三种手势 → 三个动作：
 *  - 拖动：改窗口坐标，松手时把位置记进偏好（下次开机还在原地）
 *  - 短按：交给 [onTap]（开始 / 暂停 / 展开）
 *  - 长按（>520ms）：交给 [onLongPress]（打开 App）
 *
 * 单独成类是因为这段是「纯输入处理」，和服务的生命周期、通知、计时刷新没关系，
 * 混在一个 380 行的文件里最难读。
 */
internal class PillDrag(
    private val ctx: Context,
    private val wm: WindowManager,
    private val view: View,
    private val p: WindowManager.LayoutParams,
    private val onTap: () -> Unit,
    private val onLongPress: () -> Unit,
) : View.OnTouchListener {

    private var downRawX = 0f
    private var downRawY = 0f
    private var startX = 0
    private var startY = 0
    private var dragging = false

    private val slop: Int by lazy { ViewConfiguration.get(ctx).scaledTouchSlop }

    override fun onTouch(v: View, e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downRawX = e.rawX
                downRawY = e.rawY
                startX = p.x
                startY = p.y
                dragging = false
            }

            MotionEvent.ACTION_MOVE -> {
                val dx = e.rawX - downRawX
                val dy = e.rawY - downRawY
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
                } else if (e.eventTime - e.downTime > LONG_PRESS_MS) {
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
        try {
            wm.updateViewLayout(view, p)
        } catch (_: IllegalArgumentException) {
            // view 已 detach（服务正在销毁），忽略
        }
    }

    private companion object {
        const val LONG_PRESS_MS = 520L
    }
}
