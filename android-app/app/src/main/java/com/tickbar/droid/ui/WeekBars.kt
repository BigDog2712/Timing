package com.tickbar.droid.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.text.TextPaint
import android.view.View
import com.tickbar.droid.core.TimeFmt
import com.tickbar.droid.core.Tk

/**
 * 一周 7 根柱。手绘而不是塞 7 个 View：
 * 高度要按「周内最大值」归一化，用横向权重算不出纵向比例，索性一次画完。
 */
class WeekBars(context: Context) : View(context) {

    /** 周一 → 周日 的 7 个时长。 */
    var values: LongArray = LongArray(7)
        set(v) {
            field = v
            invalidate()
        }

    /** 七天的「一…日」标签。 */
    var labels: List<String> = emptyList()
        set(v) {
            field = v
            invalidate()
        }

    /** 今天在这一周里的下标，-1 = 本周不是当前周（暂时用不到）。 */
    var todayIndex: Int = -1
        set(v) {
            field = v
            invalidate()
        }

    private val bar = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val text = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
    private val rect = RectF()

    private fun d(v: Float): Float = v * resources.displayMetrics.density

    private val padTop = d(18f)      // 顶上留给「23m」数值
    private val labelH = d(20f)      // 底下留给「一…日」
    private val barW = d(16f)
    private val radius = d(4f)

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(
            MeasureSpec.getSize(widthMeasureSpec),
            d(132f).toInt(),
        )
    }

    override fun onDraw(canvas: Canvas) {
        val n = 7
        val w = width.toFloat()
        val slot = w / n
        val areaTop = padTop
        val areaBottom = height - labelH
        val areaH = (areaBottom - areaTop).coerceAtLeast(1f)
        val max = (values.maxOrNull() ?: 0L).coerceAtLeast(1L)

        text.textSize = Tk.sp(context, 10f)

        for (i in 0 until n) {
            val cx = slot * i + slot / 2f
            val v = values.getOrNull(i) ?: 0L
            val isToday = i == todayIndex

            // 底槽：所有人都画一条，空数据的日子也有「这一天在这」
            val trackTop = areaBottom - d(2f)
            bar.color = if (isToday) Tk.LINE_3 else Tk.LINE_2
            canvas.drawRoundRect(
                cx - barW / 2f, trackTop - d(2f), cx + barW / 2f, trackTop, radius, radius, bar,
            )

            if (v > 0L) {
                val h = (areaH * (v.toFloat() / max)).coerceAtLeast(d(4f))
                rect.set(cx - barW / 2f, areaBottom - h, cx + barW / 2f, areaBottom)
                bar.color = if (isToday) Tk.ACCENT else (Tk.ACCENT and 0x00FFFFFF) or 0xB3000000.toInt()
                canvas.drawRoundRect(rect, radius, radius, bar)

                // 数值压在柱顶上方，字号小、只在对齐处出现，不抢视线
                text.color = if (isToday) Tk.INK else Tk.INK_DIM
                val label = TimeFmt.human(v)
                canvas.drawText(label, cx, areaBottom - h - d(5f), text)
            }

            text.color = if (isToday) Tk.INK else Tk.INK_DIM
            text.textSize = Tk.sp(context, 12f)
            canvas.drawText(labels.getOrElse(i) { "" }, cx, height - d(4f), text)
            text.textSize = Tk.sp(context, 10f)
        }
    }
}
