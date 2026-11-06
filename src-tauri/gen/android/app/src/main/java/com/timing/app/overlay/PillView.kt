package com.timing.app.overlay

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PathMeasure
import android.graphics.RectF
import android.graphics.Typeface
import android.text.TextPaint
import android.text.TextUtils
import android.view.View

/**
 * 小条本体（自绘，不走 XML）。
 *
 * 形态对齐老版本 `PillView` 的 BAR 分支：高 32dp 的药丸，左侧一个圆角方形状态环，
 * 中间等宽数字，右侧事项名。**没有搬小圆点（DOT）形态**——那一套是「待机时贴一颗玻璃球」
 * 的取巧，实现成本远高于药丸，而当前需求是「切出去还能看见在跑什么」，药丸已经够用。
 *
 * 手势不在这里处理：拖动 / 单击由 [PillService] 接管，因为只有它能改 WindowManager
 * 的坐标。这里只负责「长什么样」。
 */
internal class PillView(context: Context) : View(context) {

    var snap: TimerReader.Snap = TimerReader.Snap.IDLE
        set(value) {
            if (field == value) return
            field = value
            requestLayout()
            invalidate()
        }

    /** 倒计时最后一分钟的 1 秒闪烁（低于 WCAG 2.3.1 光敏阈值）。 */
    var blinkOn: Boolean = true
        set(value) {
            if (field == value) return
            field = value
            invalidate()
        }

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }
    private val timePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
        // 等宽数字：秒数变化时字宽不跳
        fontFeatureSettings = "tnum"
        color = Tk.PILL_INK
    }
    private val namePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.create("sans-serif", Typeface.NORMAL)
        color = Tk.PILL_INK_DIM
    }

    private val ringPath = Path()
    private val ringSeg = Path()
    private val ringRect = RectF()

    private fun d(v: Float): Float = v * resources.displayMetrics.density

    private val padH = d(9f)
    private val ringSize = d(16f)
    private val ringRadius = d(5f)
    private val gapRing = d(7f)
    private val gapName = d(6f)
    private val barH = d(32f)
    private val nameMax = d(92f)

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        timePaint.textSize = Tk.sp(context, 15f)
        namePaint.textSize = Tk.sp(context, 12f)

        val timeW = timePaint.measureText(timeText())
        val nameW = if (snap.active && snap.item.isNotEmpty()) namePaint.measureText(ellipsized()) else 0f
        val content = padH * 2 + ringSize + gapRing + timeW +
            (if (nameW > 0f) gapName + nameW else 0f)

        setMeasuredDimension(
            content.toInt().coerceIn(d(64f).toInt(), d(240f).toInt()),
            barH.toInt(),
        )
    }

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        val radius = h / 2f

        fill.color = Tk.PILL_BG
        canvas.drawRoundRect(0f, 0f, w, h, radius, radius, fill)

        stroke.strokeWidth = d(1f)
        stroke.color = Tk.PILL_LINE_2
        canvas.drawRoundRect(d(0.5f), d(0.5f), w - d(0.5f), h - d(0.5f), radius, radius, stroke)

        /* 状态环：圆角方形，进度沿轮廓裁一段（比圆弧更像桌面那颗环）。 */
        val left = padH
        val top = (h - ringSize) / 2f
        ringRect.set(left, top, left + ringSize, top + ringSize)
        ringPath.reset()
        ringPath.addRoundRect(ringRect, ringRadius, ringRadius, Path.Direction.CW)

        stroke.strokeWidth = d(2f)
        stroke.color = Tk.PILL_TRACK
        canvas.drawPath(ringPath, stroke)

        val frac = fraction()
        if (frac > 0f) {
            val pm = PathMeasure(ringPath, false)
            ringSeg.reset()
            pm.getSegment(0f, pm.length * frac, ringSeg, true)
            stroke.color = ringColor()
            canvas.drawPath(ringSeg, stroke)
        }

        timePaint.textSize = Tk.sp(context, 15f)
        timePaint.color = if (snap.active) Tk.PILL_INK else Tk.PILL_INK_DIM
        val baseY = h / 2f - (timePaint.descent() + timePaint.ascent()) / 2f
        var x = left + ringSize + gapRing
        canvas.drawText(timeText(), x, baseY, timePaint)
        x += timePaint.measureText(timeText())

        if (snap.item.isNotEmpty() && w > x + gapName + d(12f)) {
            namePaint.textSize = Tk.sp(context, 12f)
            val baseY2 = h / 2f - (namePaint.descent() + namePaint.ascent()) / 2f
            canvas.drawText(ellipsized(), x + gapName, baseY2, namePaint)
        }
    }

    // ------------------------------------------------------------ 计算

    private fun timeText(): String {
        val total = snap.displaySec
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        return if (h > 0) String.format("%d:%02d:%02d", h, m, s)
        else String.format("%02d:%02d", m, s)
    }

    private fun ellipsized(): String {
        namePaint.textSize = Tk.sp(context, 12f)
        return TextUtils.ellipsize(snap.item, namePaint, nameMax, TextUtils.TruncateAt.END).toString()
    }

    /** 环的进度：倒计时按剩余比例回落，正计时 60 秒一圈循环。 */
    private fun fraction(): Float = when {
        !snap.active -> 0f
        snap.countdown -> if (snap.targetSec <= 0L) 0f
        else (snap.displaySec.toFloat() / snap.targetSec).coerceIn(0f, 1f)
        else -> (snap.elapsedSec % 60) / 60f
    }

    private fun ringColor(): Int {
        val base = when {
            !snap.active || !snap.running -> Tk.PILL_IDLE
            snap.urgent -> Tk.PILL_DANGER
            else -> Tk.PILL_ACCENT
        }
        // 闪烁不换色，只压透明度，避免整条颜色来回跳
        return if (snap.urgent && !blinkOn) (base and 0x00FFFFFF) or 0x55000000 else base
    }
}
