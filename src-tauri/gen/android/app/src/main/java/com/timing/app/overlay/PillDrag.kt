package com.timing.app.overlay

import android.content.Context
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import com.timing.app.native.Prefs
import kotlin.math.abs

/**
 * 悬浮条上的三种手势 → 三个动作（[V0.11.29] 定稿语义）：
 *  - 拖动：改窗口坐标，松手时把位置记进偏好（下次开机还在原地）
 *  - 短按：交给 [onTap]（开始 / 暂停 / 继续）
 *  - 长按（>520ms）：交给 [onLongPress]（打开 App）
 *
 * 短按**只切计时、不跳转**，跳转归长按 —— 这条分工是主人点名要的：药丸浮在别人 App
 * 上面，随手点一下本来是想停表，被拽走一次就再也想不起来它还能干嘛。
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
                    /* 长按要有一声「到了」的回应：520ms 之后手指还压着，跳转本身有几十毫秒
                       的空白（Activity 冷启更久），不震一下的话用户会以为没按够而继续压着。 */
                    v.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
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
