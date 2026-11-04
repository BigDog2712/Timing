package com.tickbar.droid.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.text.TextPaint
import android.view.View
import com.tickbar.droid.core.Tk

/**
 * 计时首页那颗大环：外圈进度 + 中间大数字 + 下方事项名。
 * 桌面是 16px 的状态环，手机放大成正屏主视觉，语义不变（剩余/已用比例）。
 */
class RingView(context: Context) : View(context) {

    var fraction = 0f
        set(v) {
            if (field == v) return
            field = v
            invalidate()
        }

    var clock = "00:00"
        set(v) {
            if (field == v) return
            field = v
            invalidate()
        }

    var caption = "点开始计时"
        set(v) {
            if (field == v) return
            field = v
            invalidate()
        }

    var ringColor = Tk.ACCENT
        set(v) {
            if (field == v) return
            field = v
            invalidate()
        }

    private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        color = Tk.LINE_2
    }
    private val arc = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }
    private val number = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.BOLD)
        fontFeatureSettings = "tnum"
    }
    private val sub = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Tk.INK_DIM
    }
    private val rect = RectF()

    private fun d(v: Float) = v * resources.displayMetrics.density

    override fun onDraw(canvas: Canvas) {
        val size = minOf(width, height).toFloat()
        val stroke = d(9f)

        track.strokeWidth = stroke
        arc.strokeWidth = stroke
        arc.color = ringColor

        val inset = stroke / 2f + d(3f)
        val cx = width / 2f
        val cy = height / 2f
        val r = size / 2f - inset
        rect.set(cx - r, cy - r, cx + r, cy + r)

        canvas.drawArc(rect, -90f, 360f, false, track)
        if (fraction > 0f) canvas.drawArc(rect, -90f, 360f * fraction, false, arc)

        number.textSize = d(46f)
        number.color = Tk.INK
        val ty = cy - (number.descent() + number.ascent()) / 2f + d(2f)
        canvas.drawText(clock, cx - number.measureText(clock) / 2f, ty, number)

        sub.textSize = d(14f)
        val subWidth = sub.measureText(caption)
        canvas.drawText(caption, cx - subWidth / 2f, cy + d(40f), sub)
    }
}
